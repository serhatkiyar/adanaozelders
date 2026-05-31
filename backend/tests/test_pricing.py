"""Sunucu-tarafı ders ücreti hesabı (booking_service._compute_price) — DB'siz.

Fiyat istemciden alınmaz; eğitmen saatlik ücreti × süre ile hesaplanır.
"""
import datetime
from decimal import Decimal

from models.tutor import Tutor
from services.booking_service import _compute_price


def _dt(hour: int, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(2026, 6, 1, hour, minute, tzinfo=datetime.timezone.utc)


def _tutor(rate) -> Tutor:
    t = Tutor()
    t.hourly_rate = rate
    return t


def test_price_full_hour():
    assert _compute_price(_tutor(Decimal("250")), _dt(10), _dt(11)) == Decimal("250.00")


def test_price_ninety_minutes():
    assert _compute_price(_tutor(Decimal("250")), _dt(10), _dt(11, 30)) == Decimal(
        "375.00"
    )


def test_price_rounds_half_up():
    # 100 * (50/60) = 83.333... -> 83.33
    assert _compute_price(_tutor(Decimal("100")), _dt(10), _dt(10, 50)) == Decimal(
        "83.33"
    )


def test_price_two_hours_decimal_rate():
    assert _compute_price(_tutor(Decimal("200.50")), _dt(9), _dt(11)) == Decimal(
        "401.00"
    )


def test_price_none_when_rate_missing():
    assert _compute_price(_tutor(None), _dt(10), _dt(11)) is None
