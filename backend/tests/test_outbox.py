"""core/outbox saf yardımcıları — DB gerektirmez."""
import datetime
from types import SimpleNamespace

import pytest

from core.outbox import (
    enqueue,
    in_quiet_hours,
    next_allowed_send,
    next_backoff_seconds,
)

_Q = dict(start_hour=21, end_hour=8, end_minute=30)


def _utc(y, mo, d, h, mi=0):
    return datetime.datetime(y, mo, d, h, mi, tzinfo=datetime.timezone.utc)


def test_next_backoff_doubles_and_caps():
    assert next_backoff_seconds(1) == 30
    assert next_backoff_seconds(2) == 60
    assert next_backoff_seconds(3) == 120
    assert next_backoff_seconds(4) == 240
    # Tavan 1 saat — SMS'in ertesi gün gelmesi anlamsız, FAILED tavanı ayrı.
    assert next_backoff_seconds(20) == 3600
    # Savunma: 0/negatif deneme sayısı tabana düşer.
    assert next_backoff_seconds(0) == 30


def test_enqueue_rejects_unknown_kind():
    with pytest.raises(ValueError):
        enqueue(SimpleNamespace(add=lambda e: None), "sms:bilinmeyen", {})


def test_enqueue_adds_event_to_session():
    added: list = []
    db = SimpleNamespace(add=added.append)
    enqueue(db, "sms:failed", {"to": "+905551112233", "order_id": 7})
    assert len(added) == 1
    assert added[0].kind == "sms:failed"
    assert added[0].payload["order_id"] == 7


# ── Sessiz saat (PDS §3.8) ───────────────────────────────────────────────────


def test_in_quiet_hours_sarma():
    # Yerel saatler
    L = lambda h, mi=0: datetime.datetime(2026, 7, 18, h, mi)
    assert in_quiet_hours(L(22), **_Q) is True  # gece
    assert in_quiet_hours(L(2), **_Q) is True  # gece yarısı sonrası
    assert in_quiet_hours(L(8, 0), **_Q) is True  # 08:00 hâlâ sessiz
    assert in_quiet_hours(L(8, 30), **_Q) is False  # 08:30 açılış
    assert in_quiet_hours(L(14), **_Q) is False  # öğlen
    assert in_quiet_hours(L(20, 59), **_Q) is False  # 21 öncesi


def test_in_quiet_hours_kapali():
    assert in_quiet_hours(datetime.datetime(2026, 7, 18, 2), start_hour=0, end_hour=8, end_minute=30) is False


def test_next_allowed_send_gunduz_none():
    # UTC 11:00 + 3 = yerel 14:00 → sessiz değil → None (hemen gönder)
    assert next_allowed_send(_utc(2026, 7, 18, 11), utc_offset_hours=3, **_Q) is None


def test_next_allowed_send_aksam_yarin_sabah():
    # UTC 19:00 + 3 = yerel 22:00 → yarın 08:30 yerel = UTC 05:30 ertesi gün
    got = next_allowed_send(_utc(2026, 7, 18, 19), utc_offset_hours=3, **_Q)
    assert got == _utc(2026, 7, 19, 5, 30)


def test_next_allowed_send_gece_bugun_sabah():
    # UTC 02:00 + 3 = yerel 05:00 → bugün 08:30 yerel = UTC 05:30 aynı gün
    got = next_allowed_send(_utc(2026, 7, 18, 2), utc_offset_hours=3, **_Q)
    assert got == _utc(2026, 7, 18, 5, 30)
