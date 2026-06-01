import datetime

from services.task_service import classify_due, compute_next_due

NOW = datetime.datetime(2026, 6, 1, 12, 0, tzinfo=datetime.timezone.utc)


def test_no_due_date_is_unclassified():
    assert classify_due(None, NOW) is None


def test_past_due_is_overdue():
    past = NOW - datetime.timedelta(hours=1)
    assert classify_due(past, NOW) == "overdue"


def test_same_calendar_day_is_today():
    later_today = NOW + datetime.timedelta(hours=5)  # hâlâ 1 Haziran
    assert classify_due(later_today, NOW) == "today"


def test_future_day_is_upcoming():
    tomorrow = NOW + datetime.timedelta(days=1)
    assert classify_due(tomorrow, NOW) == "upcoming"


def test_boundary_just_before_now_is_overdue():
    just_before = NOW - datetime.timedelta(seconds=1)
    assert classify_due(just_before, NOW) == "overdue"


# ── compute_next_due ──
def test_recurrence_none_or_unknown():
    assert compute_next_due(None, NOW) is None
    assert compute_next_due("", NOW) is None
    assert compute_next_due("haftada-bir-ara-sira", NOW) is None


def test_recurrence_daily_and_weekly():
    assert compute_next_due("daily", NOW) == NOW + datetime.timedelta(days=1)
    assert compute_next_due("weekly", NOW) == NOW + datetime.timedelta(days=7)


def test_recurrence_weekdays_skips_weekend():
    friday = datetime.datetime(2026, 6, 5, 9, 0, tzinfo=datetime.timezone.utc)
    # Cuma -> Pazartesi (Cmt/Pzr atlanır)
    assert compute_next_due("weekdays", friday) == datetime.datetime(
        2026, 6, 8, 9, 0, tzinfo=datetime.timezone.utc
    )


def test_recurrence_monthly_clamps_day():
    jan31 = datetime.datetime(2026, 1, 31, 9, 0, tzinfo=datetime.timezone.utc)
    # 31 Ocak -> 28 Şubat (gün ay sonuna sıkıştırılır)
    assert compute_next_due("monthly", jan31) == datetime.datetime(
        2026, 2, 28, 9, 0, tzinfo=datetime.timezone.utc
    )


def test_recurrence_monthly_december_rolls_year():
    dec15 = datetime.datetime(2026, 12, 15, 9, 0, tzinfo=datetime.timezone.utc)
    assert compute_next_due("monthly", dec15) == datetime.datetime(
        2027, 1, 15, 9, 0, tzinfo=datetime.timezone.utc
    )
