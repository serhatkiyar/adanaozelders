"""Kurye canlı konumu — Redis'te TTL'li son nokta (teslimat Faz C).

Dağıtıcı telefonu ~10 sn'de bir konum yollar; müşteri sipariş sayfası okur.
Kalıcı iz TUTULMAZ (KVKK minimizasyonu): yalnız son konum, kısa TTL ile.
Best-effort: Redis yoksa yazma sessiz geçer, okuma None döner (akış bozulmaz).
"""
from __future__ import annotations

import json
import time

import redis.asyncio as aioredis

from core.config import settings

# Son konumun raf ömrü — ping kesilirse müşteri haritasında bayat nokta kalmasın.
POSITION_TTL_SECONDS = 180

_client: aioredis.Redis | None = None


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


def _key(run_id: int) -> str:
    return f"delivery:pos:{run_id}"


async def set_position(run_id: int, lat: float, lng: float) -> None:
    r = _redis()
    if r is None:
        return
    try:
        await r.set(
            _key(run_id),
            json.dumps({"lat": lat, "lng": lng, "ts": int(time.time())}),
            ex=POSITION_TTL_SECONDS,
        )
    except Exception:
        return  # best-effort


async def get_position(run_id: int) -> dict | None:
    """{"lat", "lng", "age_seconds"} ya da None (konum yok/bayat/Redis kapalı)."""
    r = _redis()
    if r is None:
        return None
    try:
        raw = await r.get(_key(run_id))
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return {
            "lat": float(data["lat"]),
            "lng": float(data["lng"]),
            "age_seconds": max(0, int(time.time()) - int(data["ts"])),
        }
    except (KeyError, TypeError, ValueError):
        return None


async def clear_position(run_id: int) -> None:
    r = _redis()
    if r is None:
        return
    try:
        await r.delete(_key(run_id))
    except Exception:
        return
