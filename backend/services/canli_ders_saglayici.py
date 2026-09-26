"""Canlı ders sağlayıcısı ataması (zoom | agora, paralel).

Seçim kuralı saf ve tek kaynakta: `core/canli_ders.py::saglayici_sec`. Bu
modül yalnız veriyi (anahtarlar, kotalar, bu ayki kullanım) toplar ve
sonucu ATOMİK olarak yazar.

Atama kendi kısa transaction'ında yapılır (istek oturumunda DEĞİL): istek
sonradan 409/503 ile düşse bile atama kalıcı olur ve satır kilidi hemen
bırakılır. Aynı ders için eşzamanlı iki istek (eğitmen + öğrenci) koşullu
UPDATE sayesinde aynı sağlayıcıya düşer: ikinci UPDATE birincinin commit'ini
bekler, `IS NULL` koşulu artık tutmaz ve kazanan değer yeniden okunur.
"""
from __future__ import annotations

import datetime

from sqlalchemy import func, select, update

from core import canli_ders
from core.config import settings
from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus


def anahtarli_saglayicilar() -> list[str]:
    """Anahtarı tanımlı paralel sağlayıcılar (sıra: `PARALEL_SAGLAYICILAR`)."""
    tanimli = {
        "zoom": bool(settings.ZOOM_VIDEO_SDK_KEY and settings.ZOOM_VIDEO_SDK_SECRET),
        "agora": bool(settings.AGORA_APP_ID and settings.AGORA_APP_CERTIFICATE),
    }
    return [s for s in canli_ders.PARALEL_SAGLAYICILAR if tanimli.get(s)]


def paralel_atama_acik() -> bool:
    """Sunucu zoom/agora ile mi çalışıyor? livekit/jitsi seçiliyse atama kapalı."""
    return settings.CANLI_DERS_SAGLAYICI in canli_ders.PARALEL_SAGLAYICILAR


async def _bu_ayki_kullanim(db, an: datetime.datetime) -> dict[str, float]:
    """Bu takvim ayında (UTC, `start_at`e göre) her sağlayıcıya atanmış,
    iptal edilmemiş derslerin tahmini kişi-dakikası (süre × 2)."""
    bas, son = canli_ders.ay_araligi(an)
    dakika = func.extract("epoch", Booking.end_at - Booking.start_at) / 60
    stmt = (
        select(Booking.canli_ders_saglayici, func.coalesce(func.sum(dakika), 0))
        .where(
            Booking.canli_ders_saglayici.is_not(None),
            Booking.status != BookingStatus.CANCELLED,
            Booking.deleted_at.is_(None),
            Booking.start_at >= bas,
            Booking.start_at < son,
        )
        .group_by(Booking.canli_ders_saglayici)
    )
    rows = (await db.execute(stmt)).all()
    return {s: float(dk) * canli_ders.DERS_KISI_SAYISI for s, dk in rows}


async def sec(db, an: datetime.datetime) -> str | None:
    """Yeni bir derse atanacak sağlayıcı; anahtarlı sağlayıcı yoksa None."""
    anahtarli = anahtarli_saglayicilar()
    if not anahtarli:
        return None
    return canli_ders.saglayici_sec(
        anahtarli=anahtarli,
        kotalar={
            "zoom": settings.ZOOM_UCRETSIZ_KISI_DK,
            "agora": settings.AGORA_UCRETSIZ_KISI_DK,
        },
        kullanim=await _bu_ayki_kullanim(db, an),
        varsayilan=settings.CANLI_DERS_SAGLAYICI,
    )


async def ata(booking_id: int, now: datetime.datetime) -> str | None:
    """Dersin sağlayıcısını döndürür; atanmamışsa atomik olarak atar.

    None: ders atanmamış ve anahtarlı sağlayıcı yok (atama YAPILMAZ).
    Zaten atanmış bir ders asla değişmez.
    """
    async with AsyncSessionLocal() as db:
        mevcut = await db.scalar(
            select(Booking.canli_ders_saglayici).where(Booking.id == booking_id)
        )
        if mevcut is not None:
            return mevcut
        secim = await sec(db, now)
        if secim is None:
            return None
        yazilan = await db.scalar(
            update(Booking)
            .where(Booking.id == booking_id, Booking.canli_ders_saglayici.is_(None))
            .values(canli_ders_saglayici=secim)
            .returning(Booking.canli_ders_saglayici)
            .execution_options(synchronize_session=False)
        )
        if yazilan is None:
            # Yarışı öteki istek kazandı: onun (commit'lenmiş) değerini oku.
            yazilan = await db.scalar(
                select(Booking.canli_ders_saglayici).where(Booking.id == booking_id)
            )
        await db.commit()
        return yazilan
