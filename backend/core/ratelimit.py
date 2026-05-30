"""IP bazlı basit Redis fixed-window rate limiter.

FastAPI dependency olarak kullanılır:

    @router.post("/login", dependencies=[Depends(rate_limit(key="login", limit=10, window_seconds=60))])

Redis erişilemezse fail-open davranır (akışı bloklamaz), böylece limiter altyapı
sorunu yüzünden girişleri tamamen kesmez.
"""
from __future__ import annotations

import logging

import redis.asyncio as aioredis
from fastapi import HTTPException, Request, status

from core.config import settings

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


def _client_ip(request: Request) -> str:
    # Proxy arkasında ise ilk X-Forwarded-For; yoksa doğrudan bağlantı IP'si.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(*, key: str, limit: int, window_seconds: int):
    async def dependency(request: Request) -> None:
        r = _redis()
        if r is None:
            return  # fail-open
        bucket = f"rl:{key}:{_client_ip(request)}"
        try:
            current = await r.incr(bucket)
            if current == 1:
                await r.expire(bucket, window_seconds)
            if current > limit:
                ttl = await r.ttl(bucket)
                retry = max(ttl, 1)
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Çok fazla deneme. Lütfen {retry} saniye sonra tekrar deneyin.",
                    headers={"Retry-After": str(retry)},
                )
        except HTTPException:
            raise
        except Exception:
            # Redis hatası akışı bozmasın; ama iz bırak.
            logger.warning("rate limit check failed for %s", bucket, exc_info=True)
            return

    return dependency
