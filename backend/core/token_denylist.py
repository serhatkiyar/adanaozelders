"""Erişim token'ı iptali (logout) için Redis tabanlı denylist.

Access token'lar kısa ömürlü olduğundan, logout'ta token'ın `jti`'si kalan ömrü
kadar denylist'e yazılır; `get_current_user` her istekte bunu kontrol eder.

Redis erişilemezse `is_revoked` fail-open döner (token kabul edilir). Token'lar
kısa ömürlü olduğu için bu kabul edilebilir bir ödünleşmedir.
"""
from __future__ import annotations

import logging

import redis.asyncio as aioredis

from core.config import settings

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None
_PREFIX = "denylist:"


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


async def revoke(jti: str, ttl_seconds: int) -> None:
    r = _redis()
    if r is None or not jti:
        return
    try:
        await r.set(f"{_PREFIX}{jti}", "1", ex=max(ttl_seconds, 1))
    except Exception:
        logger.warning("token revoke failed for jti=%s", jti, exc_info=True)


async def is_revoked(jti: str | None) -> bool:
    if not jti:
        return False
    r = _redis()
    if r is None:
        return False  # fail-open
    try:
        return await r.exists(f"{_PREFIX}{jti}") == 1
    except Exception:
        logger.warning("token denylist check failed for jti=%s", jti, exc_info=True)
        return False
