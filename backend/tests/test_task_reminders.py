import datetime

from services.task_service import compute_trigger_at, reminder_message

UTC = datetime.timezone.utc
DUE = datetime.datetime(2026, 6, 2, 17, 0, tzinfo=UTC)


def test_absolute_returns_remind_at():
    at = datetime.datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    assert compute_trigger_at("absolute", None, at, DUE) == at
    # absolute, son tarihten bağımsızdır (due None olsa da çalışır)
    assert compute_trigger_at("absolute", None, at, None) == at


def test_relative_at_due_time():
    assert compute_trigger_at("relative", 0, None, DUE) == DUE


def test_relative_before_due():
    assert compute_trigger_at("relative", -15, None, DUE) == DUE - datetime.timedelta(minutes=15)
    assert compute_trigger_at("relative", -60, None, DUE) == DUE - datetime.timedelta(hours=1)


def test_relative_after_due():
    assert compute_trigger_at("relative", 30, None, DUE) == DUE + datetime.timedelta(minutes=30)


def test_relative_without_due_is_none():
    assert compute_trigger_at("relative", -15, None, None) is None


def test_relative_without_offset_is_none():
    assert compute_trigger_at("relative", None, None, DUE) is None


def test_unknown_type_is_none():
    assert compute_trigger_at("weird", 0, None, DUE) is None


def test_reminder_message():
    assert reminder_message("Rapor") == "Hatırlatma: Rapor"
