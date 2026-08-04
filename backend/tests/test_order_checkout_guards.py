"""Sipariş callback sertleştirmesi — ders/bilet yoluyla parite (ekspertiz P0-1..P0-3).

Mağaza siparişi dört ödeme yüzeyinin en yüksek hacimlisi ve geri alınamaz yan
etkileri (stok düşme, kupon harcama) olan tek yüzeyiydi; buna karşılık
``complete_checkout`` ne token/paidPrice doğruluyor ne de PAID geçişini atomik
claim ediyordu. Bu testler o iki boşluğu kapatan davranışı sabitler.

DB gerektirmez: ``escrow.claim`` ve ``coupon_service.redeem`` gibi sınırlar
sahte (fake) nesnelerle değiştirilir; doğrulanan şey KARAR mantığıdır —
"hangi durumda para iade edilir, hangi durumda yan etki uygulanır".
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from services import escrow, order_service


class _FakeOrder:
    """complete_checkout'un dokunduğu Order yüzeyi."""

    def __init__(
        self,
        *,
        order_id: int = 1,
        payment_status: str = "PENDING",
        total: str = "250.00",
        provider_ref: str | None = None,
    ) -> None:
        self.id = order_id
        self.payment_status = payment_status
        self.total = Decimal(total)
        self.provider_ref = provider_ref
        self.paid_at: datetime.datetime | None = None
        # İP-2b R10: `complete_checkout` artık sipariş YAŞAM DÖNGÜSÜNE de
        # bakar (iptal edilmiş siparişin geç tahsilatı iade edilir).
        self.status = "PENDING"
        self.items: list = []


class _Recorder:
    """Sınır çağrılarını kaydeder (gerçek sağlayıcıya/DB'ye gidilmez)."""

    def __init__(self) -> None:
        self.refunds: list[dict] = []
        self.finalized: list[int] = []
        self.claims: list[dict] = []


@pytest.fixture
def rec(monkeypatch) -> _Recorder:
    r = _Recorder()

    async def fake_refund_unexpected(*, provider_ref, amount, context):
        r.refunds.append(
            {"provider_ref": provider_ref, "amount": amount, "context": context}
        )
        return True

    async def fake_finalize(db, order, *, provider_ref):
        r.finalized.append(order.id)
        order.payment_status = "PAID"

    async def fake_claim(db, model, row_id, **kw):
        r.claims.append({"row_id": row_id, **kw})
        return True

    async def noop_commit():
        return None

    monkeypatch.setattr(escrow, "refund_unexpected_charge", fake_refund_unexpected)
    monkeypatch.setattr(order_service.escrow, "refund_unexpected_charge", fake_refund_unexpected)
    monkeypatch.setattr(order_service, "_finalize_paid", fake_finalize)
    monkeypatch.setattr(order_service.escrow, "claim", fake_claim)
    return r


class _FakeDb:
    async def commit(self) -> None:
        return None

    async def refresh(self, obj) -> None:
        return None


def _patch_load(monkeypatch, order: _FakeOrder | None) -> None:
    async def fake_load(db, order_id):
        return order

    monkeypatch.setattr(order_service, "_load_full", fake_load)


# ── C3: token uyuşmazlığı ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_token_uyusmazliginda_para_iade_edilir_siparise_dokunulmaz(
    monkeypatch, rec
) -> None:
    """İkinci/bayat CF oturumunun tahsilatı siparişi PAID yapmamalı.

    Eski davranış: sipariş zaten PAID ise sessiz `return` → ikinci tahsilat ne
    emanete alınır ne iade edilirdi (kayıtsız çift tahsilat)."""
    order = _FakeOrder(provider_ref="cf-token-AKTIF")
    _patch_load(monkeypatch, order)

    out = await order_service.complete_checkout(
        _FakeDb(),
        order_id=1,
        success=True,
        provider_ref="txn-999",
        token="cf-token-BAYAT",
        paid_price=Decimal("250.00"),
    )

    assert out is order
    assert order.payment_status == "PENDING"  # siparişe dokunulmadı
    assert rec.finalized == []
    assert len(rec.refunds) == 1
    assert rec.refunds[0]["provider_ref"] == "txn-999"
    assert rec.refunds[0]["amount"] == Decimal("250.00")
    assert "token uyuşmazlığı" in rec.refunds[0]["context"]


@pytest.mark.asyncio
async def test_token_eslesirse_normal_kesinlesir(monkeypatch, rec) -> None:
    order = _FakeOrder(provider_ref="cf-token-AKTIF")
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(),
        order_id=1,
        success=True,
        provider_ref="txn-1",
        token="cf-token-AKTIF",
        paid_price=Decimal("250.00"),
    )

    assert rec.refunds == []
    assert rec.finalized == [1]


@pytest.mark.asyncio
async def test_token_verilmezse_geriye_uyumlu(monkeypatch, rec) -> None:
    """Fake sağlayıcı token göndermez; akış bozulmamalı."""
    order = _FakeOrder(provider_ref=None)
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(), order_id=1, success=True, provider_ref="txn-1"
    )

    assert rec.refunds == []
    assert rec.finalized == [1]


# ── C3: paidPrice uyuşmazlığı ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_eksik_tahsilat_reddedilir_ve_iade_edilir(monkeypatch, rec) -> None:
    order = _FakeOrder(total="250.00", provider_ref="cf")
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(),
        order_id=1,
        success=True,
        provider_ref="txn-1",
        token="cf",
        paid_price=Decimal("1.00"),  # 250 yerine 1 TL
    )

    assert order.payment_status == "PENDING"
    assert rec.finalized == []
    assert rec.refunds[0]["amount"] == Decimal("1.00")
    assert "paidPrice uyuşmazlığı" in rec.refunds[0]["context"]


@pytest.mark.asyncio
async def test_fazla_tahsilat_da_reddedilir(monkeypatch, rec) -> None:
    order = _FakeOrder(total="250.00", provider_ref="cf")
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(), order_id=1, success=True, provider_ref="t",
        token="cf", paid_price=Decimal("2500.00"),
    )

    assert rec.finalized == []
    assert rec.refunds[0]["amount"] == Decimal("2500.00")


# ── İdempotency ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("durum", ["PAID", "REFUNDING", "REFUNDED"])
@pytest.mark.asyncio
async def test_kesinlesmis_siparis_replayi_yan_etkisiz(
    monkeypatch, rec, durum: str
) -> None:
    """Replay token kontrolünden ÖNCE düşmeli — yoksa her tekrar yeni bir
    iade çağrısı üretirdi."""
    order = _FakeOrder(payment_status=durum, provider_ref="cf-AKTIF")
    _patch_load(monkeypatch, order)

    out = await order_service.complete_checkout(
        _FakeDb(), order_id=1, success=True, provider_ref="txn",
        token="cf-BASKA", paid_price=Decimal("999.00"),
    )

    assert out is order
    assert rec.refunds == []
    assert rec.finalized == []


@pytest.mark.asyncio
async def test_bilinmeyen_siparis_none_doner(monkeypatch, rec) -> None:
    _patch_load(monkeypatch, None)
    assert (
        await order_service.complete_checkout(
            _FakeDb(), order_id=404, success=True, provider_ref="t"
        )
        is None
    )


# ── Başarısız ödeme ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_basarisiz_odeme_failed_claim_eder(monkeypatch, rec) -> None:
    order = _FakeOrder(provider_ref="cf")
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(), order_id=1, success=False, provider_ref=None, token="cf"
    )

    assert rec.finalized == []
    assert len(rec.claims) == 1
    claim = rec.claims[0]
    assert claim["values"] == {"payment_status": "FAILED"}
    assert claim["from_statuses"] == ["PENDING"]
    assert claim["status_attr"] == "payment_status"


@pytest.mark.asyncio
async def test_bayat_oturumun_basarisizligi_aktif_odemeyi_bozmaz(
    monkeypatch, rec
) -> None:
    """Kullanıcı ikinci oturumu açıkken birincisi 'başarısız' dönerse aktif
    ödeme FAILED'lanmamalı."""
    order = _FakeOrder(provider_ref="cf-AKTIF")
    _patch_load(monkeypatch, order)

    await order_service.complete_checkout(
        _FakeDb(), order_id=1, success=False, provider_ref=None, token="cf-BAYAT"
    )

    assert rec.claims == []  # hiçbir durum değişikliği yok
