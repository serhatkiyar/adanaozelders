"""Stok yollarının KİLİT GRAFİĞİ — gerçek PostgreSQL yarış provaları (commit 4).

## Ne ölçülüyor

Commit 4, `products.stock`'a dokunan dört yolun kilit alışını tek bir yardımcıya
(`stock_ledger.lock_products`) bağladı ve `update_product`'ın kilitsiz mutlak
atamasını delta tabanlı hâle getirdi. Bu dosya iddiayı davranışla sınar:

  1. **sonuç doğru** (kayıp güncelleme yok), ve
  2. **deadlock ya da sonsuz bekleme yok**.

İkinci iddia için her oturum `SET LOCAL lock_timeout` alır: kilit beklemesi
eşiği aşarsa PostgreSQL `LockNotAvailable` (55P03) atar. Böylece bir sıralama
hatası testi ASKIDA BIRAKMAK yerine **kırar**. Deadlock ise `DeadlockDetected`
(40P01) olarak görünür. İkisi de ayrı ayrı yakalanıp raporlanıyor.

Her çift **ters başlatma sırasıyla** ve birkaç tekrar koşar: yarışlar
olasılıksaldır, tek koşum kanıt sayılmaz.

## Kanonik kilit sırası (bu dosyanın dayandığı kural)

    Product → Order → OrderReturn → (Coupon / DeliveryStop)

Ayrıntılı kilit grafiği ve dosya:satır kanıtları:
`docs/stok-hareket-defteri-plani.md` §4e.
"""
from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from core.database import AsyncSessionLocal
from tests.integration.db_guard import purge_products
from models.store import Product, StockMovement
from services import order_service, stock_ledger, store_service
from services.stock_ledger import StockMovementType

#: Kilit beklemesi bu süreyi aşarsa hata (askıda kalma yerine kırılma).
LOCK_TIMEOUT = "4s"

#: Yarışlar olasılıksal; her çift bu kadar tekrar koşar.
TURLAR = 3

#: Admin düzeltmesi artık `actor_id` ZORUNLU kılıyor (defter aktörü).
#: Seed admin'in id'si; hareketin FK'si yok, doğrulama yalnız "None değil".
ADMIN_ID = 1

#: PostgreSQL hata kodları.
DEADLOCK = "40P01"
LOCK_TIMEOUT_CODE = "55P03"


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _pg_code(exc: BaseException) -> str | None:
    for cand in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        code = getattr(cand, "sqlstate", None) or getattr(cand, "pgcode", None)
        if code:
            return code
    return None


def _assert_no_lock_failure(sonuclar) -> None:
    """Deadlock / kilit zaman aşımı OLMAMALI (sonuç doğruluğundan bağımsız iddia)."""
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        code = _pg_code(r)
        if code == DEADLOCK:
            raise AssertionError(f"DEADLOCK (40P01): kilit sırası tutarsız — {r}")
        if code == LOCK_TIMEOUT_CODE:
            raise AssertionError(
                f"kilit zaman aşımı ({LOCK_TIMEOUT}): sonsuz/uzun bekleme — {r}"
            )


async def _session():
    """`lock_timeout`'lu oturum. `SET LOCAL` transaction'a bağlıdır, bu yüzden
    önce transaction açılır."""
    s = AsyncSessionLocal()
    await s.execute(text("BEGIN"))
    await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    return s


# ════════════════════════════ Tohumlama ════════════════════════════


class Fabrika:
    """Ürün/sipariş/iade üretir; teardown'da temizler.

    Ürünler **soft-delete** edilir (defter satırları append-only olduğu için
    ürün fiziksel silinemez — FK RESTRICT). Sipariş/iade satırları fiziksel
    silinir (`db_guard` yalnız test veritabanlarında izin verir).
    """

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.return_ids: list[int] = []

    async def urun(self, *, stock: int) -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"kilit-{_uniq()}",
                title=f"Kilit Testi {_uniq()}",
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

    async def siparis(self, kalemler: list[tuple[int, int]]) -> int:
        """PAID fiziksel sipariş (iptal/iade yollarının girdisi)."""
        async with AsyncSessionLocal() as s:
            cid = (
                await s.execute(
                    text(
                        "INSERT INTO clients (first_name, last_name, username, email,"
                        " hashed_password, role_id) VALUES ('Kilit','Testi',:u,:e,"
                        "'x',3) RETURNING id"
                    ),
                    {"u": f"kilit{_uniq()}", "e": f"kilit-{_uniq()}@test.local"},
                )
            ).scalar_one()
            oid = (
                await s.execute(
                    text(
                        "INSERT INTO orders (client_id, subtotal, total, "
                        "payment_status, status, has_physical, track_token) VALUES "
                        "(:c, 100.00, 100.00, 'PAID', 'PAID', true, :t) RETURNING id"
                    ),
                    {"c": cid, "t": _uniq() + _uniq()},
                )
            ).scalar_one()
            for pid, adet in kalemler:
                await s.execute(
                    text(
                        "INSERT INTO order_items (order_id, product_id, title, "
                        "unit_price, quantity, kind, seller_type) VALUES (:o, :p, "
                        "'Kilit Kitabı', 10.00, :q, 'PHYSICAL', 'PLATFORM')"
                    ),
                    {"o": oid, "p": pid, "q": adet},
                )
            await s.commit()
        self.client_ids.append(cid)
        self.order_ids.append(oid)
        return oid

    async def iade(self, order_id: int, client_id: int, adet: int) -> int:
        """Siparişin İLK kalemi için kısmi iade talebi."""
        async with AsyncSessionLocal() as s:
            item_id = (
                await s.execute(
                    text(
                        "SELECT id FROM order_items WHERE order_id = :o "
                        "ORDER BY id LIMIT 1"
                    ),
                    {"o": order_id},
                )
            ).scalar_one()
            rid = (
                await s.execute(
                    # NOT: `order_returns.reason` modelde `server_default=""`
                    # ile tanimli ama DB kolonunda varsayilan YOK (model<->sema
                    # sapmasi; bu paketin kapsami disinda, uygulama yolu her
                    # zaman `reason` gonderiyor). Tohumda acikca veriliyor.
                    text(
                        "INSERT INTO order_returns (order_id, client_id, reason) "
                        "VALUES (:o, :c, 'kilit testi') RETURNING id"
                    ),
                    {"o": order_id, "c": client_id},
                )
            ).scalar_one()
            await s.execute(
                text(
                    "INSERT INTO order_return_items (return_id, order_item_id, "
                    "quantity, amount) VALUES (:r, :i, :q, 10.00)"
                ),
                {"r": rid, "i": item_id, "q": adet},
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


async def _stock(pid: int) -> int | None:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Product.stock).where(Product.id == pid))
        ).scalar_one()


async def _mv_count(pid: int, *, movement_type: str | None = None) -> int:
    async with AsyncSessionLocal() as s:
        q = select(func.count()).where(StockMovement.product_id == pid)
        if movement_type:
            q = q.where(StockMovement.movement_type == movement_type)
        return (await s.execute(q)).scalar_one()


async def _load_order(s, order_id: int):
    return await order_service._load_full(s, order_id)


# ══════════════ Çift 1: iki çok ürünlü sipariş, ürün sıraları TERS ══════════════


@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("ters_baslat", [False, True])
async def test_cift1_capraz_urun_sirasi_deadlock_uretmez(fab, tur, ters_baslat):
    """`lock_products` artan `id` sırası garantisi.

    Çağıran listeyi TERS verse bile yardımcı sıralar; sıralama kaldırılırsa bu
    test `DeadlockDetected` ile kırılır.
    """
    a = await fab.urun(stock=50)
    b = await fab.urun(stock=50)
    assert a < b

    async def isci(sira: list[int]) -> None:
        s = await _session()
        try:
            kilitli = await stock_ledger.lock_products(s, sira)
            await asyncio.sleep(0.05)          # yarış penceresini genişlet
            for pid in sira:
                kilitli[pid].stock -= 1
            await s.commit()
        finally:
            await s.close()

    isciler = [isci([a, b]), isci([b, a])]
    if ters_baslat:
        isciler.reverse()
    sonuclar = await asyncio.gather(*isciler, return_exceptions=True)
    _assert_no_lock_failure(sonuclar)
    assert not any(isinstance(r, BaseException) for r in sonuclar), sonuclar
    assert await _stock(a) == 48
    assert await _stock(b) == 48


# ══════════ Çift 2: sipariş düşümü ↔ admin stok düzeltmesi (F2) ══════════


@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("ters_baslat", [False, True])
async def test_cift2_satis_ile_admin_duzeltmesi_serilesir(fab, tur, ters_baslat):
    """Satış ↔ admin düzeltmesi: deadlock yok, satış HER HÂLDE kayıtlı.

    ## Neden sonuç tek bir sayı değil

    Admin **mutlak hedef** gönderir ("stok 60 olsun") ve delta kilit altında
    `hedef − mevcut` olarak hesaplanır. Bu yüzden nihai değer sıraya bağlıdır ve
    iki sonuç da DOĞRUDUR:

      * admin önce: 50 → 60 (delta +10), sonra satış −2  → **58**
      * satış önce: 50 → 48 (delta −2), sonra admin → 60 (delta **+12**) → **60**

    İkinci dalda önemli olan, admin'in deltasını 48 üzerinden hesaplaması —
    yani satışı GÖRMESİ. Ölçülen budur; nihai sayıyı tek değere çivilemek
    mutlak-hedef semantiğini yanlış modellemek olurdu.

    ## Dürüstlük notu

    Eski (kilitsiz, mutlak atama) kod bu senaryoda AYNI sayıları üretiyordu:
    hedef 60 yazıldığında sonuç da 60'tı. Kaybın gerçek kanıtı **deftere ne
    yazıldığıdır** (+12 mi, +10 mu) ve o kanıt commit 5'te (`ADMIN_ADJUSTMENT`
    hareketi) oluşur. Bu commit'te bayatlığın kanıtı ayrı bir testte:
    `test_cift2b_bayat_kimlik_haritasi_uzerinden_delta_hesaplanmiyor`.
    """
    pid = await fab.urun(stock=50)

    async def satis() -> None:
        s = await _session()
        try:
            await stock_ledger.apply_movement(
                s, pid, qty_delta=-2,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=771000 + tur,
                idempotency_key=f"kilit:{_uniq()}:sale",
            )
            await asyncio.sleep(0.05)
            await s.commit()
        finally:
            await s.close()

    async def admin_duzeltmesi() -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(text("BEGIN"))
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            from schemas.store import ProductUpdate

            await store_service.update_product(
                s, pid,
                ProductUpdate(stock=60, stock_reason_code="TEDARIK"),
                admin_id=ADMIN_ID,
            )

    isciler = [satis(), admin_duzeltmesi()]
    if ters_baslat:
        isciler.reverse()
    sonuclar = await asyncio.gather(*isciler, return_exceptions=True)
    _assert_no_lock_failure(sonuclar)
    assert not any(isinstance(r, BaseException) for r in sonuclar), sonuclar

    # Satışın hareketi HER HÂLDE yazılmış olmalı; `qty_after` sırayı söyler.
    # (Admin düzeltmesi commit 5'ten beri kendi ADMIN_ADJUSTMENT hareketini
    # yazıyor; burada yalnız SALE'e bakılır.)
    async with AsyncSessionLocal() as s:
        mv = (
            await s.execute(
                select(StockMovement).where(
                    StockMovement.product_id == pid,
                    StockMovement.movement_type == "SALE",
                )
            )
        ).scalars().all()
    assert len(mv) == 1, "satış hareketi kayıp/çift"
    assert await _mv_count(pid, movement_type="ADMIN_ADJUSTMENT") == 1
    satis_sonrasi = mv[0].qty_after
    son = await _stock(pid)
    if satis_sonrasi == 48:          # satış önce koştu → admin 48'i gördü
        assert son == 60, son
    else:                            # admin önce koştu (60) → satış 58'e indirdi
        assert satis_sonrasi == 58, satis_sonrasi
        assert son == 58, son


@pytest.mark.parametrize("tur", range(TURLAR))
async def test_cift2b_bayat_kimlik_haritasi_uzerinden_delta_hesaplanmiyor(fab, tur):
    """Commit 4'ün DECISIVE testi: kilit sonrası satır gerçekten taze.

    Kurulum, `populate_existing` olmadan yakalanamayan tuzağı kurar:

      1. Admin oturumu ürünü **önceden okur** → ORM kimlik haritasında `stock=5`.
      2. Başka bir oturum 5 adet satar ve commit eder → DB'de `stock=0`.
      3. Admin "stok 3 olsun" der.

    Taze okumada delta `3 − 0 = +3` → sonuç 3, hata yok.
    Bayat okumada delta `3 − 5 = −2` → kilitli satıra uygulanınca `0 − 2 = −2`
    → negatif bakiye guard'ı **409** atar.

    Yani bu test yalnız `populate_existing` (veya açık refresh) varsa geçer;
    `stock_ledger.lock_products`'tan o seçenek kaldırılırsa kırılır.
    """
    from fastapi import HTTPException
    from schemas.store import ProductUpdate

    pid = await fab.urun(stock=5)

    async with AsyncSessionLocal() as admin_s:
        # 1. Bayat oku: nesne kimlik haritasına 5 ile girer.
        onceki = (
            await admin_s.execute(select(Product).where(Product.id == pid))
        ).scalars().one()
        assert onceki.stock == 5

        # 2. Araya gir: stoğu sıfıra indir ve commit et.
        s2 = await _session()
        try:
            await stock_ledger.apply_movement(
                s2, pid, qty_delta=-5,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=774000 + tur,
                idempotency_key=f"kilit:{_uniq()}:bayat",
            )
            await s2.commit()
        finally:
            await s2.close()
        assert onceki.stock == 5, "elde tutulan nesne hâlâ bayat (kurulum doğru)"

        # 3. Admin hedefi 3: taze okuma şart.
        await admin_s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        try:
            await store_service.update_product(
                admin_s, pid,
                ProductUpdate(stock=3, stock_reason_code="SAYIM_FARKI"),
                admin_id=ADMIN_ID,
            )
        except HTTPException as exc:
            raise AssertionError(
                f"bayat bakiye üzerinden delta hesaplandı (409: {exc.detail})"
            ) from exc

    assert await _stock(pid) == 3


# ══════════ Çift 3: sipariş düşümü ↔ tam iptal/iade (_restock) ══════════


@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("ters_baslat", [False, True])
async def test_cift3_satis_ile_tam_iade_geri_yuklemesi(fab, tur, ters_baslat):
    """`_restock` (iptal/tam iade) ile eşzamanlı satış."""
    a = await fab.urun(stock=40)
    b = await fab.urun(stock=40)
    oid = await fab.siparis([(a, 3), (b, 2)])

    async def satis() -> None:
        s = await _session()
        try:
            await stock_ledger.apply_movement(
                s, b, qty_delta=-1,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=772000 + tur,
                idempotency_key=f"kilit:{_uniq()}:sale",
            )
            await asyncio.sleep(0.05)
            await s.commit()
        finally:
            await s.close()

    async def iptal_geri_yukleme() -> None:
        s = await _session()
        try:
            order = await _load_order(s, oid)
            await order_service._restock(s, order, reason_code="ORDER_CANCELLED")
            await s.commit()
        finally:
            await s.close()

    isciler = [satis(), iptal_geri_yukleme()]
    if ters_baslat:
        isciler.reverse()
    sonuclar = await asyncio.gather(*isciler, return_exceptions=True)
    _assert_no_lock_failure(sonuclar)
    assert not any(isinstance(r, BaseException) for r in sonuclar), sonuclar
    assert await _stock(a) == 43          # 40 + 3
    assert await _stock(b) == 41          # 40 + 2 - 1


# ══════════ Çift 4: tam iptal ↔ kısmi iade (_restock ↔ _restock_items) ══════════


@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("ters_baslat", [False, True])
async def test_cift4_tam_iptal_ile_kismi_iade(fab, tur, ters_baslat):
    """İki geri yükleme yolu aynı ürünlere aynı anda dokunuyor.

    İkisi de `lock_products` kullandığı için serileşirler; ikisinin etkisi de
    uygulanır (biri diğerini ezmez).
    """
    a = await fab.urun(stock=30)
    b = await fab.urun(stock=30)
    oid = await fab.siparis([(a, 4), (b, 1)])
    cid = fab.client_ids[-1]
    rid = await fab.iade(oid, cid, adet=2)   # ilk kalem = a

    async def tam_iptal() -> None:
        s = await _session()
        try:
            order = await _load_order(s, oid)
            await order_service._restock(s, order, reason_code="ORDER_CANCELLED")
            await asyncio.sleep(0.05)
            await s.commit()
        finally:
            await s.close()

    async def kismi_iade() -> None:
        s = await _session()
        try:
            order = await _load_order(s, oid)
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
        finally:
            await s.close()

    isciler = [tam_iptal(), kismi_iade()]
    if ters_baslat:
        isciler.reverse()
    sonuclar = await asyncio.gather(*isciler, return_exceptions=True)
    _assert_no_lock_failure(sonuclar)
    assert not any(isinstance(r, BaseException) for r in sonuclar), sonuclar
    # ── Fazla geri yükleme tavanı (commit 5 / requirement 6) ──
    #
    # Kalem `a` 4 adet satılmıştı. Tam iptal ve kısmi iade FARKLI idempotency
    # anahtarları kullanır, yani ikisi de "kendi başına geçerli" görünür; tavan
    # olmasa toplam 4+2=6 adet geri yüklenir ve stok SATILANDAN fazla artardı.
    # Tavan `satılan − şimdiye kadar geri yüklenen` olduğu için sıra ne olursa
    # olsun sonuç aynıdır:
    #   iptal önce : +4 → sonra iade tavanı 0 → +0   ⇒ 34
    #   iade önce  : +2 → sonra iptal tavanı 2 → +2  ⇒ 34
    assert await _stock(a) == 34, "fazla geri yükleme (tavan uygulanmadı)"
    assert await _stock(b) == 31          # 30 + 1 (yalnız iptal)

    # Defter de aynı gerçeği söylemeli: `a` için geri yüklenen toplam = satılan.
    async with AsyncSessionLocal() as s:
        oi_id = (
            await s.execute(
                text(
                    "SELECT id FROM order_items WHERE order_id = :o AND product_id = :p"
                ),
                {"o": oid, "p": a},
            )
        ).scalar_one()
        geri = await stock_ledger.restored_quantity_by_order_item(s, [oi_id])
    assert geri.get(oi_id, 0) == 4, geri


# ══════════ Çift 5: aynı siparişin retry'ı ↔ admin düzeltmesi ══════════


@pytest.mark.parametrize("tur", range(TURLAR))
@pytest.mark.parametrize("ters_baslat", [False, True])
async def test_cift5_ayni_siparisin_retryi_ile_admin_duzeltmesi(fab, tur, ters_baslat):
    """Aynı satış hareketi iki kez (retry) + eşzamanlı admin düzeltmesi.

    Retry defterde idempotenttir (tek satır); admin düzeltmesi delta olduğu için
    retry'ın düşümünü ezmez.

    NOT: `_restock` bu commit'te henüz deftere bağlı DEĞİL (commit 5 borcu), bu
    yüzden retry ölçümü ledger üzerinden yapılıyor — orada idempotency zaten
    kurulu.
    """
    pid = await fab.urun(stock=20)
    anahtar = f"kilit:{_uniq()}:retry"

    async def satis_retry() -> None:
        for _ in range(2):
            s = await _session()
            try:
                await stock_ledger.apply_movement(
                    s, pid, qty_delta=-5,
                    movement_type=StockMovementType.SALE,
                    reason_code="ORDER_PAID", ref_type="order", ref_id=773000 + tur,
                    idempotency_key=anahtar,
                )
                await s.commit()
            finally:
                await s.close()

    async def admin_duzeltmesi() -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(text("BEGIN"))
            await s.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            from schemas.store import ProductUpdate

            await store_service.update_product(
                s, pid,
                ProductUpdate(stock=25, stock_reason_code="TEDARIK"),
                admin_id=ADMIN_ID,
            )

    isciler = [satis_retry(), admin_duzeltmesi()]
    if ters_baslat:
        isciler.reverse()
    sonuclar = await asyncio.gather(*isciler, return_exceptions=True)
    _assert_no_lock_failure(sonuclar)
    assert not any(isinstance(r, BaseException) for r in sonuclar), sonuclar
    # Satış TEK kez uygulandı (retry emildi) → 20 - 5 = 15; admin hedefi 25 →
    # delta +5 veya +10 (sıraya göre) ama sonuç her hâlde 20'dir:
    #   satış önce: 15 → admin delta +10 → 25 ... değil; admin hedefi MUTLAK
    #   değil DELTAYA çevrilir: hedef 25, mevcut 15 → +10 → 25.
    #   admin önce: 20 → +5 → 25, sonra satış -5 → 20.
    # İki sıra iki farklı ama İKİSİ DE DOĞRU sonuç verir; ölçülen şey kaybın
    # olmaması: satışın -5'i her hâlde uygulanmış olmalı.
    son = await _stock(pid)
    assert son in (20, 25), son
    # Retry TEK satış hareketi yazmalı. (Admin düzeltmesi commit 5'ten beri
    # kendi `ADMIN_ADJUSTMENT` hareketini yazıyor; toplam sayı 2'dir.)
    assert await _mv_count(pid, movement_type="SALE") == 1, "retry ikinci SALE yazdı"
    assert await _mv_count(pid, movement_type="ADMIN_ADJUSTMENT") == 1
