"""Eğitmenin ek zaman aralıkları (takvim).

Ek aralık, haftalık müsaitlik şablonunu değiştirmeden belirli bir tarihte ek
müsait saat açar. İzin servisinin (`time_off_service`) aynasıdır: kilit altında
yazma, GiST exclusion ile çakışma koruması, soft-delete yok.

* Müsaitlik = o günün şablon pencereleri ∪ ek aralıklar
  (`booking_service.gun_araliklari`); slot listesi ve ders kuralları aynı
  birleşimi okur.
* İzin her zaman kazanır: izinle kesişen ek aralık kaydedilmez (409); sonradan
  eklenen izin ek aralığı silmez, slot izin yüzünden "busy" görünür.
* Ek aralığı silmek mevcut dersleri etkilemez.
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.tutor import Tutor, TutorAvailability
from models.tutor_extra_availability import TutorExtraAvailability
from models.tutor_time_off import TutorTimeOff
from services import booking_service, time_off_service

MAX_EXTRA_HOURS = 24
_ADIM = 30
#: Takvimin tek istekte okuyabileceği en uzun aralık; izinle aynı sınır.
MAX_LIST_DAYS = time_off_service.MAX_LIST_DAYS

ERR_PAST = "Geçmişteki bir tarih için zaman aralığı açamazsın."
ERR_STEP = "Ek aralık saatleri 30 dakikalık adımlarla seçilmeli."
ERR_ORDER = "Bitiş başlangıçtan sonra olmalı."
ERR_MAX = "Ek aralık en fazla 24 saat olabilir."
ERR_WINDOW = (
    f"Ek aralık en fazla {settings.BOOKING_WINDOW_DAYS} gün sonrasına kadar açılabilir."
)
ERR_ALREADY = "Bu saatler zaten haftalık müsaitliğinde."
ERR_TIME_OFF = "Bu aralık iznine denk geliyor. Önce izni kaldır."
ERR_OVERLAP = "Bu aralıkta zaten ek aralığın var."
ERR_NOT_FOUND = "Ek aralık bulunamadı."


def _hata(mesaj: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, mesaj)


def normalize_extra(
    start: datetime.datetime,
    end: datetime.datetime,
    now: datetime.datetime,
    window_end: datetime.datetime,
) -> tuple[datetime.datetime, datetime.datetime, list[str]]:
    """Ek aralığı doğrular (saf). Sıra: adım, sıra, geçmiş, 24 saat, pencere.

    İzinden farklı olarak geçmiş başlangıç kırpılmaz, reddedilir. 24 saat
    bildirim süresinin içine düşen başlangıç engellemez; ``MIN_NOTICE``
    uyarısı döner (o kısım öğrencilere zaten kapalıdır).
    """
    for an in (start, end):
        if an.minute % _ADIM or an.second or an.microsecond:
            raise _hata(ERR_STEP)
    if end <= start:
        raise _hata(ERR_ORDER)
    if start < now:
        raise _hata(ERR_PAST)
    if end - start > datetime.timedelta(hours=MAX_EXTRA_HOURS):
        raise _hata(ERR_MAX)
    if end > window_end:
        raise _hata(ERR_WINDOW)
    warnings: list[str] = []
    if start < now + datetime.timedelta(hours=settings.BOOKING_MIN_NOTICE_HOURS):
        warnings.append("MIN_NOTICE")
    return start, end, warnings


def _sablonda_mi(windows, start: datetime.datetime, end: datetime.datetime) -> bool:
    """Aralığın tamamı haftalık şablonun içinde mi? Gün gün bakılır.

    Gün 23:59'a kırpıldığı için (`gun_araliklari`) günün son dakikası
    karşılaştırmada yok sayılır: 00:00–24:00 şablonunda 22:00–24:00 ek aralığı
    da "zaten müsait" sayılır.
    """
    tz = booking_service._yerel_tz()
    gun = start.astimezone(tz).date()
    son_gun = end.astimezone(tz).date()
    while gun <= son_gun:
        gun_bas = datetime.datetime.combine(gun, datetime.time(0), tzinfo=tz)
        gun_son = gun_bas + datetime.timedelta(minutes=booking_service._GUN_SON_DAKIKA)
        a = max(start, gun_bas)
        b = min(end, gun_son)
        if b > a and not any(
            x <= a and b <= y for x, y in booking_service.gun_araliklari(windows, [], gun)
        ):
            return False
        gun += datetime.timedelta(days=1)
    return True


async def list_extra(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
) -> list[TutorExtraAvailability]:
    stmt = (
        select(TutorExtraAvailability)
        .where(
            TutorExtraAvailability.tutor_id == tutor.id,
            TutorExtraAvailability.start_at < end,
            TutorExtraAvailability.end_at > start,
        )
        .order_by(TutorExtraAvailability.start_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_extra(
    db: AsyncSession,
    tutor: Tutor,
    *,
    start: datetime.datetime,
    end: datetime.datetime,
    now: datetime.datetime,
) -> dict:
    """Ek aralık ekler. Eğitmen kilidi altında: izin yazma ve ders ayırtma ile
    aynı sıraya girer."""
    start, end, warnings = normalize_extra(
        start, end, now, booking_service.booking_window_end(now)
    )

    await booking_service._lock_tutor(db, tutor.id)
    izinle_kesisir = await db.scalar(
        select(
            exists().where(
                TutorTimeOff.tutor_id == tutor.id,
                TutorTimeOff.start_at < end,
                TutorTimeOff.end_at > start,
            )
        )
    )
    if izinle_kesisir:
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_TIME_OFF)
    if await list_extra(db, tutor, start=start, end=end):
        raise HTTPException(status.HTTP_409_CONFLICT, ERR_OVERLAP)
    windows = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor.id)
        )
    ).scalars().all()
    if windows and _sablonda_mi(windows, start, end):
        raise _hata(ERR_ALREADY)

    extra = TutorExtraAvailability(tutor_id=tutor.id, start_at=start, end_at=end)
    db.add(extra)
    await db.flush()  # yarış → GiST exclusion → IntegrityError → 409
    return {"extra": extra, "warnings": warnings}


async def delete_extra(db: AsyncSession, tutor: Tutor, extra_id: int) -> None:
    """Ek aralığı kaldırır; mevcut dersler etkilenmez. Sahiplik sorguda:
    başka öğretmenin aralığı 404 (varlık ifşa edilmez)."""
    result = await db.execute(
        delete(TutorExtraAvailability).where(
            TutorExtraAvailability.id == extra_id,
            TutorExtraAvailability.tutor_id == tutor.id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, ERR_NOT_FOUND)
