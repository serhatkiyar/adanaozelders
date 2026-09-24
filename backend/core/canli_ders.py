"""Canlı ders kuralları — saf, tek kaynak.

Hem şema (`schemas/booking.py::BookingOut._gate_meeting_room`) hem canlı ders
token uçları (`api/routers/bookings.py::_canli_ders_kapilari`) buradan okur.
Kural bir yerde değişirse diğerinde de değişir: oda adı gizli kalıp token
verilmesi (ya da tersi) böylece imkânsızlaşır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from models.payment import PaymentStatus

# Katılım penceresi. Bu iki değer `frontend/src/lib/lesson.ts` içindeki
# JOIN_OPENS_BEFORE_MIN / JOIN_CLOSES_AFTER_MIN ile AYNI olmalıdır: ayrışırsa
# arayüz "Derse Katıl" düğmesini gösterirken sunucu 409 döner (ya da tersi).
KATILIM_ACILIS = datetime.timedelta(minutes=15)
KATILIM_KAPANIS = datetime.timedelta(minutes=30)


def ders_odasi_acik_mi(
    payment_status: PaymentStatus | str | None, price: Decimal | float | int | None
) -> bool:
    """Canlı ders odası (adı ve token'ı) bu ders için açılabilir mi?

    Ödeme emanete alınmışsa (HELD/RELEASED) ya da ders ücretsizse (price==0).
    Aksi halde öğrenci ödeme yapmadan canlı derse girebilirdi.
    """
    odendi = payment_status in (PaymentStatus.HELD, PaymentStatus.RELEASED)
    ucretsiz = price is not None and price == 0
    return odendi or ucretsiz
