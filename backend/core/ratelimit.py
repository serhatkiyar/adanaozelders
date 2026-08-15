"""IP bazlı basit Redis fixed-window rate limiter.

FastAPI dependency olarak kullanılır:

    @router.post("/login", dependencies=[Depends(rate_limit(key="login", limit=10, window_seconds=60))])

Redis erişilemezse fail-open davranır (akışı bloklamaz), böylece limiter altyapı
sorunu yüzünden girişleri tamamen kesmez.
"""
from __future__ import annotations

import ipaddress
import asyncio
import logging

import redis.asyncio as aioredis
from fastapi import HTTPException, Request, status

from core.config import settings

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None
#: İstemcinin kurulduğu event loop. Bkz. `_redis` docstring'i ([[TB-51]]).
_client_loop: object | None = None


def _redis() -> aioredis.Redis | None:
    """Paylaşılan limiter istemcisi — **kurulduğu event loop'a bağlıdır**.

    redis-asyncio bağlantı havuzu, oluşturulduğu loop'a bağlanır. Üretimde
    tek uzun ömürlü loop olduğu için bu görünmez; ama pytest-asyncio her teste
    YENİ bir loop kurar ve eski loop'a bağlı istemci ilk kullanımda istisna
    atar. `enforce` o istisnayı `except Exception → return` ile yutup
    **fail-open**'a düştüğü için, limiter testi sessizce hiçbir şey ölçmez.

    Ölçüldü (İP-19 denetim turu, 15 Ağu 2026): filo yazma ucunun rate-limit
    testi tek başına 429 alıyor, tam entegrasyon suite'i içinde 61 ardışık
    yazmanın 61'i de 200 dönüyordu. Yani depodaki her rate-limit testi
    yalancı yeşil olabilirdi.

    Çözüm minimal: istemci hangi loop'ta kurulduğunu hatırlar, loop
    değiştiyse yenilenir. Üretim davranışı DEĞİŞMEZ (tek loop → tek istemci,
    her çağrıda yeni bağlantı kurulmaz — bu limiterin kendisini darboğaza
    çevirirdi).
    """
    global _client, _client_loop
    try:
        loop: object | None = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if _client is not None and loop is not None and _client_loop is not loop:
        _client = None
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            _client_loop = loop
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


def client_ip(request: Request) -> str:
    """İstemcinin gerçek IP'si (rate-limit kovası ve rıza ispat kaydı için).

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


#: Geriye dönük ad (modül içi çağrılar ve testler).
_client_ip = client_ip


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
