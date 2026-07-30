"""Stok hareket defteri — GERÇEK Postgres değişmezleri.

Kurulum ve güvenlik kilidi için `tests/integration/conftest.py`'a bakın
(`pg` fixture'ı `assert_test_database()` çağırır).

## İzolasyon deseni

Defter **append-only** olduğu ve satırları DB trigger'ıyla korunduğu için
testler satır silmez. Onun yerine her test **kendi ürününü** üretir ve teardown'da
ürünü **soft-delete** eder; hareket satırları kalır. Bütün doğrulamalar ürün
bazlıdır, hiçbiri global satır sayısına bakmaz — bu, `TRUNCATE`'in dev DB'nin
gerçek defterini silmesini de önler.

Paketin ilk commit'i olduğu için implementasyon yok: koşum kırmızıdır.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from core.database import AsyncSessionLocal
from models.store import Product, StockMovement
from services import stock_ledger
from services.stock_ledger import (
    IdempotencyConflict,
    InsufficientStock,
    StockMovementType,
)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class ProductFactory:
    """Test ürünü üretir; teardown'da soft-delete eder (defter satırları kalır)."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []

    async def product(self, *, kind: str = "PHYSICAL", stock: int | None = 0) -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"stok-test-{_uniq()}",
                title=f"Stok Testi {_uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal("100.00"),
                stock=stock,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            p.sku = stock_ledger.make_sku(kind, p.id)
            await s.commit()
            self.product_ids.append(p.id)
            return p.id

    async def cleanup(self) -> None:
        if not self.product_ids:
            return
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE products SET deleted_at = now() "
                    "WHERE id = ANY(:ids) AND deleted_at IS NULL"
                ),
                {"ids": self.product_ids},
            )
            await s.commit()


@pytest.fixture
async def urun(pg) -> ProductFactory:
    f = ProductFactory()
    yield f
    await f.cleanup()


async def _stock(product_id: int) -> int | None:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Product.stock).where(Product.id == product_id))
        ).scalar_one()


async def _movements(product_id: int) -> list[StockMovement]:
    async with AsyncSessionLocal() as s:
        return list(
            (
                await s.execute(
                    select(StockMovement)
                    .where(StockMovement.product_id == product_id)
                    .order_by(StockMovement.id)
                )
            ).scalars()
        )


async def _apply(product_id: int, **kw) -> StockMovement | None:
    """Tek transaction'da uygula ve commit et (çağıranın rolünü taklit eder)."""
    async with AsyncSessionLocal() as s:
        mv = await stock_ledger.apply_movement(s, product_id, **kw)
        await s.commit()
        return mv


# ───────────────── Temel yazım ve zincir (Karar 9) ─────────────────

async def test_ilk_stok_deftere_yazilir(urun):
    pid = await urun.product(stock=0)
    mv = await _apply(
        pid,
        qty_delta=10,
        movement_type=StockMovementType.INITIAL,
        reason_code="PRODUCT_CREATE",
        ref_type="product",
        ref_id=pid,
        idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN",
        actor_id=1,
    )
    assert mv is not None
    assert mv.qty_delta == 10
    assert mv.qty_after == 10
    assert await _stock(pid) == 10


async def test_qty_after_commit_sonrasi_okunan_stokla_ayni(urun):
    """Karar 9: hareketin qty_after'ı, transaction'da GERÇEKTEN yazılan stok."""
    pid = await urun.product(stock=20)
    mv = await _apply(
        pid,
        qty_delta=-3,
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=9001,
        idempotency_key=f"order:9001:product:{pid}:SALE",
    )
    assert mv is not None
    assert mv.qty_after == await _stock(pid) == 17


async def test_zincir_tutarli_ve_dogrulama_gecer(urun):
    pid = await urun.product(stock=0)
    await _apply(
        pid, qty_delta=10, movement_type=StockMovementType.INITIAL,
        reason_code="PRODUCT_CREATE", ref_type="product", ref_id=pid,
        idempotency_key=f"product:{pid}:INITIAL", actor_type="ADMIN", actor_id=1,
    )
    await _apply(
        pid, qty_delta=-4, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9002,
        idempotency_key=f"order:9002:product:{pid}:SALE",
    )
    await _apply(
        pid, qty_delta=4, movement_type=StockMovementType.SALE_CANCEL,
        reason_code="ORDER_CANCELLED", ref_type="order", ref_id=9002,
        idempotency_key=f"order:9002:product:{pid}:SALE_CANCEL",
    )
    rows = await _movements(pid)
    assert [m.qty_after for m in rows] == [10, 6, 10]
    async with AsyncSessionLocal() as s:
        sonuc = await stock_ledger.verify_ledger(s, pid)
    assert sonuc.consistent is True


async def test_elle_degistirilen_stok_sapma_olarak_raporlanir(urun):
    """Defter engelleyici değil; ama açıklanamayan bakiyeyi GÖRÜNÜR yapar."""
    pid = await urun.product(stock=0)
    await _apply(
        pid, qty_delta=5, movement_type=StockMovementType.INITIAL,
        reason_code="PRODUCT_CREATE", ref_type="product", ref_id=pid,
        idempotency_key=f"product:{pid}:INITIAL", actor_type="ADMIN", actor_id=1,
    )
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET stock = 99 WHERE id = :i"), {"i": pid}
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        sonuc = await stock_ledger.verify_ledger(s, pid)
    assert sonuc.consistent is False


# ───────────────── Yetersiz stok (Karar 5) ─────────────────

async def test_yetersiz_stok_hareket_yazmaz_stok_degismez(urun):
    pid = await urun.product(stock=2)
    with pytest.raises(InsufficientStock):
        await _apply(
            pid,
            qty_delta=-3,
            movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID",
            ref_type="order",
            ref_id=9003,
            idempotency_key=f"order:9003:product:{pid}:SALE",
        )
    # İki iddia birlikte önemli: ne kırpılmış hareket, ne değişmiş bakiye.
    assert await _movements(pid) == []
    assert await _stock(pid) == 2


async def test_tam_sinir_gecerli(urun):
    """Stoğu sıfıra indiren satış meşrudur; yetersizlik DEĞİLDİR."""
    pid = await urun.product(stock=2)
    mv = await _apply(
        pid, qty_delta=-2, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9004,
        idempotency_key=f"order:9004:product:{pid}:SALE",
    )
    assert mv is not None and mv.qty_after == 0
    assert await _stock(pid) == 0


async def test_admin_hedefi_negatife_cekemez(urun):
    pid = await urun.product(stock=1)
    with pytest.raises(InsufficientStock):
        await _apply(
            pid,
            qty_delta=-5,
            movement_type=StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="SAYIM_FARKI",
            actor_type="ADMIN",
            actor_id=1,
        )
    assert await _stock(pid) == 1


# ───────────────── Idempotency (Karar 7) ─────────────────

async def test_ayni_anahtar_ayni_payload_mevcut_hareketi_dondurur(urun):
    pid = await urun.product(stock=10)
    kw = dict(
        qty_delta=-2,
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=9005,
        idempotency_key=f"order:9005:product:{pid}:SALE",
    )
    ilk = await _apply(pid, **kw)
    ikinci = await _apply(pid, **kw)
    assert ilk is not None and ikinci is not None
    assert ilk.id == ikinci.id
    assert len(await _movements(pid)) == 1
    assert await _stock(pid) == 8  # ikinci çağrı stoğu TEKRAR düşürmedi


async def test_ayni_anahtar_farkli_payload_catisma_uretir(urun):
    """Sessizce yutulmaz: aynı anahtarla farklı sayı gelmesi bir hatadır."""
    pid = await urun.product(stock=10)
    key = f"order:9006:product:{pid}:SALE"
    await _apply(
        pid, qty_delta=-2, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9006,
        idempotency_key=key,
    )
    with pytest.raises(IdempotencyConflict):
        await _apply(
            pid, qty_delta=-3, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=9006,
            idempotency_key=key,
        )
    assert await _stock(pid) == 8


async def test_ayni_anahtar_farkli_tip_catisma_uretir(urun):
    pid = await urun.product(stock=10)
    key = f"order:9007:product:{pid}:SALE"
    await _apply(
        pid, qty_delta=-2, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9007,
        idempotency_key=key,
    )
    with pytest.raises(IdempotencyConflict):
        await _apply(
            pid, qty_delta=-2, movement_type=StockMovementType.SALE_CANCEL,
            reason_code="ORDER_CANCELLED", ref_type="order", ref_id=9007,
            idempotency_key=key,
        )


async def test_ayni_referans_farkli_urun_iki_gecerli_hareket(urun):
    """(ref_type, ref_id) tek başına UNIQUE DEĞİL: sipariş çok ürün taşır."""
    a = await urun.product(stock=5)
    b = await urun.product(stock=5)
    await _apply(
        a, qty_delta=-1, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9008,
        idempotency_key=f"order:9008:product:{a}:SALE",
    )
    await _apply(
        b, qty_delta=-1, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9008,
        idempotency_key=f"order:9008:product:{b}:SALE",
    )
    assert len(await _movements(a)) == 1
    assert len(await _movements(b)) == 1


async def test_ayni_urunden_iki_iade_satiri_iki_hareket(urun):
    """Kısmi iadede idempotency kaynağı iade SATIRIdır."""
    pid = await urun.product(stock=0)
    for satir_id, adet in ((501, 1), (502, 2)):
        await _apply(
            pid, qty_delta=adet, movement_type=StockMovementType.RETURN,
            reason_code="RETURN_ACCEPTED", ref_type="order_return", ref_id=77,
            ref_line_id=satir_id, idempotency_key=f"return_line:{satir_id}:RETURN",
        )
    rows = await _movements(pid)
    assert len(rows) == 2
    assert {r.ref_line_id for r in rows} == {501, 502}
    assert await _stock(pid) == 3


async def test_admin_duzeltmesi_anahtarsiz_ve_tekrarlanabilir(urun):
    """`idempotency_key IS NULL` satırlar UNIQUE index'te çakışmaz."""
    pid = await urun.product(stock=0)
    for _ in range(3):
        await _apply(
            pid, qty_delta=1, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="TEDARIK", actor_type="ADMIN", actor_id=1,
        )
    assert len(await _movements(pid)) == 3
    assert await _stock(pid) == 3


# ───────────────── Yazılmayan durumlar ─────────────────

async def test_stok_takibi_kapali_urunde_hareket_yazilmaz(urun):
    pid = await urun.product(kind="DIGITAL", stock=None)
    mv = await _apply(
        pid, qty_delta=-1, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=9009,
        idempotency_key=f"order:9009:product:{pid}:SALE",
    )
    assert mv is None
    assert await _movements(pid) == []
    assert await _stock(pid) is None


async def test_sifir_delta_gurultu_satiri_yazmaz(urun):
    """Admin aynı değeri tekrar kaydederse defter kirlenmez."""
    pid = await urun.product(stock=5)
    mv = await _apply(
        pid, qty_delta=0, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
        reason_code="SAYIM_FARKI", actor_type="ADMIN", actor_id=1,
    )
    assert mv is None
    assert await _movements(pid) == []


async def test_acilis_bakiyesi_sifir_stokta_da_satir_yazar(urun):
    """Zincirin tabanı her ürün için var olmalı."""
    pid = await urun.product(stock=0)
    mv = await _apply(
        pid, qty_delta=0, movement_type=StockMovementType.OPENING_BALANCE,
        reason_code="MIGRATION_OPENING", ref_type="migration",
        idempotency_key=f"migration:test:product:{pid}",
    )
    assert mv is not None and mv.qty_after == 0


# ───────────────── DB kısıtları (ham SQL ile) ─────────────────

async def _raw_insert(product_id: int, **cols) -> None:
    varsayilan = dict(
        product_id=product_id,
        qty_delta=1,
        qty_after=1,
        movement_type="ADMIN_ADJUSTMENT",
        reason_code="TEDARIK",
        ref_type=None,
        ref_id=None,
        ref_line_id=None,
        idempotency_key=None,
        actor_type="ADMIN",
        actor_id=1,
        note=None,
        request_id=None,
    )
    varsayilan.update(cols)
    kolonlar = ", ".join(varsayilan)
    yerler = ", ".join(f":{k}" for k in varsayilan)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(f"INSERT INTO stock_movements ({kolonlar}) VALUES ({yerler})"),
            varsayilan,
        )
        await s.commit()


@pytest.mark.parametrize(
    "kolonlar,ihlal",
    [
        ({"qty_after": -1}, "ck_stock_movements_after"),
        ({"qty_delta": 0}, "ck_stock_movements_delta"),
        ({"movement_type": "HAYALI"}, "ck_stock_movements_type"),
        ({"actor_type": "ROBOT"}, "ck_stock_movements_actor_t"),
        ({"actor_type": "ADMIN", "actor_id": None}, "ck_stock_movements_actor_id"),
        ({"reason_code": "CANIM_ISTEDI"}, "ck_stock_movements_adjust"),
        ({"reason_code": "DIGER", "note": None}, "ck_stock_movements_note"),
        ({"reason_code": "DIGER", "note": "   "}, "ck_stock_movements_note"),
        (
            {"movement_type": "SALE", "reason_code": "ORDER_PAID", "ref_type": None,
             "ref_id": None, "actor_type": "SYSTEM", "actor_id": None},
            "ck_stock_movements_ref",
        ),
        (
            {"movement_type": "RETURN", "reason_code": "RETURN_ACCEPTED",
             "ref_type": "order_return", "ref_id": 1, "ref_line_id": None,
             "actor_type": "SYSTEM", "actor_id": None},
            "ck_stock_movements_refline",
        ),
    ],
)
async def test_check_kisitlari_reddediyor(urun, kolonlar, ihlal):
    pid = await urun.product(stock=1)
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        await _raw_insert(pid, **kolonlar)
    assert ihlal in str(exc.value)


async def test_idempotency_anahtari_unique(urun):
    pid = await urun.product(stock=1)
    await _raw_insert(pid, idempotency_key="tekil-anahtar")
    with pytest.raises((IntegrityError, DBAPIError)):
        await _raw_insert(pid, idempotency_key="tekil-anahtar")


# ───────────────── Değiştirilemezlik trigger'ı (Karar 3) ─────────────────

async def test_trigger_update_reddediyor(urun):
    pid = await urun.product(stock=1)
    await _raw_insert(pid, note="ilk")
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE stock_movements SET note = 'degistirildi' "
                     "WHERE product_id = :i"),
                {"i": pid},
            )
            await s.commit()
    assert "append-only" in str(exc.value).lower()


async def test_trigger_delete_reddediyor(urun):
    pid = await urun.product(stock=1)
    await _raw_insert(pid)
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM stock_movements WHERE product_id = :i"), {"i": pid}
            )
            await s.commit()
    assert "append-only" in str(exc.value).lower()


async def test_hareketi_olan_urun_fiziksel_silinemez(urun):
    """FK RESTRICT: defter yetim kalamaz (ürün soft-delete edilir)."""
    pid = await urun.product(stock=1)
    await _raw_insert(pid)
    with pytest.raises((IntegrityError, DBAPIError)):
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM products WHERE id = :i"), {"i": pid})
            await s.commit()


# ───────────────── SKU (Karar 1) ─────────────────

async def test_sku_urun_id_sinin_fonksiyonu(urun):
    pid = await urun.product(kind="PHYSICAL")
    async with AsyncSessionLocal() as s:
        sku = (
            await s.execute(select(Product.sku).where(Product.id == pid))
        ).scalar_one()
    assert sku == f"FZK-{pid:06d}"


async def test_sku_unique(urun):
    pid = await urun.product()
    async with AsyncSessionLocal() as s:
        mevcut = (
            await s.execute(select(Product.sku).where(Product.id == pid))
        ).scalar_one()
        with pytest.raises((IntegrityError, DBAPIError)):
            s.add(
                Product(
                    slug=f"stok-test-{_uniq()}",
                    title="Çakışan SKU",
                    kind="PHYSICAL",
                    seller_type="PLATFORM",
                    price=Decimal("10.00"),
                    stock=0,
                    status="ACTIVE",
                    sku=mevcut,
                )
            )
            await s.commit()


async def test_hareket_listesi_yalniz_istenen_urunu_dondurur(urun):
    """IDOR: başka ürünün defteri sızmamalı."""
    a = await urun.product(stock=0)
    b = await urun.product(stock=0)
    await _apply(
        a, qty_delta=3, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
        reason_code="TEDARIK", actor_type="ADMIN", actor_id=1,
    )
    await _apply(
        b, qty_delta=9, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
        reason_code="TEDARIK", actor_type="ADMIN", actor_id=1,
    )
    async with AsyncSessionLocal() as s:
        sonuc = await stock_ledger.list_movements(s, a, limit=50, offset=0)
    assert {r.product_id for r in sonuc.rows} == {a}
    assert sonuc.total == 1


async def test_barcode_unique_ama_bos_birakilabilir(urun):
    a = await urun.product()
    b = await urun.product()
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET barcode = '9780000000001' WHERE id = :i"),
            {"i": a},
        )
        await s.commit()
    with pytest.raises((IntegrityError, DBAPIError)):
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET barcode = '9780000000001' WHERE id = :i"),
                {"i": b},
            )
            await s.commit()
