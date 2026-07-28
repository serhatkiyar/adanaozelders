"""Sipariş iadesi iki fazlıdır (ekspertiz P0-4).

Eski akış: önce sağlayıcı iadesi, sonra durum yazımı. Sağlayıcı iadesi başarılı
olup commit düşerse para gitmiş, sipariş PAID görünür, stok geri yüklenmemiş ve
hiçbir iz kalmamış olurdu — yönetici tekrar denediğinde İKİNCİ iade giderdi.

Yeni akış (ders/bilet/rezervasyon yollarıyla aynı):
  Faz 1  begin_refund : PAID→REFUNDING + niyet damgası, HEMEN commit
  Faz 2  perform_refund: sağlayıcı iadesi → REFUNDING→REFUNDED

Süreç nerede ölürse ölsün kayıt sarkan REFUNDING olarak kalır ve reconciler
devralır; HELD/PAID'e geri dönüş yoktur.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from models.store import OrderPaymentStatus
from services import escrow, order_service


class _FakeOrder:
    def __init__(self, *, total: str = "300.00", coupon_id: int | None = None) -> None:
        self.id = 5
        self.client_id = 42
        self.payment_status = OrderPaymentStatus.PAID.value
        self.total = Decimal(total)
        self.provider_ref = "txn-abc"
        self.refunded_at = None
        self.refund_requested_at = None
        self.refund_attempts = 0
        self.coupon_id = coupon_id
        self.items: list = []


class _FakeDb:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj) -> None:
        return None


@pytest.fixture
def akis(monkeypatch):
    """begin_refund / perform_refund / _restock / kupon sınırlarını kaydeder."""
    log: dict = {"begin": [], "perform": [], "restock": [], "coupon_release": []}

    async def fake_restock(db, order):
        log["restock"].append(order.id)

    async def fake_release(db, *, coupon_id, order_id):
        log["coupon_release"].append(coupon_id)

    monkeypatch.setattr(order_service, "_restock", fake_restock)
    monkeypatch.setattr(order_service.coupon_service, "release", fake_release)
    return log


def _patch_phases(monkeypatch, log, *, begin_ok: bool, perform_ok: bool) -> None:
    async def fake_begin(db, obj, spec, *, from_statuses=None, provider_ref=None):
        log["begin"].append({"spec": spec, "from_statuses": from_statuses})
        if begin_ok:
            obj.payment_status = spec.refunding
        return begin_ok

    async def fake_perform(db, obj, spec, *, notify=None):
        log["perform"].append(obj.id)
        if perform_ok:
            obj.payment_status = spec.refunded
        return perform_ok

    monkeypatch.setattr(order_service.escrow, "begin_refund", fake_begin)
    monkeypatch.setattr(order_service.escrow, "perform_refund", fake_perform)


@pytest.mark.asyncio
async def test_basarili_iade_iki_fazi_da_kosar(monkeypatch, akis) -> None:
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    order = _FakeOrder(coupon_id=9)

    await order_service._refund_payment(_FakeDb(), order)

    assert len(akis["begin"]) == 1
    assert akis["begin"][0]["spec"] is escrow.ORDER_SPEC
    assert akis["perform"] == [5]
    assert akis["restock"] == [5]          # stok geri yüklendi
    assert akis["coupon_release"] == [9]   # kupon serbest bırakıldı
    assert order.payment_status == OrderPaymentStatus.REFUNDED.value


@pytest.mark.asyncio
async def test_claim_edilemezse_para_hareketi_yok(monkeypatch, akis) -> None:
    """Eşzamanlı ikinci iade/iptal: kaybeden taraf sağlayıcıya HİÇ gitmemeli."""
    _patch_phases(monkeypatch, akis, begin_ok=False, perform_ok=True)
    order = _FakeOrder()

    with pytest.raises(HTTPException) as exc:
        await order_service._refund_payment(_FakeDb(), order)

    assert exc.value.status_code == 409
    assert akis["perform"] == []   # sağlayıcı çağrılmadı
    assert akis["restock"] == []   # stok iki kez geri yüklenmedi
    assert order.payment_status == OrderPaymentStatus.PAID.value


@pytest.mark.asyncio
async def test_saglayici_reddederse_refunding_de_kalir(monkeypatch, akis) -> None:
    """PAID'e geri dönüş YOK — kayıt sarkan REFUNDING kalır, reconciler devralır."""
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=False)
    order = _FakeOrder()
    db = _FakeDb()

    with pytest.raises(HTTPException) as exc:
        await order_service._refund_payment(db, order)

    assert exc.value.status_code == 502
    assert order.payment_status == OrderPaymentStatus.REFUNDING.value
    # Yerel telafiler commit edilmiş olmalı: iade eninde sonunda tamamlanacak,
    # bu arada stoğun kayıp görünmesi müşteriye satış kaybettirir.
    assert akis["restock"] == [5]
    assert db.commits >= 1


@pytest.mark.asyncio
async def test_kuponsuz_siparis_release_cagirmaz(monkeypatch, akis) -> None:
    _patch_phases(monkeypatch, akis, begin_ok=True, perform_ok=True)
    await order_service._refund_payment(_FakeDb(), _FakeOrder(coupon_id=None))
    assert akis["coupon_release"] == []


# ── ORDER_SPEC sözleşmesi ────────────────────────────────────────────────────


def test_order_spec_dogru_kolonlari_isaret_eder() -> None:
    spec = escrow.ORDER_SPEC
    # Para durumu `payment_status`'ta; `status` sipariş yaşam döngüsüdür.
    assert spec.status_attr == "payment_status"
    # Sipariş toplamı `total` (escrow modellerinde `amount`).
    assert spec.amount_attr == "total"
    # Mağaza doğrudan satıştır: hak ediş dağıtımı yok → released_at guard'ı yok.
    assert spec.has_released_guard is False
    assert spec.held == OrderPaymentStatus.PAID.value
    assert spec.refunding == OrderPaymentStatus.REFUNDING.value
    assert spec.refunded == OrderPaymentStatus.REFUNDED.value
    assert spec.reference_prefix == "order"


def test_diger_specler_varsayilanlari_korur() -> None:
    """Genelleştirme mevcut üç yüzeyin davranışını değiştirmemeli."""
    for spec in (escrow.PAYMENT_SPEC, escrow.EXAM_SPEC, escrow.STUDY_SPEC):
        assert spec.status_attr == "status"
        assert spec.amount_attr == "amount"
        assert spec.has_released_guard is True
