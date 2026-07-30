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
from services.stock_ledger import (
    IdempotencyConflict,
    InsufficientStock,
    PartialIdempotencyState,
    StockMovementType,
)


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
            await s.refresh(p, ["sku"])
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


# ───────────── 7. Toplu (batch) idempotency — Karar 2 (rev. 3) ─────────────

def _sale_spec(order_id: int, pid: int, qty: int = 1) -> dict:
    return dict(
        product_id=pid,
        qty_delta=-qty,
        movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID",
        ref_type="order",
        ref_id=order_id,
        idempotency_key=f"order:{order_id}:product:{pid}:SALE",
    )


async def _apply_many_tx(specs: list[dict]):
    async with AsyncSessionLocal() as s:
        out = await stock_ledger.apply_many(s, specs)
        await s.commit()
        return out


async def test_batch_tekrarinda_hicbir_yeni_satir_yazilmaz(urun):
    """Aynı sipariş iki kez finalize edilirse defter büyümez."""
    a = await urun.product(stock=10)
    b = await urun.product(stock=10)
    specs = [_sale_spec(8801, a, 2), _sale_spec(8801, b, 3)]

    ilk = await _apply_many_tx(specs)
    ikinci = await _apply_many_tx(specs)

    assert [m.id for m in ilk] == [m.id for m in ikinci], (
        "tekrar mevcut hareketleri döndürmeli"
    )
    assert await _count(a) == 1 and await _count(b) == 1
    assert await _stock(a) == 8 and await _stock(b) == 7


async def test_batch_tekrarinda_payload_farki_catisma_uretir(urun):
    a = await urun.product(stock=10)
    b = await urun.product(stock=10)
    await _apply_many_tx([_sale_spec(8802, a, 2), _sale_spec(8802, b, 3)])
    with pytest.raises(IdempotencyConflict):
        await _apply_many_tx([_sale_spec(8802, a, 2), _sale_spec(8802, b, 4)])
    assert await _stock(a) == 8 and await _stock(b) == 7


async def test_batch_kismi_durumda_eksikleri_SESSIZCE_uygulamaz(urun):
    """Karar 2: bazıları var bazıları yoksa `PartialIdempotencyState`.

    "Yarısı uygulanmış batch" defterin en tehlikeli hâlidir: her ürünün kendi
    zinciri sağlam görünür ama sipariş ile defter arasındaki ilişki bozuktur.
    Eksiği tamamlamak da kabul edilmez — bu durum insan kararı ister.
    """
    a = await urun.product(stock=10)
    b = await urun.product(stock=10)

    # Yalnız a'nın hareketi var (yarıda kesilmiş yazımın izi).
    await _apply_many_tx([_sale_spec(8803, a, 2)])

    with pytest.raises(PartialIdempotencyState) as exc:
        await _apply_many_tx([_sale_spec(8803, a, 2), _sale_spec(8803, b, 3)])

    assert f"order:8803:product:{b}:SALE" in exc.value.missing_keys
    # b'ye HİÇBİR ŞEY yazılmadı.
    assert await _count(b) == 0
    assert await _stock(b) == 10
    assert await _stock(a) == 8


async def test_batch_anahtarsiz_spec_reddedilir(urun):
    """`apply_many` batch idempotency'sini anahtar olmadan kuramaz."""
    a = await urun.product(stock=5)
    spec = _sale_spec(8804, a)
    spec.pop("idempotency_key")
    with pytest.raises(ValueError):
        await _apply_many_tx([spec])
    assert await _count(a) == 0


# ───────── 8. Bayat kimlik haritası → InsufficientStock (Karar 3, rev. 3) ─────────

async def test_bayat_kimlik_haritasinda_defter_tazeyi_gorur(urun):
    """Ön kontrol "yeterli" derken defterin eksiği gördüğü GERÇEK yarış.

    Session `expire_on_commit=False` ile kurulu. A oturumu ürünü yükleyip
    kimlik haritasına koyar; B oturumu stoğu düşürüp commit eder. A'nın elindeki
    nesne hâlâ ESKİ stoğu gösterir — `populate_existing` olmadan `FOR UPDATE`
    sorgusu da o bayat nesneyi döndürür (backend/CLAUDE.md'de kayıtlı tuzak).

    Defter `populate_existing=True` kullandığı için taze satırı görür ve
    `InsufficientStock` yükseltir; hiçbir hareket yazılmaz.
    """
    pid = await urun.product(stock=3)

    async with AsyncSessionLocal() as a_session:
        # A: ürünü kimlik haritasına al ve ÖN KONTROLÜ burada yap.
        bayat = (
            await a_session.execute(select(Product).where(Product.id == pid))
        ).scalars().one()
        assert bayat.stock == 3
        assert stock_ledger.has_shortage(bayat.stock, 3) is False   # "yeterli"

        # B: araya girip stoğu düşürür ve commit eder.
        await _apply_in_own_tx(
            pid, qty_delta=-2, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=8901,
            idempotency_key=f"order:8901:product:{pid}:SALE",
        )

        # A'nın elindeki nesne HÂLÂ bayat — ön kontrol yanılmış durumda.
        assert bayat.stock == 3

        # Defter tazeyi görür ve reddeder.
        with pytest.raises(InsufficientStock):
            await stock_ledger.apply_movement(
                a_session, pid, qty_delta=-3,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=8902,
                idempotency_key=f"order:8902:product:{pid}:SALE",
            )
        await a_session.rollback()

    assert await _stock(pid) == 1
    assert await _count(pid) == 1   # yalnız B'nin hareketi


# ───────── 9. `_finalize_paid` kurtarma yolu — Karar 3 (rev. 3) ─────────

async def _seed_order(product_id: int, quantity: int) -> tuple[int, int]:
    """Ödeme bekleyen (PENDING) fiziksel sipariş üretir. (order_id, client_id)."""
    async with AsyncSessionLocal() as s:
        client_id = (
            await s.execute(
                text(
                    "INSERT INTO clients (first_name, last_name, email, "
                    "hashed_password, role_id) VALUES ('Stok', 'Yaris', :e, 'x', 3) "
                    "RETURNING id"
                ),
                {"e": f"stok-yaris-{_uniq()}@test.local"},
            )
        ).scalar_one()
        order_id = (
            await s.execute(
                text(
                    "INSERT INTO orders (client_id, subtotal, total, payment_status, "
                    "status, has_physical) VALUES (:c, 100.00, 100.00, 'PENDING', "
                    "'PENDING', true) RETURNING id"
                ),
                {"c": client_id},
            )
        ).scalar_one()
        await s.execute(
            text(
                "INSERT INTO order_items (order_id, product_id, title, unit_price, "
                "quantity, kind, seller_type) VALUES (:o, :p, 'Stok Yarış Kitabı', "
                "100.00, :q, 'PHYSICAL', 'PLATFORM')"
            ),
            {"o": order_id, "p": product_id, "q": quantity},
        )
        await s.commit()
    return order_id, client_id


async def _cleanup_order(order_id: int, client_id: int) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM order_items WHERE order_id = :o"), {"o": order_id})
        await s.execute(text("DELETE FROM orders WHERE id = :o"), {"o": order_id})
        await s.execute(text("DELETE FROM clients WHERE id = :c"), {"c": client_id})
        await s.commit()


async def test_finalize_paid_yetersiz_stokta_PAID_KALMAZ_ve_iadeye_gider(
    urun, monkeypatch, provider
):
    """Karar 3: claim sonrası yarış 500'e dönüşmez, iade akışına yönlendirilir.

    Bu durum ürün satırları kilitli tutulduğu için normalde ULAŞILAMAZ (§1e).
    Testte ön kontrol BİLİNÇLİ olarak devre dışı bırakılıyor — ölçülen şey
    yarışın oluşabilirliği değil, **oluştuğunda kurtarma davranışı**:
      • sipariş PAID KALMAMALI (claim geri alınmalı),
      • hiçbir stok hareketi yazılmamalı,
      • mevcut out-of-stock/iade akışına idempotent biçimde girilmeli.
    """
    from services import order_service

    pid = await urun.product(stock=1)
    order_id, client_id = await _seed_order(pid, quantity=5)   # stoktan FAZLA
    try:
        # Ön kontrolü kör et: "eksik yok" desin (yapısal olarak ulaşılamaz hâli
        # deterministik biçimde kur).
        monkeypatch.setattr(
            order_service.stock_ledger, "has_shortage", lambda mevcut, gereken: False
        )

        async with AsyncSessionLocal() as s:
            order = await order_service._load_full(s, order_id)
            await order_service._finalize_paid(s, order, provider_ref="test-ref")
            await s.commit()

        async with AsyncSessionLocal() as s:
            durum = (
                await s.execute(
                    text("SELECT payment_status, status FROM orders WHERE id = :o"),
                    {"o": order_id},
                )
            ).one()

        # 1) PAID kalmadı.
        assert durum.payment_status != "PAID", (
            "PAID claim'i geri alınmamış — kısmi durum kaldı"
        )
        # 2) Defterde iz yok, stok değişmedi.
        assert await _count(pid) == 0
        assert await _stock(pid) == 1
        # 3) İade akışına girildi (mevcut _out_of_stock_refund yolu).
        assert durum.status == "CANCELLED"
        assert durum.payment_status in ("REFUNDED", "REFUNDING")
        assert provider.refund_calls, "sağlayıcı iadesi çağrılmadı"
    finally:
        await _cleanup_order(order_id, client_id)


async def test_finalize_paid_kurtarma_yolu_idempotent(urun, monkeypatch, provider):
    """Aynı sipariş için ikinci çağrı ikinci bir para hareketi üretmez."""
    from services import order_service

    pid = await urun.product(stock=1)
    order_id, client_id = await _seed_order(pid, quantity=5)
    try:
        monkeypatch.setattr(
            order_service.stock_ledger, "has_shortage", lambda mevcut, gereken: False
        )
        for _ in range(2):
            async with AsyncSessionLocal() as s:
                order = await order_service._load_full(s, order_id)
                await order_service._finalize_paid(s, order, provider_ref="test-ref")
                await s.commit()

        # `escrow.begin_refund` PENDING/FAILED'dan atomik claim yaptığı için
        # ikinci çağrı iadeyi TEKRAR başlatamaz.
        assert len(provider.refund_calls) == 1, provider.refund_calls
        assert await _count(pid) == 0
    finally:
        await _cleanup_order(order_id, client_id)
