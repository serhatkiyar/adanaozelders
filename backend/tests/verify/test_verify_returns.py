"""B — İADE (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ (koddan bağımsız, iş kuralı olarak):

B1. Cayma hakkı (CAYMA) talebi OTOMATİK onaylanır ve iade hemen başlar;
    satıcının reddetme yetkisi yoktur (Mesafeli Sözleşmeler Yönetmeliği m.9).
B2. Ayıplı/diğer talepler PENDING açılır, admin onayı bekler; onaydan önce
    hiçbir para hareketi olmaz.
B3. Kısmi iadede yalnız seçilen kalemin tutarı iade edilir; sipariş PAID KALIR
    (mal kısmen müşterededir) ve stok yalnız iade edilen adet kadar geri gelir.
B4. Tüm siparişten cayılırsa kargo ücreti de iade edilir; kısmi iadede edilmez.
B5. Birden çok kısmi iadenin TOPLAMI sipariş tutarını aşamaz.
B6. Sağlayıcı iadeyi reddederse talep REFUNDING'de kalır (PAID'e geri dönmez);
    para "iade edildi" görünmez, reconciler devralabilir.
B7. Aynı talebin iadesi iki kez işlenemez.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

pytestmark = pytest.mark.asyncio


class Sel:
    """İade kalemi seçimi (router'ın gönderdiği şeklin eşdeğeri)."""

    def __init__(self, order_item_id: int, quantity: int) -> None:
        self.order_item_id = order_item_id
        self.quantity = quantity


async def _paid_order(db, factory, *, price="100.00", qty=3, shipping="0", stock=10):
    """Ödenmiş + teslim edilmiş sipariş (iade ön koşulu)."""
    client = await factory.client(db)
    product = await factory.product(db, price=price, stock=stock)
    order = await factory.order(
        db,
        client=client,
        items=[(product, qty)],
        payment_status="PAID",
        status="DELIVERED",
        provider_ref="txn-paid",
        shipping=shipping,
    )
    order.delivered_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    # Gerçek akışta router siparişi ilişkileriyle (items/returns) yükler;
    # aynı yükleyiciyi kullanmazsak `order.returns` lazy-load tetikler.
    from services import order_service

    full = await order_service._load_full(db, order.id)
    return client, product, full


async def _items(db, order_id: int):
    rows = (
        await db.execute(
            text("SELECT id, quantity FROM order_items WHERE order_id = :i"),
            {"i": order_id},
        )
    ).all()
    return [(r[0], r[1]) for r in rows]


async def _stock(db, product_id: int) -> int:
    return (
        await db.execute(
            text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
        )
    ).scalar()


# ── B1: cayma otomatik onaylanır ─────────────────────────────────────────────


async def test_B1_cayma_otomatik_onaylanir_ve_iade_edilir(db, factory, fake_provider):
    from services import order_service

    _c, _p, order = await _paid_order(db, factory)
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "", return_type="CAYMA",
        items=[Sel(items[0][0], items[0][1])],
    )

    assert out.status == "APPROVED", "cayma talebi onay beklememeli"
    assert out.refund_status == "REFUNDED"
    assert fake_provider.refunds, "sağlayıcıya iade çağrısı gitmeli"


async def test_B1b_cayma_reddedilemez(db, factory, fake_provider):
    """Veri elle değiştirilse bile ret hukuken mümkün değil."""
    from models.store import OrderReturn
    from services import order_service

    _c, _p, order = await _paid_order(db, factory)
    items = await _items(db, order.id)
    out = await order_service.request_return(
        db, order, "", return_type="CAYMA", items=[Sel(items[0][0], 1)]
    )
    ret = await db.get(OrderReturn, out.id)
    ret.status = "PENDING"
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await order_service.reject_return(db, out.id, admin_note="olmaz")
    assert exc.value.status_code == 409


# ── B2: ayıplı talep onay bekler ─────────────────────────────────────────────


async def test_B2_ayipli_talep_pending_acilir(db, factory, fake_provider):
    from services import order_service

    _c, _p, order = await _paid_order(db, factory)
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "Ürün kırık geldi", return_type="AYIPLI",
        items=[Sel(items[0][0], 1)],
    )
    assert out.status == "PENDING"
    assert out.refund_status == "NONE"
    assert fake_provider.refunds == [], "onaydan önce para hareketi olmamalı"


# ── B3: kısmi iade ───────────────────────────────────────────────────────────


async def test_B3_kismi_iade_siparisi_paid_birakir_ve_stogu_kismen_geri_verir(
    db, factory, fake_provider
):
    """Kısmi iade: sipariş PAID kalır, para kısmen döner, stok FİZİKSEL KABULLE
    ve yalnız iade edilen adet kadar geri gelir.

    ## Davranış DEĞİŞTİ (İP-2a / PK-α, bilinçli ürün kararı)

    Stok eskiden para iadesiyle birlikte artıyordu; kitap hâlâ müşterinin
    elindeyken katalog "stokta var" gösteriyordu (İP2A-10). Onaylanan karara
    göre stok yalnız depo kabulünde döner. Testin ölçtüğü "yalnız 1 adet geri
    gelmeli" iddiası KORUNDU; hangi adımın onu doğurduğu değişti ve kabulden
    ÖNCE stoğun artmadığı ayrıca doğrulanıyor.
    """
    from models.store import Order
    from services import order_service

    _c, product, order = await _paid_order(db, factory, price="100.00", qty=3, stock=7)
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "", return_type="CAYMA", items=[Sel(items[0][0], 1)]
    )

    assert out.is_partial is True
    assert Decimal(out.refund_amount) == Decimal("100.00"), out.refund_amount

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert o.payment_status == "PAID", "kısmi iadede sipariş PAID kalmalı"
    assert Decimal(str(o.refunded_amount)) == Decimal("100.00")
    assert await _stock(db, product.id) == 7, (
        "PK-α: para iadesi tek başına stok üretmemeli (mal henüz gelmedi)"
    )

    # Depo malı teslim aldı → yalnız iade edilen adet satılabilir stoğa döner.
    # Aktör olarak sistem aktörü yeterli: `audit_logs.actor_id` FK taşımaz ve
    # bu senaryoda hasarlı adet (gerçek admin isteyen `damage_transfer`) yok.
    admin = order_service._SistemAktoru()
    ret_items = (
        await db.execute(
            text(
                "SELECT id, quantity FROM order_return_items WHERE return_id = :r"
            ),
            {"r": out.id},
        )
    ).all()
    await order_service.receive_return(
        db,
        out.id,
        lines=[
            order_service.ReceiveLine(int(rid), int(qty), 0) for rid, qty in ret_items
        ],
        actor=admin,
    )
    assert await _stock(db, product.id) == 8, "yalnız 1 adet geri gelmeli"


# ── B4: kargo kuralı ─────────────────────────────────────────────────────────


async def test_B4_tam_iadede_kargo_da_geri_verilir(db, factory, fake_provider):
    from services import order_service

    _c, _p, order = await _paid_order(
        db, factory, price="100.00", qty=2, shipping="49.90"
    )
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "", return_type="CAYMA",
        items=[Sel(items[0][0], items[0][1])],
    )
    assert out.is_partial is False
    assert Decimal(out.refund_amount) == Decimal("249.90"), out.refund_amount


async def test_B4b_kismi_iadede_kargo_geri_verilmez(db, factory, fake_provider):
    from services import order_service

    _c, _p, order = await _paid_order(
        db, factory, price="100.00", qty=2, shipping="49.90"
    )
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "", return_type="CAYMA", items=[Sel(items[0][0], 1)]
    )
    assert Decimal(out.refund_amount) == Decimal("100.00"), out.refund_amount


# ── B5: çoklu kısmi iade tavanı ──────────────────────────────────────────────


async def test_B5_coklu_kismi_iade_siparis_tutarini_asamaz(db, factory, fake_provider):
    from models.store import Order
    from services import order_service

    _c, _p, order = await _paid_order(db, factory, price="100.00", qty=3)
    items = await _items(db, order.id)
    item_id = items[0][0]

    for _ in range(4):  # 3 adetlik siparişte 4 kez iade denemesi
        o = await order_service._load_full(db, order.id)
        try:
            await order_service.request_return(
                db, o, "", return_type="CAYMA", items=[Sel(item_id, 1)]
            )
        except HTTPException:
            break

    o = await db.get(Order, order.id)
    await db.refresh(o)
    assert Decimal(str(o.refunded_amount)) <= Decimal(str(o.total)), (
        f"iade toplamı {o.refunded_amount} > sipariş toplamı {o.total}"
    )
    toplam_saglayici = sum((a for _r, a in fake_provider.refunds), Decimal("0"))
    assert toplam_saglayici <= Decimal(str(o.total)), (
        f"sağlayıcıya fazla iade gitti: {fake_provider.refunds}"
    )


# ── B6: sağlayıcı reddi ──────────────────────────────────────────────────────


async def test_B6_saglayici_reddederse_refunding_de_kalir(db, factory, fake_provider):
    from services import order_service

    fake_provider.refund_ok = False
    _c, _p, order = await _paid_order(db, factory)
    items = await _items(db, order.id)

    with pytest.raises(HTTPException) as exc:
        await order_service.request_return(
            db, order, "", return_type="CAYMA", items=[Sel(items[0][0], 1)]
        )
    assert exc.value.status_code == 502

    row = (
        await db.execute(
            text(
                "SELECT refund_status, refunded_at FROM order_returns "
                "WHERE order_id = :i ORDER BY id DESC LIMIT 1"
            ),
            {"i": order.id},
        )
    ).first()
    assert row[0] == "REFUNDING", f"talep {row[0]} durumunda (REFUNDING olmalı)"
    assert row[1] is None, "iade tamamlanmadığı hâlde refunded_at yazılmış"


# ── B7: çift iade koruması ───────────────────────────────────────────────────


async def test_B7_ayni_talep_iki_kez_iade_edilemez(db, factory, fake_provider):
    from services import order_service

    _c, _p, order = await _paid_order(db, factory)
    items = await _items(db, order.id)

    out = await order_service.request_return(
        db, order, "Kusurlu", return_type="AYIPLI", items=[Sel(items[0][0], 1)]
    )
    await order_service.approve_return(db, out.id, admin_note="ok")
    ilk = len(fake_provider.refunds)

    with pytest.raises(HTTPException):
        await order_service.approve_return(db, out.id, admin_note="tekrar")

    assert len(fake_provider.refunds) == ilk, "ikinci iade çağrısı sağlayıcıya gitti"
