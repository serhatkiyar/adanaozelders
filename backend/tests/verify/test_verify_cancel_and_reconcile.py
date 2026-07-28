"""E — İPTAL ve MUTABAKAT (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ:

E1. Müşteri ödenmiş siparişini (kargolanmadan önce) iptal edebilir: para iade
    edilir, stok geri yüklenir, sipariş CANCELLED olur.
    — Bu yol `_lock_order` + `order.items` kullanır; ilişki yeniden
      yüklenmezse async oturumda lazy-load 500 üretir.
E2. Kargolanmış sipariş iptal edilemez (iade talebi gerekir).
E3. Kayıp callback: müşteri ödedi ama callback hiç gelmedi → sipariş PENDING
    kaldı. Reconciler sağlayıcıdan doğrulayıp siparişi kesinleştirmelidir.
E4. Sarkan REFUNDING iade talebi reconciler kapsamındadır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

pytestmark = pytest.mark.asyncio


async def _stock(db, product_id: int) -> int:
    return (
        await db.execute(
            text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
        )
    ).scalar()


# ── E1: müşteri iptali (ödenmiş sipariş) ─────────────────────────────────────


async def test_E1_musteri_odenmis_siparisi_iptal_edebilir(db, factory, fake_provider):
    """Ekspertiz ÖNCESİ de var olan lazy-load hatasını yakalar.

    `cancel_by_client` → `_lock_order` (refresh) → `_refund_payment` →
    `_restock` (order.items). İlişki geri yüklenmezse burada MissingGreenlet
    fırlar ve müşteri siparişini hiç iptal edemez.
    """
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="150.00", stock=4)
    order = await factory.order(
        db,
        client=client,
        items=[(product, 2)],
        payment_status="PAID",
        status="PAID",
        provider_ref="txn-e1",
    )
    await db.commit()
    full = await order_service._load_full(db, order.id)

    out = await order_service.cancel_by_client(db, full)

    assert out.status == "CANCELLED"
    assert await _stock(db, product.id) == 6, "stok geri yüklenmeli"
    assert fake_provider.refunds, "ödeme iade edilmeli"


# ── E2: kargolanmış sipariş iptal edilemez ───────────────────────────────────


async def test_E2_kargolanmis_siparis_iptal_edilemez(db, factory, fake_provider):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="150.00", stock=4)
    order = await factory.order(
        db,
        client=client,
        items=[(product, 1)],
        payment_status="PAID",
        status="SHIPPED",
        provider_ref="txn-e2",
    )
    await db.commit()
    full = await order_service._load_full(db, order.id)

    with pytest.raises(HTTPException) as exc:
        await order_service.cancel_by_client(db, full)
    assert exc.value.status_code == 409
    assert fake_provider.refunds == [], "iptal edilemeyen siparişte para hareketi olmamalı"


# ── E3: kayıp callback → reconciler ──────────────────────────────────────────


async def test_E3_kayip_callback_reconciler_tarafindan_kesinlestirilir(
    db, factory, fake_provider, monkeypatch
):
    """Müşteri iyzico'da ödedi, tarayıcıyı kapattı: callback hiç gelmedi.

    Sipariş PENDING kalırsa para çekilmiştir ama kitap gönderilmez ve kimse
    fark etmez. Reconciler bu durumu sağlayıcıdan doğrulayıp kapatmalıdır.
    """
    from services import escrow_reconciler, order_service

    client = await factory.client(db)
    product = await factory.product(db, price="90.00", stock=5)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-lost"
    )
    # Kaydı "bayat" yap: reconciler yalnız belirli yaştaki kayıtlara bakar.
    eski = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
    await db.execute(
        text("UPDATE orders SET updated_at = :t WHERE id = :i"),
        {"t": eski, "i": order.id},
    )
    await db.commit()

    class Result:
        success = True
        provider_ref = "txn-lost"
        paid_price = Decimal("90.00")
        reference = f"order:{order.id}"

    class Provider:
        async def retrieve_checkout(self, *, token):
            assert token == "cf-lost"
            return Result()

        async def refund(self, **kw):  # pragma: no cover
            raise AssertionError("bu senaryoda iade beklenmiyor")

        async def refund_state(self, **kw):  # pragma: no cover
            from core.payments.base import RefundState

            return RefundState.UNKNOWN

    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: Provider())
    monkeypatch.setattr(
        escrow_reconciler.payments, "get_payment_provider", lambda: Provider()
    )
    monkeypatch.setattr(order_service.payments, "get_payment_provider", lambda: Provider())
    # Tarama aralığı sayacını sıfırla (aynı süreçte önceki test çalıştırmış olabilir).
    escrow_reconciler._last_checkout_scan = 0.0

    handled = await escrow_reconciler.reconcile_stale_checkouts(db)

    from models.store import Order

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert handled >= 1, "reconciler kaydı işlemeliydi"
    assert o.payment_status == "PAID", f"sipariş {o.payment_status} kaldı"
    assert await _stock(db, product.id) == 4, "stok düşmeli (sipariş kesinleşti)"


# ── E4: sarkan REFUNDING talebi reconciler kapsamında ────────────────────────


async def test_E4_sarkan_iade_talebi_reconciler_hedeflerinde(db):
    """Kısmi iade sağlayıcı çağrısında süreç ölürse talep REFUNDING'de kalır."""
    from models.store import OrderReturn
    from services import escrow_reconciler

    models = [m for m, _spec in escrow_reconciler._REFUNDING_TARGETS]
    assert OrderReturn in models, (
        "OrderReturn reconciler hedefi değil — sarkan iadeler sonsuza dek kalır"
    )
