"""Kapasiteye duyarlı söz (first_day_with_capacity) — saf, DB'siz."""
import datetime

from services.delivery_promise import first_day_with_capacity

D = datetime.date
SUN = [6]  # Pazar çalışılmaz

# 2026-07-13 Pazartesi; 2026-07-19 Pazar.
MON = D(2026, 7, 13)
SAT = D(2026, 7, 18)
SUNDAY = D(2026, 7, 19)


def test_empty_booked_returns_same_working_day():
    assert first_day_with_capacity(MON, {}, capacity=30, non_working_weekdays=SUN) == MON


def test_non_working_day_rolls_forward_first():
    # Pazar adayı önce Pazartesi'ye sarılır, kapasiteye oradan bakılır.
    assert (
        first_day_with_capacity(SUNDAY, {}, capacity=30, non_working_weekdays=SUN)
        == D(2026, 7, 20)
    )


def test_full_day_rolls_to_next_working_day():
    booked = {MON: 30}
    assert (
        first_day_with_capacity(MON, booked, capacity=30, non_working_weekdays=SUN)
        == D(2026, 7, 14)
    )


def test_consecutive_full_days_roll_further_and_skip_sunday():
    # Cumartesi dolu → Pazar çalışılmaz → Pazartesi.
    booked = {SAT: 30}
    assert (
        first_day_with_capacity(SAT, booked, capacity=30, non_working_weekdays=SUN)
        == D(2026, 7, 20)
    )


def test_partial_day_has_room():
    booked = {MON: 29}
    assert first_day_with_capacity(MON, booked, capacity=30, non_working_weekdays=SUN) == MON


def test_capacity_zero_disables_check():
    booked = {MON: 999}
    assert first_day_with_capacity(MON, booked, capacity=0, non_working_weekdays=SUN) == MON


def test_all_full_gives_up_after_max_days():
    # Emniyet supabı: her gün doluysa sonsuz döngü yok, bir gün döner.
    booked = {MON + datetime.timedelta(days=i): 30 for i in range(60)}
    out = first_day_with_capacity(
        MON, booked, capacity=30, non_working_weekdays=SUN, max_days=14
    )
    assert isinstance(out, datetime.date)
    assert out > MON
