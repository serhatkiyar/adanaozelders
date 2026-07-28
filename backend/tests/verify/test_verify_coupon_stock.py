"""C — KUPON YARIŞI ve D — STOK (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ:

C1. `per_user_limit=1` bir kuponla aynı kullanıcı iki sipariş açıp ikisini de
    öderse indirim YALNIZ BİR KEZ sayılmalıdır. (Sipariş oluşturmada limit
    kontrolü yapılır ama redemption satırı ödemede yazılır — arada geniş bir
    pencere vardır.)
C2. Global `max_uses` sınırı da aynı pencerede aşılamamalıdır.
C3. Limit dolduğunda ödeme REDDEDİLMEZ (müşteri parayı ödemiştir); kupon
    sayılmaz ve durum loglanır.

D1. Aynı üründe son stok için yarışan iki sipariş: yalnız biri PAID olur,
    diğeri stok yetersizliğinden iptal edilir. Stok negatife düşmez.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.asyncio


async def _counts(db, coupon_id: int) -> tuple[int, int]:
    used = (
        await db.execute(
            text("SELECT used_count FROM coupons WHERE id = :i"), {"i": coupon_id}
        )
    ).scalar()
    rows = (
        await db.execute(
            text("SELECT count(*) FROM coupon_redemptions WHERE coupon_id = :i"),
            {"i": coupon_id},
        )
    ).scalar()
    return used, rows


async def _pay(order_id: int, *, token: str, amount: str):
    from core.database import AsyncSessionLocal
    from services import order_service

    async with AsyncSessionLocal() as s:
        return await order_service.complete_checkout(
            s,
            order_id=order_id,
            success=True,
            provider_ref=f"txn-{order_id}",
            token=token,
            paid_price=Decimal(amount),
        )


# ── C1: kullanıcı başına limit ───────────────────────────────────────────────


async def test_C1_per_user_limit_iki_siparisle_asilamaz(db, factory, fake_provider):
    client = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=50)
    coupon = await factory.coupon(db, value="30.00", per_user_limit=1)

    o1 = await factory.order(
        db, client=client, items=[(product, 1)],
        provider_ref="cf-c1a", coupon=coupon, discount="30.00",
    )
    o2 = await factory.order(
        db, client=client, items=[(product, 1)],
        provider_ref="cf-c1b", coupon=coupon, discount="30.00",
    )
    await db.commit()

    await _pay(o1.id, token="cf-c1a", amount="70.00")
    await _pay(o2.id, token="cf-c1b", amount="70.00")

    used, redemptions = await _counts(db, coupon.id)
    assert used == 1, f"kupon {used} kez sayıldı (limit 1)"
    assert redemptions == 1, f"{redemptions} redemption satırı (1 olmalı)"


# ── C2: global limit ─────────────────────────────────────────────────────────


async def test_C2_global_max_uses_asilamaz(db, factory, fake_provider):
    """Farklı kullanıcılar, tek kullanımlık kampanya kuponu."""
    c1 = await factory.client(db)
    c2 = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=50)
    coupon = await factory.coupon(db, value="30.00", max_uses=1)

    o1 = await factory.order(
        db, client=c1, items=[(product, 1)],
        provider_ref="cf-c2a", coupon=coupon, discount="30.00",
    )
    o2 = await factory.order(
        db, client=c2, items=[(product, 1)],
        provider_ref="cf-c2b", coupon=coupon, discount="30.00",
    )
    await db.commit()

    await _pay(o1.id, token="cf-c2a", amount="70.00")
    await _pay(o2.id, token="cf-c2b", amount="70.00")

    used, redemptions = await _counts(db, coupon.id)
    assert used == 1, f"global limit aşıldı: used_count={used}"
    assert redemptions == 1


# ── C3: limit dolunca ödeme yine de kesinleşir ───────────────────────────────


async def test_C3_limit_dolsa_bile_odeme_reddedilmez(db, factory, fake_provider):
    """Müşteri parayı ödemiştir; siparişi iptal etmek daha kötü bir sonuçtur."""
    client = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=50)
    coupon = await factory.coupon(db, value="30.00", per_user_limit=1)

    o1 = await factory.order(
        db, client=client, items=[(product, 1)],
        provider_ref="cf-c3a", coupon=coupon, discount="30.00",
    )
    o2 = await factory.order(
        db, client=client, items=[(product, 1)],
        provider_ref="cf-c3b", coupon=coupon, discount="30.00",
    )
    await db.commit()

    await _pay(o1.id, token="cf-c3a", amount="70.00")
    await _pay(o2.id, token="cf-c3b", amount="70.00")

    from models.store import Order

    for oid in (o1.id, o2.id):
        o = await db.get(Order, oid)
        await db.refresh(o)
        assert o.payment_status == "PAID", f"sipariş {oid} PAID olmalı"


# ── D1: son stok için yarış ──────────────────────────────────────────────────


async def test_D1_son_stok_icin_yarisan_iki_siparis(db, factory, fake_provider):
    """Stok 1; iki sipariş de 1 adet istiyor ve ikisi de ödendi."""
    c1 = await factory.client(db)
    c2 = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=1)

    o1 = await factory.order(db, client=c1, items=[(product, 1)], provider_ref="cf-d1a")
    o2 = await factory.order(db, client=c2, items=[(product, 1)], provider_ref="cf-d1b")
    await db.commit()

    await asyncio.gather(
        _pay(o1.id, token="cf-d1a", amount="100.00"),
        _pay(o2.id, token="cf-d1b", amount="100.00"),
    )

    from models.store import Order

    statuses = []
    for oid in (o1.id, o2.id):
        o = await db.get(Order, oid)
        await db.refresh(o)
        statuses.append(o.payment_status)

    stock = (
        await db.execute(
            text("SELECT stock FROM products WHERE id = :i"), {"i": product.id}
        )
    ).scalar()

    assert stock >= 0, f"stok negatife düştü: {stock}"
    assert statuses.count("PAID") <= 1, (
        f"son stok iki siparişe birden satıldı: {statuses}"
    )
