import datetime
from decimal import Decimal

from services.study_reservation_service import compute_amount


def _dt(h: int, m: int = 0) -> datetime.datetime:
    return datetime.datetime(2026, 6, 10, h, m, tzinfo=datetime.timezone.utc)


def test_compute_amount_whole_hours():
    # 10:00–13:00 = 3 saat × 20 = 60.
    assert compute_amount(Decimal("20.00"), _dt(10), _dt(13)) == Decimal("60.00")


def test_compute_amount_half_hour():
    # 09:00–10:30 = 1.5 saat × 30 = 45.
    assert compute_amount(Decimal("30.00"), _dt(9), _dt(10, 30)) == Decimal("45.00")


def test_compute_amount_rounds_half_up():
    # 14:00–14:45 = 0.75 saat × 33.33 = 24.9975 → 25.00.
    assert compute_amount(Decimal("33.33"), _dt(14), _dt(14, 45)) == Decimal("25.00")
