"""A — SİPARİŞ PARA YOLU (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ (koddan bağımsız, iş kuralı olarak):

A1. Bir sipariş yalnız BİR KEZ PAID olabilir. Eşzamanlı iki callback gelirse
    stok tam olarak bir kez düşer, kupon tam olarak bir kez harcanır.
A2. Aynı callback tekrar gelirse (replay) hiçbir yan etki oluşmaz ve para
    iadesi tetiklenmez.
A3. Callback'teki CF token'ı siparişte saklı token'la eşleşmiyorsa (bayat ya da
    ikinci ödeme oturumu) siparişe DOKUNULMAZ ve tahsil edilen para iade edilir.
A4. Tahsil edilen tutar (paidPrice) sipariş toplamıyla eşleşmiyorsa sipariş
    kesinleşmez ve para iade edilir.
A5. Ödeme başarısızsa sipariş FAILED olur ve müşteri yeniden deneyebilir;
    ancak BAYAT bir oturumun başarısızlığı aktif ödemeyi FAILED yapmaz.
A6. Stok yetersizse (ödeme alındıktan sonra) sipariş PAID OLMAZ; para iade
    edilir ve sipariş iptal edilir.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.asyncio


async def _reload(db, order_id: int):
    """Siparişi DB'den TAZE oku.

    `expire_all()` KULLANILMAZ: testteki diğer ORM nesnelerini (ürün, kupon) de
    expire eder ve sonraki `product.id` erişimi async bağlam dışında lazy-load
    tetikleyip MissingGreenlet üretir.
    """
    from models.store import Order

    obj = await db.get(Order, order_id)
    if obj is not None:
        await db.refresh(obj)
    return obj


async def _stock(db, product_id: int) -> int:
    return (
        await db.execute(
            text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
        )
    ).scalar()


async def _coupon_uses(db, coupon_id: int) -> tuple[int, int]:
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


# ── A1: eşzamanlı iki callback ───────────────────────────────────────────────


async def test_A1_esanzamanli_iki_callback_stok_ve_kuponu_bir_kez_tuketir(
    db, factory, fake_provider
):
    """İki callback AYNI ANDA gelirse tek kazanan olmalı.

    Bu, ekspertizin P0-3 bulgusunun gerçek DB'de doğrulanması: eski kodda
    check-then-act vardı ve ikisi de kontrolden geçip stoğu iki kez düşürüyordu.
    """
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=10)
    coupon = await factory.coupon(db, value="20.00")
    order = await factory.order(
        db,
        client=client,
        items=[(product, 2)],
        provider_ref="cf-token-1",
        coupon=coupon,
        discount="20.00",
    )
    await db.commit()

    # İki bağımsız oturum = iki eşzamanlı callback.
    from core.database import AsyncSessionLocal

    async def callback():
        async with AsyncSessionLocal() as s:
            try:
                await order_service.complete_checkout(
                    s,
                    order_id=order.id,
                    success=True,
                    provider_ref="txn-1",
                    token="cf-token-1",
                    paid_price=Decimal("180.00"),
                )
            except Exception as exc:  # noqa: BLE001
                return exc
            return None

    results = await asyncio.gather(callback(), callback())

    order_after = await _reload(db, order.id)
    assert order_after.payment_status == "PAID", f"sonuçlar: {results}"

    # ASIL KONTROL: yan etkiler tam olarak BİR kez uygulanmalı.
    assert await _stock(db, product.id) == 8, "stok iki kez düşmüş olmamalı"
    used, redemptions = await _coupon_uses(db, coupon.id)
    assert used == 1, f"kupon used_count {used} (1 olmalı)"
    assert redemptions == 1, f"redemption satırı {redemptions} (1 olmalı)"


# ── A2: replay ───────────────────────────────────────────────────────────────


async def test_A2_ayni_callback_tekrari_yan_etkisiz(db, factory, fake_provider):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="50.00", stock=5)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-2"
    )
    await db.commit()

    for _ in range(3):
        await order_service.complete_checkout(
            db,
            order_id=order.id,
            success=True,
            provider_ref="txn-2",
            token="cf-2",
            paid_price=Decimal("50.00"),
        )

    assert await _stock(db, product.id) == 4, "replay stoğu tekrar düşürmemeli"
    assert fake_provider.refunds == [], "replay iade tetiklememeli"


# ── A3: token uyuşmazlığı ────────────────────────────────────────────────────


async def test_A3_yanlis_token_siparisi_kesinlestirmez_ve_iade_eder(
    db, factory, fake_provider
):
    """İkinci/bayat ödeme oturumunun tahsilatı kayıtsız yutulmamalı."""
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="120.00", stock=3)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-AKTIF"
    )
    await db.commit()

    await order_service.complete_checkout(
        db,
        order_id=order.id,
        success=True,
        provider_ref="txn-BAYAT",
        token="cf-BAYAT",
        paid_price=Decimal("120.00"),
    )

    order_after = await _reload(db, order.id)
    assert order_after.payment_status == "PENDING", "siparişe dokunulmamalı"
    assert await _stock(db, product.id) == 3, "stok düşmemeli"
    assert fake_provider.refunds == [("txn-BAYAT", Decimal("120.00"))], (
        f"beklenmeyen tahsilat iade edilmeli, kayıt: {fake_provider.refunds}"
    )


# ── A4: paidPrice uyuşmazlığı ────────────────────────────────────────────────


@pytest.mark.parametrize("tahsil", ["1.00", "9999.00"])
async def test_A4_yanlis_tutar_kesinlestirmez_ve_iade_eder(
    db, factory, fake_provider, tahsil
):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="200.00", stock=4)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-4"
    )
    await db.commit()

    await order_service.complete_checkout(
        db,
        order_id=order.id,
        success=True,
        provider_ref="txn-4",
        token="cf-4",
        paid_price=Decimal(tahsil),
    )

    order_after = await _reload(db, order.id)
    assert order_after.payment_status == "PENDING"
    assert await _stock(db, product.id) == 4
    assert fake_provider.refunds == [("txn-4", Decimal(tahsil))]


# ── A5: başarısız ödeme ──────────────────────────────────────────────────────


async def test_A5_basarisiz_odeme_failed_yapar(db, factory, fake_provider):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="80.00", stock=2)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-5"
    )
    await db.commit()

    await order_service.complete_checkout(
        db, order_id=order.id, success=False, provider_ref=None, token="cf-5"
    )
    order_after = await _reload(db, order.id)
    assert order_after.payment_status == "FAILED"
    assert await _stock(db, product.id) == 2


async def test_A5b_bayat_oturumun_basarisizligi_aktif_odemeyi_bozmaz(
    db, factory, fake_provider
):
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="80.00", stock=2)
    order = await factory.order(
        db, client=client, items=[(product, 1)], provider_ref="cf-AKTIF"
    )
    await db.commit()

    await order_service.complete_checkout(
        db, order_id=order.id, success=False, provider_ref=None, token="cf-ESKI"
    )
    order_after = await _reload(db, order.id)
    assert order_after.payment_status == "PENDING", (
        "bayat oturumun başarısızlığı aktif ödemeyi FAILED yapmamalı"
    )


# ── A6: yetersiz stok (oversell) ─────────────────────────────────────────────


async def test_A6_yetersiz_stokta_siparis_paid_olmaz_para_iade_edilir(
    db, factory, fake_provider
):
    """Ödeme alındı ama stok bitti: hayalet sipariş yerine iade + iptal."""
    from services import order_service

    client = await factory.client(db)
    product = await factory.product(db, price="100.00", stock=1)
    order = await factory.order(
        db, client=client, items=[(product, 5)], provider_ref="cf-6"
    )
    await db.commit()

    await order_service.complete_checkout(
        db,
        order_id=order.id,
        success=True,
        provider_ref="txn-6",
        token="cf-6",
        paid_price=Decimal("500.00"),
    )

    order_after = await _reload(db, order.id)
    assert order_after.payment_status != "PAID", "stok yokken PAID olmamalı"
    assert order_after.status == "CANCELLED"
    assert await _stock(db, product.id) == 1, "stok değişmemeli"
    assert fake_provider.refunds, "tahsil edilen para iade edilmeli"
