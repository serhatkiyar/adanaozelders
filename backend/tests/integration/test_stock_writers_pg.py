"""Altı stok yazma noktasının DEFTER üzerinden çalıştığının kanıtı (commit 5).

`test_stock_ledger_pg.py` defterin kendi değişmezlerini, bu dosya **çağıran
yolların** doğru hareketi ürettiğini ölçer: hareket türü, referans, idempotency
anahtarı, atomiklik ve iş kuralları.

İzolasyon: her test kendi ürününü/siparişini üretir; ürünler teardown'da
soft-delete edilir (defter append-only olduğu için ürün fiziksel silinemez).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from tests.integration.db_guard import purge_products
from models.store import Product, StockMovement
from schemas.store import ProductCreate, ProductUpdate
from services import order_service, stock_ledger, store_service
from services.stock_ledger import StockMovementType

ADMIN_ID = 1


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class Fabrika:
    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.return_ids: list[int] = []

    def izle_urun(self, pid: int) -> int:
        self.product_ids.append(pid)
        return pid

    async def urun(self, *, stock: int, kind: str = "PHYSICAL") -> int:
        """Ham ürün (defter kaydı OLMADAN) — yalnız yazma yolunu izole etmek için."""
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"yazici-{_uniq()}",
                title=f"Yazıcı Testi {_uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal("100.00"),
                stock=stock if kind == "PHYSICAL" else None,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            await s.refresh(p, ["sku"])
            await s.commit()
            return self.izle_urun(p.id)

    async def siparis(self, kalemler: list[tuple[int, int]], *, paid: bool) -> int:
        durum = "PAID" if paid else "PENDING"
        async with AsyncSessionLocal() as s:
            cid = (
                await s.execute(
                    text(
                        "INSERT INTO clients (first_name, last_name, username, email,"
                        " hashed_password, role_id) VALUES ('Yazici','Testi',:u,:e,"
                        "'x',3) RETURNING id"
                    ),
                    {"u": f"yazici{_uniq()}", "e": f"yazici-{_uniq()}@test.local"},
                )
            ).scalar_one()
            oid = (
                await s.execute(
                    text(
                        "INSERT INTO orders (client_id, subtotal, total, "
                        "payment_status, status, has_physical, track_token) VALUES "
                        "(:c, 100.00, 100.00, :ps, :st, true, :t) RETURNING id"
                    ),
                    {"c": cid, "ps": durum, "st": durum, "t": _uniq() + _uniq()},
                )
            ).scalar_one()
            for pid, adet in kalemler:
                await s.execute(
                    text(
                        "INSERT INTO order_items (order_id, product_id, title, "
                        "unit_price, quantity, kind, seller_type) VALUES (:o, :p, "
                        "'Yazıcı Kitabı', 10.00, :q, 'PHYSICAL', 'PLATFORM')"
                    ),
                    {"o": oid, "p": pid, "q": adet},
                )
            await s.commit()
        self.client_ids.append(cid)
        self.order_ids.append(oid)
        return oid

    async def iade(self, order_id: int, *, product_id: int, adet: int) -> int:
        """İade talebi + **fiziksel olarak teslim alınmış** kalem satırı.

        `accepted_quantity` açıkça doldurulur: İP-2a/PK-α ile stok artık para
        iadesinde değil DEPO KABULÜNDE döner ve `_restock_items` kabul edilen
        adedi yazar. Bu dosyanın konusu defter YAZICISININ sözleşmesidir
        (satır bazlı `RETURN` + idempotency anahtarı), kabul kapısının kendisi
        değil — o `test_ip2a_restock_pg.py`'de ölçülür. Kabul adedini burada
        set etmemek, yazıcıyı hiç çalıştırmadan "hareket yok" ölçmek olurdu.
        """
        async with AsyncSessionLocal() as s:
            item_id = (
                await s.execute(
                    text(
                        "SELECT id FROM order_items WHERE order_id = :o "
                        "AND product_id = :p LIMIT 1"
                    ),
                    {"o": order_id, "p": product_id},
                )
            ).scalar_one()
            rid = (
                await s.execute(
                    text(
                        "INSERT INTO order_returns (order_id, client_id, reason) "
                        "SELECT :o, client_id, 'yazıcı testi' FROM orders "
                        "WHERE id = :o RETURNING id"
                    ),
                    {"o": order_id},
                )
            ).scalar_one()
            await s.execute(
                text(
                    "INSERT INTO order_return_items (return_id, order_item_id, "
                    "quantity, amount, accepted_quantity) "
                    "VALUES (:r, :i, :q, 10.00, :q)"
                ),
                {"r": rid, "i": item_id, "q": adet},
            )
            await s.execute(
                text(
                    "UPDATE order_returns SET status = 'APPROVED', "
                    "received_at = now(), received_by = 'test' WHERE id = :r"
                ),
                {"r": rid},
            )
            await s.commit()
        self.return_ids.append(rid)
        return rid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.return_ids:
                await s.execute(
                    text("DELETE FROM order_return_items WHERE return_id = ANY(:i)"),
                    {"i": self.return_ids},
                )
                await s.execute(
                    text("DELETE FROM order_returns WHERE id = ANY(:i)"),
                    {"i": self.return_ids},
                )
            if self.order_ids:
                await s.execute(
                    text("DELETE FROM order_items WHERE order_id = ANY(:i)"),
                    {"i": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM orders WHERE id = ANY(:i)"), {"i": self.order_ids}
                )
            if self.client_ids:
                await s.execute(
                    text("DELETE FROM clients WHERE id = ANY(:i)"),
                    {"i": self.client_ids},
                )
            if self.product_ids:
                await purge_products(s, self.product_ids)
            await s.commit()


@pytest.fixture
async def fab(pg) -> Fabrika:
    f = Fabrika()
    yield f
    await f.cleanup()


class SahteAdmin:
    def __init__(self, admin_id: int = ADMIN_ID) -> None:
        self.id = admin_id


async def _stock(pid: int) -> int | None:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Product.stock).where(Product.id == pid))
        ).scalar_one()


async def _sku(pid: int) -> str:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Product.sku).where(Product.id == pid))
        ).scalar_one()


async def _movements(pid: int) -> list[StockMovement]:
    async with AsyncSessionLocal() as s:
        return list(
            (
                await s.execute(
                    select(StockMovement)
                    .where(StockMovement.product_id == pid)
                    .order_by(StockMovement.id)
                )
            ).scalars()
        )


# ═══════════ W4 · create_product → INITIAL ═══════════


async def test_w4_urun_olusturma_INITIAL_hareketi_yazar(fab):
    async with AsyncSessionLocal() as s:
        detay = await store_service.create_product(
            s,
            SahteAdmin(),
            ProductCreate(
                tax_rate=Decimal("0.20"),
                title=f"Yeni Kitap {_uniq()}",
                kind="PHYSICAL",
                price=Decimal("50.00"),
                stock=12,
            ),
        )
    fab.izle_urun(detay.id)

    rows = await _movements(detay.id)
    assert len(rows) == 1
    mv = rows[0]
    assert mv.movement_type == StockMovementType.INITIAL.value
    assert mv.reason_code == "PRODUCT_CREATE"
    assert mv.qty_delta == 12 and mv.qty_after == 12
    assert mv.ref_type == "product" and mv.ref_id == detay.id
    assert mv.idempotency_key == f"product:{detay.id}:INITIAL"
    assert mv.actor_type == "ADMIN" and mv.actor_id == ADMIN_ID
    assert await _stock(detay.id) == 12
    # NOT: `sku` henüz `ProductDetailOut`'ta yok (admin yüzeyi commit 6);
    # değeri DB'den okunuyor.
    assert await _sku(detay.id) == f"FZK-{detay.id:06d}"


async def test_w4_dijital_urun_SKU_alir_hareket_ALMAZ(fab):
    """§3g0: dijital ürün stok yönetimine tabi değil."""
    async with AsyncSessionLocal() as s:
        detay = await store_service.create_product(
            s,
            SahteAdmin(),
            ProductCreate(
                tax_rate=Decimal("0.20"),
                title=f"Dijital {_uniq()}", kind="DIGITAL", price=Decimal("20.00")
            ),
        )
    fab.izle_urun(detay.id)
    assert await _sku(detay.id) == f"DIJ-{detay.id:06d}"
    assert await _movements(detay.id) == []
    assert await _stock(detay.id) is None


async def test_w4_hareket_yazilamazsa_urun_de_olusmaz(fab, monkeypatch):
    """Atomiklik: ürün + INITIAL aynı transaction'da."""
    async with AsyncSessionLocal() as s:
        async def patlat(*a, **kw):
            raise RuntimeError("defter yazılamadı (enjekte edilmiş hata)")

        monkeypatch.setattr(store_service.stock_ledger, "apply_movement", patlat)
        baslik = f"Atomik {_uniq()}"
        with pytest.raises(RuntimeError):
            await store_service.create_product(
                s,
                SahteAdmin(),
                ProductCreate(
                tax_rate=Decimal("0.20"),
                    title=baslik, kind="PHYSICAL", price=Decimal("10.00"), stock=5
                ),
            )
        await s.rollback()

    async with AsyncSessionLocal() as s:
        kalan = (
            await s.execute(select(Product.id).where(Product.title == baslik))
        ).first()
    assert kalan is None, "hareket yazılamadı ama ürün oluşmuş (atomiklik yok)"


# ═══════════ W5 · bulk_import_products → INITIAL ═══════════


def _csv_row(**over) -> dict:
    row = {
        "title": f"CSV {_uniq()}",
        "kind": "PHYSICAL",
        "price": "30.00",
        # İP-5/S-5: CSV'de KDV oranı ZORUNLU — oransız satır oluşturulmaz ve
        # `errors[]`'ta raporlanır. Sessizce %0 yazmak, yanlış oranla satılan
        # ve yanlış fatura kesilen bir ürün demektir.
        "tax_rate": "0.20",
        "stock": "7",
        "status": "ACTIVE",
    }
    row.update(over)
    return row


async def test_w5_csv_import_INITIAL_yazar(fab):
    async with AsyncSessionLocal() as s:
        sonuc = await store_service.bulk_import_products(
            s, SahteAdmin(), [_csv_row(), _csv_row(stock="3")]
        )
    assert sonuc["created"] == 2, sonuc

    async with AsyncSessionLocal() as s:
        pids = (
            await s.execute(
                select(Product.id).where(Product.title.like("CSV %")).order_by(
                    Product.id.desc()
                ).limit(2)
            )
        ).scalars().all()
    for pid in pids:
        fab.izle_urun(pid)
        rows = await _movements(pid)
        assert len(rows) == 1
        assert rows[0].movement_type == StockMovementType.INITIAL.value
        assert rows[0].reason_code == "CSV_IMPORT"
        assert rows[0].idempotency_key == f"product:{pid}:INITIAL"
        assert rows[0].qty_after == await _stock(pid)


async def test_w5_hatali_satir_digerlerini_ve_defterlerini_bozmaz(fab):
    """Savepoint davranışı: bir satır patlarsa diğerleri + defterleri tutarlı."""
    async with AsyncSessionLocal() as s:
        sonuc = await store_service.bulk_import_products(
            s,
            SahteAdmin(),
            [
                _csv_row(stock="4"),
                _csv_row(price="0"),          # geçersiz → hata
                _csv_row(stock="6"),
            ],
        )
    assert sonuc["created"] == 2
    assert len(sonuc["errors"]) == 1 and sonuc["errors"][0]["row"] == 2

    async with AsyncSessionLocal() as s:
        pids = (
            await s.execute(
                select(Product.id).where(Product.title.like("CSV %")).order_by(
                    Product.id.desc()
                ).limit(2)
            )
        ).scalars().all()
    for pid in pids:
        fab.izle_urun(pid)
        rows = await _movements(pid)
        assert len(rows) == 1, "hatalı satır komşularının defterini bozdu"
        async with AsyncSessionLocal() as s:
            assert (await stock_ledger.verify_ledger(s, pid)).consistent is True


async def test_w5_ayni_urune_ikinci_INITIAL_yazilamaz(fab):
    """`product:{id}:INITIAL` anahtarı çift ilk-stoğu engeller (retry güvenliği)."""
    pid = await fab.urun(stock=0)
    kw = dict(
        qty_delta=5,
        movement_type=StockMovementType.INITIAL,
        reason_code="CSV_IMPORT",
        ref_type="product",
        ref_id=pid,
        idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN",
        actor_id=ADMIN_ID,
        bucket=stock_ledger.StockBucket.SALEABLE,
    )
    for _ in range(2):
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_movement(s, pid, **kw)
            await s.commit()
    assert len(await _movements(pid)) == 1
    assert await _stock(pid) == 5


# ═══════════ W6 · update_product → ADMIN_ADJUSTMENT ═══════════


async def test_w6_admin_duzeltmesi_hareket_yazar(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as s:
        await store_service.update_product(
            s,
            pid,
            ProductUpdate(stock=25, stock_reason_code="TEDARIK"),
            admin_id=ADMIN_ID,
        )
    rows = await _movements(pid)
    assert len(rows) == 1
    mv = rows[0]
    assert mv.movement_type == StockMovementType.ADMIN_ADJUSTMENT.value
    assert mv.reason_code == "TEDARIK"
    assert mv.qty_delta == 15 and mv.qty_after == 25
    assert mv.actor_type == "ADMIN" and mv.actor_id == ADMIN_ID
    assert mv.idempotency_key is None      # elle düzeltmenin doğal anahtarı yok
    assert await _stock(pid) == 25


async def test_w6_gerekce_zorunlu(fab):
    from fastapi import HTTPException

    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await store_service.update_product(
                s, pid, ProductUpdate(stock=25), admin_id=ADMIN_ID
            )
        assert exc.value.status_code == 400
        await s.rollback()
    assert await _movements(pid) == []
    assert await _stock(pid) == 10


async def test_w6_diger_gerekcesinde_not_zorunlu(fab):
    from fastapi import HTTPException

    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException):
            await store_service.update_product(
                s, pid,
                ProductUpdate(stock=25, stock_reason_code="DIGER"),
                admin_id=ADMIN_ID,
            )
        await s.rollback()
    async with AsyncSessionLocal() as s:
        await store_service.update_product(
            s, pid,
            ProductUpdate(stock=25, stock_reason_code="DIGER", stock_note="depo sayımı"),
            admin_id=ADMIN_ID,
        )
    rows = await _movements(pid)
    assert len(rows) == 1 and rows[0].note == "depo sayımı"


async def test_w6_ayni_hedef_tekrari_no_op(fab):
    """Sıfır delta hareket yazmaz ve gerekçe de istemez."""
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as s:
        detay = await store_service.update_product(
            s, pid, ProductUpdate(stock=10), admin_id=ADMIN_ID
        )
    assert detay.stock == 10
    assert await _movements(pid) == []


async def test_w6_dijital_urunde_400(fab):
    from fastapi import HTTPException

    pid = await fab.urun(stock=0, kind="DIGITAL")
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await store_service.update_product(
                s, pid,
                ProductUpdate(stock=5, stock_reason_code="TEDARIK"),
                admin_id=ADMIN_ID,
            )
        assert exc.value.status_code == 400
        await s.rollback()
    assert await _movements(pid) == []


async def test_w6_stok_disi_alanlar_gerekce_istemez(fab):
    """Davranış regresyonu: fiyat/başlık güncellemesi eskisi gibi çalışır."""
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as s:
        detay = await store_service.update_product(
            s, pid, ProductUpdate(price=Decimal("77.50")), admin_id=ADMIN_ID
        )
    assert Decimal(detay.price) == Decimal("77.50")
    assert await _movements(pid) == []


# ═══════════ W1 · _finalize_paid → SALE ═══════════


async def test_w1_paid_kalem_basina_SALE_yazar(fab):
    a = await fab.urun(stock=20)
    b = await fab.urun(stock=20)
    oid = await fab.siparis([(a, 3), (b, 2)], paid=False)

    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._finalize_paid(s, order, provider_ref="ref")
        await s.commit()

    async with AsyncSessionLocal() as s:
        kalemler = dict(
            (
                await s.execute(
                    text(
                        "SELECT product_id, id FROM order_items WHERE order_id = :o"
                    ),
                    {"o": oid},
                )
            ).all()
        )
    for pid, adet in ((a, 3), (b, 2)):
        rows = await _movements(pid)
        assert len(rows) == 1
        mv = rows[0]
        assert mv.movement_type == StockMovementType.SALE.value
        assert mv.reason_code == "ORDER_PAID"
        assert mv.qty_delta == -adet
        assert mv.ref_type == "order" and mv.ref_id == oid
        assert mv.ref_line_id == kalemler[pid]
        assert mv.idempotency_key == f"order_item:{kalemler[pid]}:SALE"
        assert mv.actor_type == "SYSTEM"
        assert await _stock(pid) == 20 - adet


async def test_w1_ayni_urunden_iki_satir_iki_SALE_uretir(fab):
    """Satır bazlı anahtar sayesinde toplama gerekmez; zincir doğru."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 2), (pid, 3)], paid=False)
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._finalize_paid(s, order, provider_ref="ref")
        await s.commit()
    rows = await _movements(pid)
    assert len(rows) == 2
    assert [r.qty_after for r in rows] == [8, 5]
    assert await _stock(pid) == 5
    # `verify_ledger` burada ÇAĞRILMAZ: ürün ham tohumlandığı için (açılış
    # hareketi yok) zincir 0'dan başlamıyor ve tutarsızlık RAPORLANMASI
    # doğrudur. Ölçülen şey zincirleme; onu yukarıdaki [8, 5] iddiası kanıtlıyor.


# ═══════════ W2/W3 · geri yükleme + fazla geri yükleme tavanı ═══════════


async def test_w2_tam_iptal_SALE_CANCEL_yazar(fab):
    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 4)], paid=True)
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._restock(s, order, reason_code="ORDER_CANCELLED")
        await s.commit()
    rows = await _movements(pid)
    assert len(rows) == 1
    mv = rows[0]
    assert mv.movement_type == StockMovementType.SALE_CANCEL.value
    assert mv.reason_code == "ORDER_CANCELLED"
    assert mv.qty_delta == 4
    assert mv.ref_type == "order_item"
    assert mv.idempotency_key == f"order_item:{mv.ref_line_id}:SALE_CANCEL"
    assert await _stock(pid) == 14


async def test_w3_kismi_iade_satir_bazli_RETURN_yazar(fab):
    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 4)], paid=True)
    rid = await fab.iade(oid, product_id=pid, adet=2)
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        ret = (
            await s.execute(
                select(order_service.OrderReturn).where(
                    order_service.OrderReturn.id == rid
                )
            )
        ).scalars().one()
        await s.refresh(ret, attribute_names=["items"])
        await order_service._restock_items(s, order, ret)
        await s.commit()
    rows = await _movements(pid)
    assert len(rows) == 1
    mv = rows[0]
    assert mv.movement_type == StockMovementType.RETURN.value
    assert mv.qty_delta == 2
    assert mv.ref_type == "order_return" and mv.ref_id == rid
    assert mv.idempotency_key == f"return_line:{mv.ref_line_id}:RETURN"
    assert await _stock(pid) == 12


@pytest.mark.parametrize("once_iade", [False, True])
async def test_toplam_geri_yukleme_satisi_ASAMAZ(fab, once_iade):
    """Requirement 6: iki farklı anahtar da geçerli görünür ama toplam sınırlı.

    Sıra ne olursa olsun kalem başına geri yüklenen toplam = satılan.
    """
    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 4)], paid=True)
    rid = await fab.iade(oid, product_id=pid, adet=2)

    async def tam_iptal():
        async with AsyncSessionLocal() as s:
            order = await order_service._load_full(s, oid)
            await order_service._restock(s, order, reason_code="ORDER_CANCELLED")
            await s.commit()

    async def kismi_iade():
        async with AsyncSessionLocal() as s:
            order = await order_service._load_full(s, oid)
            ret = (
                await s.execute(
                    select(order_service.OrderReturn).where(
                        order_service.OrderReturn.id == rid
                    )
                )
            ).scalars().one()
            await s.refresh(ret, attribute_names=["items"])
            await order_service._restock_items(s, order, ret)
            await s.commit()

    if once_iade:
        await kismi_iade()
        await tam_iptal()
    else:
        await tam_iptal()
        await kismi_iade()

    assert await _stock(pid) == 14, "toplam geri yükleme satılanı aştı"
    async with AsyncSessionLocal() as s:
        oi_id = (
            await s.execute(
                text("SELECT id FROM order_items WHERE order_id = :o"), {"o": oid}
            )
        ).scalar_one()
        geri = await stock_ledger.restored_quantity_by_order_item(s, [oi_id])
    assert geri[oi_id] == 4


# ═══════════ İki fazlı iade: stok yalnız sağlayıcı başarılıysa ═══════════


class _RedProvider:
    async def refund(self, *, provider_ref, amount):
        return False


class _KabulProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def refund(self, *, provider_ref, amount):
        self.calls += 1
        return True


async def test_saglayici_reddederse_stok_ARTMAZ(fab, monkeypatch):
    from fastapi import HTTPException
    from core import payments

    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 4)], paid=True)
    monkeypatch.setattr(payments, "get_payment_provider", lambda: _RedProvider())

    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        with pytest.raises(HTTPException) as exc:
            await order_service._refund_payment(
                s, order, reason_code="ORDER_REFUNDED",
                terminal_status="REFUNDED", changed_by="admin",
            )
        assert exc.value.status_code == 502

    assert await _movements(pid) == [], "para dönmemişken stok arttı"
    assert await _stock(pid) == 10


async def test_saglayici_basarili_ama_ikinci_faz_coktu_retry_tek_uygular(
    fab, monkeypatch
):
    """Sağlayıcı iade etti, DB tarafı çöktü → retry hareketi TEK KEZ uygular."""
    from core import payments

    pid = await fab.urun(stock=10)
    oid = await fab.siparis([(pid, 4)], paid=True)
    provider = _KabulProvider()
    monkeypatch.setattr(payments, "get_payment_provider", lambda: provider)

    # 1. deneme: telafiler uygulanır ama commit edilmeden çökme simüle edilir.
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._refund_payment(
            s, order, reason_code="ORDER_REFUNDED",
            terminal_status="REFUNDED", changed_by="admin",
        )
        await s.rollback()          # ← ikinci transaction çöktü

    assert await _movements(pid) == []
    assert await _stock(pid) == 10

    # 2. deneme (retry): sipariş REFUNDING'de; telafiler yeniden uygulanır.
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._restock(s, order, reason_code="ORDER_REFUNDED")
        await s.commit()
    # 3. deneme (aynı retry tekrar): aynı anahtar → ikinci hareket YOK.
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        await order_service._restock(s, order, reason_code="ORDER_REFUNDED")
        await s.commit()

    rows = await _movements(pid)
    assert len(rows) == 1, "retry ikinci hareketi yazdı"
    assert await _stock(pid) == 14
