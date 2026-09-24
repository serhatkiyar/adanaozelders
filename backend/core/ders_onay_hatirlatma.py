"""Öğretmenin "dersi onayla" hatırlatması kuralı (24 Eyl 2026, Preply deseni).

Saf fonksiyon: hem servis (`booking_service.remind_confirm`, sunucu kapısı)
hem şema (`BookingOut.can_remind_confirm`, düğmenin görünürlüğü) aynı kuralı
buradan okur — iki yerde ayrı yazılırsa düğme görünüp istek 409 alabilirdi.
Nesne ORM `Booking` ya da `BookingOut` olabilir; yalnız öznitelik okunur.
"""
from __future__ import annotations

import datetime
from typing import Any

from core.config import settings

HATIRLATMA_ARALIGI = datetime.timedelta(hours=24)


def _utc(dt: datetime.datetime) -> datetime.datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=datetime.timezone.utc)


def _deger(x: object) -> object:
    return getattr(x, "value", x)


def can_remind_confirm(booking: Any, now: datetime.datetime | None = None) -> bool:
    """Ders bitmiş, onay penceresi dolmamış, öğrenci onaylamamış, ihtilaf yok,
    ücret emanette ve son 24 saatte hatırlatma gönderilmemiş olmalı."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if _deger(getattr(booking, "status", None)) not in ("ACCEPTED", "COMPLETED"):
        return False
    end = _utc(booking.end_at)
    pencere = datetime.timedelta(hours=settings.LESSON_CONFIRM_WINDOW_HOURS)
    if not (end < now < end + pencere):
        return False
    if getattr(booking, "student_confirmed_at", None) is not None:
        return False
    if getattr(booking, "is_disputed", False):
        return False
    payment = getattr(booking, "payment", None)
    if payment is None or _deger(getattr(payment, "status", None)) != "HELD":
        return False
    son = getattr(booking, "confirm_reminded_at", None)
    return son is None or now - _utc(son) >= HATIRLATMA_ARALIGI
