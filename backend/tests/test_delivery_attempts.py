"""Üç-deneme kuralı (Faz 5) — saf birim testleri.

`roll_promise_after_failed_attempt` tavana ulaşınca yeniden kuyruğa GİRMEZ
(False döner) ve söz gününü İLERLETMEZ — sonsuz PAID↔FAILED döngüsü kırılır.
"""

import datetime


from core.config import settings
from services import order_service


class _FakeOrder:
    """Order yerine minimal saf çift (DB gerekmez)."""

    def __init__(self, failed=0):
        self.failed_delivery_count = failed
        self.prepared_at = datetime.datetime.now(datetime.timezone.utc)
        self.prepared_by = "admin"
        self.promised_delivery_date = datetime.date(2026, 7, 18)


def test_attempts_exhausted_tavan():
    assert settings.DELIVERY_MAX_DELIVERY_ATTEMPTS == 3
    assert order_service.attempts_exhausted(2) is False
    assert order_service.attempts_exhausted(3) is True
    assert order_service.attempts_exhausted(4) is True


def test_attempts_exhausted_kapali(monkeypatch):
    monkeypatch.setattr(settings, "DELIVERY_MAX_DELIVERY_ATTEMPTS", 0)
    assert order_service.attempts_exhausted(99) is False


def test_roll_tavan_altinda_yeniden_kuyruk():
    o = _FakeOrder(failed=0)
    old_date = o.promised_delivery_date
    requeued = order_service.roll_promise_after_failed_attempt(o)
    assert requeued is True
    assert o.failed_delivery_count == 1
    assert o.prepared_at is None  # paket depoya döndü
    assert o.promised_delivery_date > old_date  # ertesi güne söz


def test_roll_tavanda_istisna_kuyrugu():
    o = _FakeOrder(failed=2)  # 3. başarısızlık tavana çıkarır
    old_date = o.promised_delivery_date
    requeued = order_service.roll_promise_after_failed_attempt(o)
    assert requeued is False
    assert o.failed_delivery_count == 3
    assert o.prepared_at is None
    # Söz günü İLERLEMEZ — operatör kararına dek son söz işaretli kalır.
    assert o.promised_delivery_date == old_date
