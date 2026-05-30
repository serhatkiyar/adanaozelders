from __future__ import annotations

import time

import redis.asyncio as aioredis

from core.config import settings

_client: aioredis.Redis | None = None


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


async def touch(table: str, user_id: int) -> None:
    r = _redis()
    if r is None:
        return
    try:
        ts = int(time.time())
        async with r.pipeline(transaction=False) as pipe:
            pipe.set(f"presence:{table}:{user_id}", ts, ex=settings.PRESENCE_ONLINE_TTL_SECONDS)
            pipe.hset("presence:dirty", f"{table}:{user_id}", ts)
            await pipe.execute()
    except Exception:
        return  # presence best-effort; auth akışını asla bozma


async def flush_to_db(session) -> int:
    from sqlalchemy import bindparam, text

    r = _redis()
    if r is None:
        return 0
    try:
        pending = await r.hgetall("presence:dirty")
    except Exception:
        return 0
    if not pending:
        return 0

    buckets: dict[str, list[dict]] = {}
    for key, ts in pending.items():
        table, _id = key.split(":")
        buckets.setdefault(table, []).append(
            {"id": int(_id), "ts": int(ts)}
        )
    for table, rows in buckets.items():
        stmt = text(
            f"UPDATE {table} AS t SET last_seen_at = to_timestamp(v.ts) "
            "FROM (VALUES (:id, :ts)) AS v(id, ts) WHERE t.id = v.id"
        ).bindparams(bindparam("id"), bindparam("ts"))
        await session.execute(stmt, rows)
    await session.commit()
    await r.delete("presence:dirty")
    return sum(len(v) for v in buckets.values())
