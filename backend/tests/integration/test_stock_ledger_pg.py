"""Stok hareket defteri — GERÇEK Postgres değişmezleri.

Kurulum ve güvenlik kilidi için `tests/integration/conftest.py`'a bakın
(`pg` fixture'ı `assert_test_database()` çağırır).

## İzolasyon deseni

Defter **append-only** olduğu ve satırları DB trigger'ıyla korunduğu için
testler satır silmez. Onun yerine her test **kendi ürününü** üretir ve teardown'da
ürünü **soft-delete** eder; hareket satırları kalır. Bütün doğrulamalar ürün
bazlıdır, hiçbiri global satır sayısına bakmaz — bu, `TRUNCATE`'in dev DB'nin
gerçek defterini silmesini de önler.

Bu dosya commit 1'de kırmızı yazıldı; commit 3'te defter servisi gelince
yeşile döndü.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from core.database import AsyncSessionLocal
from tests.integration.db_guard import purge_products
from models.store import Product, StockMovement
from services import stock_ledger
from services.stock_ledger import (
    IdempotencyConflict,
    InsufficientStock,
    StockMovementType,
    StockNotTracked,
)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _line_ids(n: int) -> list[int]:
    """Kosuma ozgu, artan `ref_line_id` degerleri.

    Gercek `order_return_items.id` gibi global tekil davranmalari gerekir;
    sabit sayilar ikinci kosumda onceki kosumun defter satirina carpar.
    """
    taban = uuid.uuid4().int % 10**8 * 10
    return [taban + i for i in range(n)]


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
            # SKU'yu BEFORE INSERT trigger'i yazar (rev. 3) - elle atanmaz.
            await s.refresh(p, ["sku"])
            await s.commit()
            self.product_ids.append(p.id)
            return p.id

    async def cleanup(self) -> None:
        if not self.product_ids:
            return
        async with AsyncSessionLocal() as s:
            # Ürün + defter satırları FİZİKSEL silinir; soft-delete satırları
            # biriktiriyordu (bkz. db_guard.purge_products).
            await purge_products(s, self.product_ids)


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
    # F29: defter `bucket` ZORUNLU ister. Bu yardimci varsayilan olarak
    # satilabilir kovayi verir; hasarli kova testleri onu ACIKCA gecer.
    kw.setdefault("bucket", stock_ledger.StockBucket.SALEABLE)
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


@pytest.mark.parametrize(
    "farkli",
    [
        {"reason_code": "ORDER_REFUNDED"},  # SALE_CANCEL icin gecerli ikinci kod
        {"actor_type": "ADMIN", "actor_id": 1},
        {"ref_id": 9999},
        {"ref_line_id": 42},
    ],
)
async def test_payload_karsilastirmasi_tum_alanlari_kapsar(urun, farkli):
    """rev. 3 / Karar 2: reason_code ve actor da karşılaştırmaya girer.

    Taban tip `SALE_CANCEL`: gerekçe farkını ölçebilmek için iki geçerli koda
    (`ORDER_CANCELLED`/`ORDER_REFUNDED`) sahip bir tür gerekiyor. `SALE`'de
    gerekçe değiştirmek `validate_reason` tarafından — doğru biçimde — daha
    idempotency'ye gelmeden reddedilirdi.
    """
    pid = await urun.product(stock=10)
    key = f"order:9100:product:{pid}:SALE_CANCEL"
    temel = dict(
        qty_delta=1,
        movement_type=StockMovementType.SALE_CANCEL,
        reason_code="ORDER_CANCELLED",
        ref_type="order",
        ref_id=9100,
        idempotency_key=key,
    )
    await _apply(pid, **temel)
    with pytest.raises(IdempotencyConflict):
        await _apply(pid, **{**temel, **farkli})
    assert len(await _movements(pid)) == 1
    assert await _stock(pid) == 11


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
    # `return_line:*` anahtari urun kimligi TASIMAZ (iade satiri kimligi
    # zaten global tekildir). Testte sabit 501/502 kullanmak, ikinci kosumda
    # onceki kosumun satirina carpar -> kosuma ozgu satir kimligi uretiliyor.
    a_id, b_id = _line_ids(2)
    for satir_id, adet in ((a_id, 1), (b_id, 2)):
        await _apply(
            pid, qty_delta=adet, movement_type=StockMovementType.RETURN,
            reason_code="RETURN_ACCEPTED", ref_type="order_return", ref_id=77,
            ref_line_id=satir_id, idempotency_key=f"return_line:{satir_id}:RETURN",
        )
    rows = await _movements(pid)
    assert len(rows) == 2
    assert {r.ref_line_id for r in rows} == {a_id, b_id}
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

async def test_stok_takibi_kapali_urunde_hareket_REDDEDILIR(urun):
    """§3g0 (rev. 3): sessiz atlama değil, açık ret.

    `stock IS NULL` "stoğu 0" değil, **"takip edilmiyor"** demektir. Buraya bir
    dijital kalem gelmesi çağıranın filtresinin bozulduğunu gösterir; sessiz
    `None` dönmek o hatayı gizlerdi.
    """
    pid = await urun.product(kind="DIGITAL", stock=None)
    with pytest.raises(StockNotTracked):
        await _apply(
            pid, qty_delta=-1, movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID", ref_type="order", ref_id=9009,
            idempotency_key=f"order:9009:product:{pid}:SALE",
        )
    assert await _movements(pid) == []
    assert await _stock(pid) is None


async def test_dijital_urun_sku_alir(urun):
    """§3g0: SKU bir katalog kimliğidir; stok takibiyle ilgisi yok."""
    pid = await urun.product(kind="DIGITAL", stock=None)
    async with AsyncSessionLocal() as s:
        sku = (
            await s.execute(select(Product.sku).where(Product.id == pid))
        ).scalar_one()
    assert sku == f"DIJ-{pid:06d}"


async def test_sifir_delta_genel_harekette_REDDEDILIR(urun):
    """§3g0 (rev. 3): sıfır delta yalnız OPENING_BALANCE'ta serbest.

    "Gürültü satırı yazmama" kararı ÇAĞIRANDA: `update_product` deltayı kilit
    altında hesaplar ve 0 çıkarsa ledger'ı hiç çağırmaz. Defter katıdır.
    """
    pid = await urun.product(stock=5)
    with pytest.raises(ValueError):
        await _apply(
            pid, qty_delta=0, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="SAYIM_FARKI", actor_type="ADMIN", actor_id=1,
        )
    assert await _movements(pid) == []
    assert await _stock(pid) == 5


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
        # F29: kolonun ne ORM'de ne DB'de varsayılanı var → ham yazıcı da
        # açıkça vermek zorunda. `bucket=None` geçilerek eksiklik sınanabilir.
        bucket="SALEABLE",
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


# ───────────────── Kova (F29) — sessiz varsayılan YOK ─────────────────

async def test_bucket_kolonunun_SUNUCU_VARSAYILANI_YOK(pg):
    """`f29a_bucket_default_kaldir` gerçekten uygulandı mı — pg catalog'dan.

    Kaynak taraması yetmez: varsayılan **veritabanında** durur ve migration
    uygulanmamışsa model dosyası temiz görünürken DB hâlâ sessizce doldurur.
    """
    async with AsyncSessionLocal() as s:
        varsayilan = (
            await s.execute(
                text(
                    "SELECT column_default FROM information_schema.columns "
                    "WHERE table_name = 'stock_movements' AND column_name = 'bucket'"
                )
            )
        ).scalar_one()
    assert varsayilan is None, f"bucket hâlâ sunucu varsayılanı taşıyor: {varsayilan!r}"


async def test_bucket_KOLONU_HIC_YAZILMADAN_ham_insert_REDDEDILIR(urun):
    """Asıl koruma bu: kolonu **hiç yazmayan** bir INSERT reddedilmeli.

    ⚠️ `bucket = NULL` göndermek AYNI ŞEY DEĞİLDİR: açık NULL, sunucu
    varsayılanını devreye sokmaz. Bu yüzden "NULL gönder" biçimindeki bir test,
    varsayılan geri konsa bile GEÇER — mutasyon provasında tam olarak öyle
    oldu. Gerçek hata senaryosu (kolonu bilmeyen yazıcı) kolonu INSERT
    listesine hiç koymaz; ölçülmesi gereken de budur.
    """
    pid = await urun.product(stock=1)
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "INSERT INTO stock_movements (product_id, qty_delta, qty_after,"
                    " movement_type, reason_code, actor_type, actor_id) "
                    "VALUES (:p, 1, 1, 'ADMIN_ADJUSTMENT', 'TEDARIK', 'ADMIN', 1)"
                ),
                {"p": pid},
            )
            await s.commit()
    metin = str(exc.value).lower()
    assert "bucket" in metin and "null" in metin, metin


async def test_bucket_ACIK_NULL_ile_de_REDDEDILIR(urun):
    """NOT NULL kısıtının kendisi (yukarıdakinden farkı için docstring'e bakınız)."""
    pid = await urun.product(stock=1)
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        await _raw_insert(pid, bucket=None)
    metin = str(exc.value).lower()
    assert "bucket" in metin and "null" in metin, metin


async def test_bucket_DAMAGED_acikca_verilince_dogru_kaydediliyor(urun):
    """Kolon iki değeri de gerçekten taşıyabiliyor (kısıt fazla dar değil).

    Ham SQL kullanılıyor: defter servisi kova boyutunu commit 4'te kazanacak,
    o zamana kadar DAMAGED yazımı servis seviyesinde bilinçli olarak reddedilir.
    """
    pid = await urun.product(stock=1)
    await _raw_insert(
        pid, bucket="DAMAGED", movement_type="DAMAGE_TRANSFER", reason_code="KIRIK",
        ref_type="damage_event", ref_id=1, idempotency_key=f"kova-{_uniq()}",
    )
    async with AsyncSessionLocal() as s:
        kovalar = (
            await s.execute(
                text(
                    "SELECT bucket FROM stock_movements WHERE product_id = :i "
                    "ORDER BY id"
                ),
                {"i": pid},
            )
        ).scalars().all()
    assert kovalar[-1] == "DAMAGED"


async def test_gecersiz_kova_REDDEDILIR(urun):
    pid = await urun.product(stock=1)
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        await _raw_insert(pid, bucket="RAFTA")
    assert "ck_stock_movements_bucket" in str(exc.value)


async def test_defter_servisi_yazdigi_satira_SALEABLE_koyuyor(urun):
    """Davranış eşi: kaynak sözleşmesi "bucket= veriliyor" der; burada gerçekten
    DB'ye doğru değerin gittiği görülür. Varsayılan olmadığı için servis bunu
    atlarsa test NOT NULL ihlaliyle kırılır."""
    pid = await urun.product(stock=0)
    mv = await _apply(
        pid, qty_delta=4, movement_type=StockMovementType.INITIAL,
        reason_code="PRODUCT_CREATE", ref_type="product", ref_id=pid,
        idempotency_key=f"kova-servis-{_uniq()}",
    )
    assert mv is not None
    async with AsyncSessionLocal() as s:
        kova = (
            await s.execute(
                text("SELECT bucket FROM stock_movements WHERE id = :i"), {"i": mv.id}
            )
        ).scalar_one()
    assert kova == "SALEABLE"


async def test_bucket_VERILMEYEN_cagri_TypeError_ile_kirilir(urun):
    """Sessiz `None → SALEABLE` varsayımı kaldırıldı: kovayı vermeyi unutan
    YENİ bir çağıran (ör. hasar servisi) çağrı anında kırılmalı, sessizce
    satılabilir kovayı bozmamalı.

    `TypeError` bilinçli: zorunlu keyword parametresi hem çalışma zamanında hem
    tür denetiminde yakalanır; çalışma zamanı `ValueError`'ı yalnız o kod yolu
    koştuğunda görünürdü.
    """
    pid = await urun.product(stock=5)
    with pytest.raises(TypeError):
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_movement(
                s, pid, qty_delta=-1,
                movement_type=StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=1,
                idempotency_key=f"kova-yok-{_uniq()}",
            )
    assert await _stock(pid) == 5


async def test_apply_many_specinde_EKSIK_bucket_domain_hatasi_uretir(urun):
    """Toplu yolda kova sözlükte gelir; eksikse **domain doğrulama hatası**
    verilir ve hiçbir satır yazılmaz — otomatik doldurma YOK."""
    pid = await urun.product(stock=5)
    with pytest.raises(ValueError, match="bucket"):
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_many(
                s,
                [
                    {
                        "product_id": pid,
                        "qty_delta": -1,
                        "movement_type": StockMovementType.SALE,
                        "reason_code": "ORDER_PAID",
                        "ref_type": "order",
                        "ref_id": 1,
                        "idempotency_key": f"kova-yok-batch-{_uniq()}",
                    }
                ],
            )
            await s.commit()
    assert await _stock(pid) == 5
    assert await _movements(pid) == []


async def test_idempotency_anahtari_unique(urun):
    pid = await urun.product(stock=1)
    anahtar = f"tekil-{_uniq()}"   # kosuma ozgu: defter append-only
    await _raw_insert(pid, idempotency_key=anahtar)
    with pytest.raises((IntegrityError, DBAPIError)):
        await _raw_insert(pid, idempotency_key=anahtar)


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

async def _scalar_sku(product_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Product.sku).where(Product.id == product_id))
        ).scalar_one()


async def test_sku_urun_id_sinin_fonksiyonu(urun):
    pid = await urun.product(kind="PHYSICAL")
    async with AsyncSessionLocal() as s:
        sku = (
            await s.execute(select(Product.sku).where(Product.id == pid))
        ).scalar_one()
    assert sku == f"FZK-{pid:06d}"


async def test_ham_insert_sku_yu_otomatik_alir(urun):
    """rev. 3: SKU'yu BEFORE INSERT trigger'ı yazar → NOT NULL her yazıcıda tutar.

    Migration, seed ve ham SQL yazımları (bu test dâhil) `sku` vermeden INSERT
    edebilmek zorunda; aksi hâlde disiplin her yeni yazıcıda tekrar
    hatırlanmaya muhtaç kalırdı.
    """
    slug = f"stok-ham-{_uniq()}"
    async with AsyncSessionLocal() as s:
        pid = (
            await s.execute(
                text(
                    "INSERT INTO products (slug, title, kind, seller_type, price, "
                    "stock, status) VALUES (:s, 'Ham INSERT', 'PHYSICAL', "
                    "'PLATFORM', 10.00, 0, 'ACTIVE') RETURNING id"
                ),
                {"s": slug},
            )
        ).scalar_one()
        await s.commit()
    urun.product_ids.append(pid)
    assert await _scalar_sku(pid) == f"FZK-{pid:06d}"


async def test_verilen_sahte_sku_trigger_tarafindan_EZILIR(urun):
    """SKU taklit edilemez: başka bir ürünün kimliği alınamaz."""
    slug = f"stok-sahte-{_uniq()}"
    async with AsyncSessionLocal() as s:
        pid = (
            await s.execute(
                text(
                    "INSERT INTO products (slug, title, kind, seller_type, price, "
                    "stock, status, sku) VALUES (:s, 'Sahte SKU', 'PHYSICAL', "
                    "'PLATFORM', 10.00, 0, 'ACTIVE', 'FZK-000001') RETURNING id"
                ),
                {"s": slug},
            )
        ).scalar_one()
        await s.commit()
    urun.product_ids.append(pid)
    assert await _scalar_sku(pid) == f"FZK-{pid:06d}"


async def test_sku_degistirilemez(urun):
    pid = await urun.product()
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET sku = 'FZK-999999' WHERE id = :i"), {"i": pid}
            )
            await s.commit()
    assert "sku" in str(exc.value).lower()


async def test_kind_degistirilemez(urun):
    """SKU öneği `kind`'e bağlı; `kind` değişirse SKU yalan söylerdi."""
    pid = await urun.product()
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET kind = 'DIGITAL' WHERE id = :i"), {"i": pid}
            )
            await s.commit()
    assert "kind" in str(exc.value).lower()


async def test_diger_alanlarin_guncellenmesi_engellenmiyor(urun):
    """Kimlik trigger'ı yalnız `sku`/`kind`'i kilitler; fiyat/stok/soft-delete serbest."""
    pid = await urun.product(stock=1)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET price = 123.45, status = 'HIDDEN' WHERE id = :i"),
            {"i": pid},
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        fiyat = (
            await s.execute(select(Product.price).where(Product.id == pid))
        ).scalar_one()
    assert Decimal(str(fiyat)) == Decimal("123.45")


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
        sonuc = await stock_ledger.list_movements(s, product_id=a, limit=50, offset=0)
    assert {r.movement.product_id for r in sonuc.rows} == {a}
    assert sonuc.total == 1
    # Ürün künyesi join'den geliyor (satır başına ek sorgu YOK).
    assert sonuc.rows[0].sku == f"FZK-{a:06d}"


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
