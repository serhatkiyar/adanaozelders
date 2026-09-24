"""Canlı ders tahtasının AÇIK/KAPALI durumu (Redis, kısa ömürlü).

Preply'da açık araç sınıfın adresidir (URL yansıtma); geç katılan ya da
sayfayı yenileyen taraf aynı araca döner. Bizde bu bilgi Centrifugo kanalında
(`ders:{id}`) yayınlanır ama kanalın geçmişi KAPALIDIR; geç katılanın son
durumu okuyabilmesi için tek değer burada tutulur. Tahta İÇERİĞİ saklanmaz.

Best-effort: Redis yoksa okuma "kapalı" döner, yazma sessizce düşer —
dersin kendisi (görüntü/ses) bu değere bağlı değildir.
"""
from __future__ import annotations

import logging

import redis.asyncio as aioredis

from core.config import settings

logger = logging.getLogger(__name__)

#: Ders penceresinin tamamından uzun (15 dk önce + ders + 30 dk sonra).
DURUM_TTL_SECONDS = 6 * 60 * 60

_client: aioredis.Redis | None = None


def _redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        except Exception:
            return None
    return _client


def _anahtar(booking_id: int) -> str:
    return f"ders-tahta:{booking_id}"


async def acik_mi(booking_id: int) -> bool:
    r = _redis()
    if r is None:
        return False
    try:
        return (await r.get(_anahtar(booking_id))) == "1"
    except Exception:  # noqa: BLE001
        logger.warning("tahta durumu okunamadı", exc_info=True)
        return False


async def yaz(booking_id: int, acik: bool) -> None:
    r = _redis()
    if r is None:
        return
    try:
        await r.set(_anahtar(booking_id), "1" if acik else "0", ex=DURUM_TTL_SECONDS)
    except Exception:  # noqa: BLE001
        logger.warning("tahta durumu yazılamadı", exc_info=True)
