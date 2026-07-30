"""Stok hareket defteri — GERÇEK Postgres eşzamanlılık testleri (Karar 8/9).

Bu dosyadaki her test bir **yarış** kurar. Defterin asıl iddiası burada
sınanıyor: aynı sayı ne kaybolur (kayıp güncelleme) ne iki kez uygulanır
(çift uygulama), ve iki aktör aynı ürüne dokunduğunda kilit onları serileştirir.

İzolasyon deseni ve teardown için `test_stock_ledger_pg.py` başlığına bakın.
Paketin ilk commit'i olduğu için implementasyon yok: koşum kırmızıdır.
"""
from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from core.database import AsyncSessionLocal
from models.store import Product, StockMovement
from services import stock_ledger
from services.stock_ledger import IdempotencyConflict, StockMovementType


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class ProductFactory:
    def __init__(self) -> None:
        self.product_ids: list[int] = []

    async def product(self, *, stock: int = 0) -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"stok-yaris-{_uniq()}",
                title=f"Yarış Testi {_uniq()}",
                kind="PHYSICAL",
                seller_type="PLATFORM",
                price=Decimal("100.00"),
                stock=stock,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            p.sku = stock_ledger.make_sku("PHYSICAL", p.id)
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


async def _count(product_id: int, **filtreler) -> int:
    async with AsyncSessionLocal() as s:
        q = select(func.count()).where(StockMovement.product_id == product_id)
        for k, v in filtreler.items():
            q = q.where(getattr(StockMovement, k) == v)
        return (await s.execute(q)).scalar_one()


async def _apply_in_own_tx(product_id: int, *, before=None, **kw):
    """Kendi session/transaction'ında uygular. `before` kilit ALINDIKTAN sonra
    beklemek için kullanılır (yarış penceresini deterministik yapar)."""
    async with AsyncSessionLocal() as s:
        if before is not None:
            await before()
        mv = await stock_ledger.apply_movement(s, product_id, **kw)
        await s.commit()
        return mv


# ───────────── 1. Aynı idempotency anahtarının eşzamanlı iki çağrısı ─────────────

async def test_ayni_anahtarin_eszamanli_iki_cagrisi_tek_satir_yazar(urun):
    """Ödeme callback'inin iki kez düşmesi / tarayıcı çift POST senaryosu."""
    pid = await urun.product(stock=10)
    kw = dict(
        qty_delta=-2,
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=8101,
        idempotency_key=f"order:8101:product:{pid}:SALE",
    )
    sonuclar = await asyncio.gather(
        _apply_in_own_tx(pid, **kw),
        _apply_in_own_tx(pid, **kw),
        return_exceptions=True,
    )
    # Hiçbiri hata vermemeli: ikisi de "aynı işlem"dir.
    assert not any(isinstance(r, Exception) for r in sonuclar), sonuclar
    assert await _count(pid) == 1
    assert await _stock(pid) == 8  # ÇİFT düşüm yok


async def test_ayni_anahtar_eszamanli_farkli_payload_biri_catisir(urun):
    pid = await urun.product(stock=10)
    key = f"order:8102:product:{pid}:SALE"
    ortak = dict(
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=8102,
        idempotency_key=key,
    )
    sonuclar = await asyncio.gather(
        _apply_in_own_tx(pid, qty_delta=-2, **ortak),
        _apply_in_own_tx(pid, qty_delta=-3, **ortak),
        return_exceptions=True,
    )
    catismalar = [r for r in sonuclar if isinstance(r, IdempotencyConflict)]
    assert len(catismalar) == 1, f"tam olarak biri çatışmalı: {sonuclar}"
    assert await _count(pid) == 1
    # Kazanan hangisi olursa olsun stok TEK hareket kadar düşmüş olmalı.
    assert await _stock(pid) in (7, 8)


# ───────────── 2. Kayıp güncelleme: admin düzeltmesi ⟂ satış (F2) ─────────────

async def test_admin_duzeltmesi_ile_satis_ikisi_de_uygulanir(urun):
    """Bugünkü hatanın nöbetçisi.

    `update_product` satırı kilitlemeden mutlak atama yaptığı için, admin
    "stok 50 olsun" derken eşzamanlı bir PAID 2 adet düşürdüğünde düşüm
    SESSİZCE eziliyordu. Defter delta yazdığı ve kilit altında çalıştığı için
    artık ikisi de uygulanmak zorunda.
    """
    pid = await urun.product(stock=10)
    kilit_alindi = asyncio.Event()
    devam = asyncio.Event()

    async def satis():
        async with AsyncSessionLocal() as s:
            mv = await stock_ledger.apply_movement(
                s,
                pid,
                qty_delta=-2,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID",
                ref_type="order",
                ref_id=8201,
                idempotency_key=f"order:8201:product:{pid}:SALE",
            )
            kilit_alindi.set()
            await devam.wait()   # kilidi TUTARAK bekle
            await s.commit()
            return mv

    async def admin_duzeltmesi():
        await kilit_alindi.wait()
        devam.set()
        # Satış transaction'ı commit edene dek bu çağrı kilitte bekler.
        async with AsyncSessionLocal() as s:
            mv = await stock_ledger.apply_movement(
                s,
                pid,
                qty_delta=15,
                movement_type=StockMovementType.ADMIN_ADJUSTMENT,
                reason_code="TEDARIK",
                actor_type="ADMIN",
                actor_id=1,
            )
            await s.commit()
            return mv

    satis_mv, admin_mv = await asyncio.gather(satis(), admin_duzeltmesi())
    assert satis_mv is not None and admin_mv is not None
    # 10 - 2 + 15 = 23. Kayıp güncelleme olsaydı 25 (satış ezilmiş) çıkardı.
    assert await _stock(pid) == 23
    assert admin_mv.qty_after == 23
    assert await _count(pid) == 2


# ───────────── 3. Retry ─────────────

async def test_retry_ayni_cagriyi_tekrarlarsa_tek_satir(urun):
    pid = await urun.product(stock=5)
    kw = dict(
        qty_delta=-1,
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=8301,
        idempotency_key=f"order:8301:product:{pid}:SALE",
    )
    for _ in range(3):
        await _apply_in_own_tx(pid, **kw)
    assert await _count(pid) == 1
    assert await _stock(pid) == 4


# ───────────── 4. İptal + iade yarışı ─────────────

async def test_iptal_ve_iade_yarisi_iki_gecerli_hareket_uretir(urun):
    """İki farklı anahtar → ikisi de meşru; zincir sırayı gösterir."""
    pid = await urun.product(stock=0)
    sonuclar = await asyncio.gather(
        _apply_in_own_tx(
            pid,
            qty_delta=2,
            movement_type=StockMovementType.SALE_CANCEL,
            reason_code="ORDER_CANCELLED",
            ref_type="order",
            ref_id=8401,
            idempotency_key=f"order:8401:product:{pid}:SALE_CANCEL",
        ),
        _apply_in_own_tx(
            pid,
            qty_delta=1,
            movement_type=StockMovementType.RETURN,
            reason_code="RETURN_ACCEPTED",
            ref_type="order_return",
            ref_id=8402,
            ref_line_id=911,
            idempotency_key="return_line:911:RETURN",
        ),
        return_exceptions=True,
    )
    assert not any(isinstance(r, Exception) for r in sonuclar), sonuclar
    assert await _count(pid) == 2
    assert await _stock(pid) == 3
    async with AsyncSessionLocal() as s:
        assert (await stock_ledger.verify_ledger(s, pid)).consistent is True


# ───────────── 5. Çapraz ürün deadlock'u (Karar 8) ─────────────

@pytest.mark.parametrize("tur", range(3))
async def test_capraz_urunlu_iki_islem_deadlock_uretmez(urun, tur):
    """İki sipariş aynı iki ürüne TERS sırayla dokunuyor.

    `apply_many` ürünleri artan `product_id` sırasıyla kilitlediği için
    deadlock oluşmaz. Sıralama kaldırılırsa bu test (tekrarlı koşumda)
    `DeadlockDetected` ile kırılır. Yarış olduğu için 3 tur koşulur.
    """
    a = await urun.product(stock=20)
    b = await urun.product(stock=20)
    assert a < b

    def spec(order_id: int, pid: int) -> dict:
        return dict(
            product_id=pid,
            qty_delta=-1,
            movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID",
            ref_type="order",
            ref_id=order_id,
            idempotency_key=f"order:{order_id}:product:{pid}:SALE",
        )

    async def siparis(order_id: int, sira: list[int]):
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_many(s, [spec(order_id, p) for p in sira])
            await s.commit()

    oid = 8500 + tur * 10
    sonuclar = await asyncio.gather(
        siparis(oid, [a, b]),
        siparis(oid + 1, [b, a]),   # TERS sıra
        return_exceptions=True,
    )
    assert not any(isinstance(r, Exception) for r in sonuclar), sonuclar
    assert await _stock(a) == 18
    assert await _stock(b) == 18


# ───────────── 6. Aynı ürüne iki eşzamanlı satış ─────────────

async def test_iki_farkli_siparis_ayni_urunu_dogru_dusurur(urun):
    """Kilit serileştirir; iki farklı anahtar iki geçerli düşümdür."""
    pid = await urun.product(stock=5)
    sonuclar = await asyncio.gather(
        _apply_in_own_tx(
            pid, qty_delta=-2, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=8601,
            idempotency_key=f"order:8601:product:{pid}:SALE",
        ),
        _apply_in_own_tx(
            pid, qty_delta=-3, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=8602,
            idempotency_key=f"order:8602:product:{pid}:SALE",
        ),
        return_exceptions=True,
    )
    assert not any(isinstance(r, Exception) for r in sonuclar), sonuclar
    assert await _stock(pid) == 0
    async with AsyncSessionLocal() as s:
        assert (await stock_ledger.verify_ledger(s, pid)).consistent is True


async def test_stok_yetmezse_ikinci_satis_yetersiz_stokla_biter(urun):
    """Kilit altında ikinci satış eksiği GÖRÜR; kırpma yok, hata var."""
    from services.stock_ledger import InsufficientStock

    pid = await urun.product(stock=3)
    sonuclar = await asyncio.gather(
        _apply_in_own_tx(
            pid, qty_delta=-2, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=8701,
            idempotency_key=f"order:8701:product:{pid}:SALE",
        ),
        _apply_in_own_tx(
            pid, qty_delta=-2, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=8702,
            idempotency_key=f"order:8702:product:{pid}:SALE",
        ),
        return_exceptions=True,
    )
    hatalar = [r for r in sonuclar if isinstance(r, InsufficientStock)]
    assert len(hatalar) == 1, f"tam olarak biri yetersiz stok almalı: {sonuclar}"
    assert await _stock(pid) == 1
    assert await _count(pid) == 1
