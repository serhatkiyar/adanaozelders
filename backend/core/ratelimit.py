"""IP bazlı basit Redis fixed-window rate limiter.

FastAPI dependency olarak kullanılır:

    @router.post("/login", dependencies=[Depends(rate_limit(key="login", limit=10, window_seconds=60))])

Redis erişilemezse fail-open davranır (akışı bloklamaz), böylece limiter altyapı
sorunu yüzünden girişleri tamamen kesmez.
"""
from __future__ import annotations

import ipaddress
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


def _is_trusted_proxy(peer: str | None) -> bool:
    """Bağlantının doğrudan geldiği adres güvenilir proxy listesinde mi?

    ``TRUSTED_PROXY_IPS`` tek adres ("127.0.0.1"), CIDR ("172.16.0.0/12") veya
    "*" (her bağlantıya güven — yalnız proxy'nin dışarıdan erişilemediği
    dağıtımlarda) içerebilir. Liste boşsa hiçbir peer güvenilir değildir.
    """
    trusted = settings.TRUSTED_PROXY_IPS
    if not trusted or peer is None:
        return False
    if "*" in trusted:
        return True
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return False
    for entry in trusted:
        try:
            if addr in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


def _client_ip(request: Request) -> str:
    """Rate-limit kovası için istemci IP'si.

    X-Forwarded-For YALNIZCA bağlantı güvenilir bir proxy'den geliyorsa okunur.
    Aksi halde herkes kendi IP'sini uydurup her istekte yeni bir kova açar ve
    IP bazlı limitlerin tamamı (login brute-force dahil) etkisiz kalır.
    """
    peer = request.client.host if request.client else None
    if _is_trusted_proxy(peer):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # Zincirin EN SAĞDAKİ güvenilmeyen adresi gerçek istemcidir; tek
            # proxy varsayımıyla ilk değer yeterli (proxy kendi ekini sona koyar).
            client = forwarded.split(",")[0].strip()
            if client:
                return client
    return peer or "unknown"


async def enforce(*, bucket: str, limit: int, window_seconds: int) -> None:
    """Tek bir bucket için fixed-window sayaç kontrolü. Limit aşılırsa 429.

    Redis erişilemezse fail-open (sessizce geçer). IP ve kullanıcı bazlı
    limiter'lar (rate_limit / user_rate_limit) bunu paylaşır.
    """
    r = _redis()
    if r is None:
        return  # fail-open
    try:
        current = await r.incr(bucket)
        if current == 1:
            await r.expire(bucket, window_seconds)
        if current > limit:
            ttl = await r.ttl(bucket)
            retry = max(ttl, 1)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Çok fazla istek. Lütfen {retry} saniye sonra tekrar deneyin.",
                headers={"Retry-After": str(retry)},
            )
    except HTTPException:
        raise
    except Exception:
        # Redis hatası akışı bozmasın; ama iz bırak.
        logger.warning("rate limit check failed for %s", bucket, exc_info=True)
        return


def rate_limit(*, key: str, limit: int, window_seconds: int):
    """IP bazlı limiter (auth uçları: login/register/email)."""

    async def dependency(request: Request) -> None:
        await enforce(
            bucket=f"rl:{key}:{_client_ip(request)}",
            limit=limit,
            window_seconds=window_seconds,
        )

    return dependency
