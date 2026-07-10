"""Teslimat tercihi / erteleme saf mantığı: RESCHEDULED takip dalı + erteleme günü."""
import datetime

from services.delivery_promise import next_delivery_day
from services.delivery_service import resolve_tracking_status

UTC = datetime.timezone.utc


# ── resolve_tracking_status: RESCHEDULED dalı ────────────────────────────────────


def test_rescheduled_stop_maps_to_postponed():
    assert (
        resolve_tracking_status(
            order_status="PAID", stop_status="RESCHEDULED", run_status="ACTIVE"
        )
        == "POSTPONED"
    )
    assert (
        resolve_tracking_status(
            order_status="PAID", stop_status="RESCHEDULED", run_status="PLANNED"
        )
        == "POSTPONED"
    )


def test_rescheduled_does_not_shadow_delivered():
    # Sipariş sonradan teslim edildiyse DELIVERED kazanır.
    assert (
        resolve_tracking_status(
            order_status="DELIVERED", stop_status="RESCHEDULED", run_status="DONE"
        )
        == "DELIVERED"
    )


def test_failed_still_failed():
    assert (
        resolve_tracking_status(
            order_status="PAID", stop_status="FAILED", run_status="ACTIVE"
        )
        == "FAILED"
    )


# ── next_delivery_day (erteleme hedefi) ──────────────────────────────────────────


def _local(day: str, hhmm: str = "10:00") -> datetime.datetime:
    return datetime.datetime.fromisoformat(f"{day}T{hhmm}:00+03:00").astimezone(UTC)


def test_postpone_goes_to_tomorrow():
    # Çarşamba → Perşembe (cutoff'a bakılmaz; akşam da olsa yarın).
    got = next_delivery_day(
        _local("2026-07-08", "09:00"), non_working_weekdays=[6], utc_offset_hours=3
    )
    assert got == datetime.date(2026, 7, 9)


def test_postpone_on_saturday_skips_sunday():
    got = next_delivery_day(
        _local("2026-07-11"), non_working_weekdays=[6], utc_offset_hours=3
    )
    assert got == datetime.date(2026, 7, 13)  # Pazartesi


def test_postpone_late_night_local_day():
    # 22:30 UTC Çarşamba = Perşembe 01:30 yerel → hedef Cuma.
    got = next_delivery_day(
        datetime.datetime(2026, 7, 8, 22, 30, tzinfo=UTC),
        non_working_weekdays=[6],
        utc_offset_hours=3,
    )
    assert got == datetime.date(2026, 7, 10)
