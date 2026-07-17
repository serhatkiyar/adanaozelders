"""core/outbox saf yardımcıları — DB gerektirmez."""
from types import SimpleNamespace

import pytest

from core.outbox import enqueue, next_backoff_seconds


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
