import datetime

from services.task_service import classify_due

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
