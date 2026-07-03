"""H1 repro — reschedule sonrası Payment tutarı bayat kalıyor (gerçek Postgres).

booking_service.reschedule ``booking.price``'ı yeniden hesaplar ama mevcut
Payment.amount'a DOKUNMAZ; öğrenci 3 saatlik dersi 1 saatlik fiyata öder.
Beklenen davranış:
- Ödeme henüz alınmamışsa (PENDING/FAILED) tutar + komisyon + kazanç yeni fiyata
  eşitlenir (conservation korunarak).
- Ödeme emanetteyse (HELD) ve fiyat değişiyorsa reschedule 409 ile reddedilir —
  tahsil edilmiş tutar ile ders ücreti sessizce ayrışamaz. (Aynı süre/fiyatla
  saat değişikliği serbesttir.)
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import Payment, PaymentStatus
from services import booking_service


async def _reschedule(booking_id: int, *, hours: int) -> None:
    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, booking_id)
        new_start = booking.start_at + datetime.timedelta(days=1)
        await booking_service.reschedule(
            s,
            booking,
            start_at=new_start,
            end_at=new_start + datetime.timedelta(hours=hours),
        )
        await s.commit()


async def _payment(booking_id: int) -> Payment:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Payment).where(Payment.booking_id == booking_id))
        ).scalar_one()


async def test_h1_reschedule_resyncs_pending_payment_amount(factory, provider):
    """1 saat (500) → 3 saat: PENDING ödeme 1500'e eşitlenmeli (bugün 500 kalıyor)."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.PENDING,
        provider_ref=None,
        amount=Decimal("500.00"),
    )
    await _reschedule(seeded.booking_id, hours=3)

    payment = await _payment(seeded.booking_id)
    assert Decimal(str(payment.amount)) == Decimal("1500.00"), (
        f"reschedule sonrası ödeme tutarı bayat: {payment.amount} (beklenen 1500.00)"
    )
    # Conservation yeni tutarda da korunmalı.
    assert (
        Decimal(str(payment.commission_amount)) + Decimal(str(payment.tutor_earning))
        == Decimal("1500.00")
    )


async def test_h1_reschedule_held_payment_price_change_rejected(factory, provider):
    """Emanetteki (HELD) ödeme dururken fiyatı değiştiren reschedule 409 vermeli."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.HELD,
        amount=Decimal("500.00"),
    )
    with pytest.raises(HTTPException) as exc:
        await _reschedule(seeded.booking_id, hours=3)
    assert exc.value.status_code == 409

    payment = await _payment(seeded.booking_id)
    assert payment.status == PaymentStatus.HELD
    assert Decimal(str(payment.amount)) == Decimal("500.00")


async def test_h1_reschedule_held_same_price_allowed(factory, provider):
    """HELD ödeme + AYNI süre (fiyat değişmiyor): saat taşıma serbest kalmalı."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.HELD,
        amount=Decimal("500.00"),
    )
    await _reschedule(seeded.booking_id, hours=1)  # süre aynı → fiyat aynı

    payment = await _payment(seeded.booking_id)
    assert payment.status == PaymentStatus.HELD
    assert Decimal(str(payment.amount)) == Decimal("500.00")
