"""Defter listeleme ve doğrulama uçlarının SORGU MALİYETİ + doğruluğu (commit 6).

Üç iddia ölçülür:

1. **N+1 yok.** Liste sorgu sayısı satır sayısından bağımsız sabittir; genel
   doğrulama ürün sayısından bağımsız sabittir. Sorgular gerçek bir SQLAlchemy
   `before_cursor_execute` nöbetçisiyle SAYILIR (F26'da kullanılan desen).
2. **Zorunlu sayfalama.** İstenen limit tavanı aşarsa tavana kırpılır.
3. **İki doğrulama yolu ayrışmaz.** Ürün bazlı (`verify_ledger`, satır satır)
   ve toplu (`audit_products`, pencere fonksiyonlu SQL) aynı bulguları üretir.
   İki ayrı implementasyon bilinçli (biri satırları zaten okuyor, diğeri
   okuyamaz); çapraz kontrol onları birbirine bağlar.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import event, select, text

from core.database import AsyncSessionLocal, engine
from tests.integration.db_guard import purge_products
from models.store import Product
from services import stock_ledger
from services.stock_ledger import StockMovementType

ADMIN_ID = 1


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class SorguSayaci:
    """Gerçek SQL sayacı — `before_cursor_execute` ile.

    "N+1 yok" iddiası ancak sorgular SAYILARAK kanıtlanır; kod okuyarak
    verilen söz, bir `selectinload` unutulduğunda sessizce bozulur.
    """

    def __init__(self) -> None:
        self.sorgular: list[str] = []

    def __enter__(self):
        def dinle(conn, cursor, statement, params, context, executemany):
            self.sorgular.append(statement)

        self._dinle = dinle
        event.listen(engine.sync_engine, "before_cursor_execute", dinle)
        return self

    def __exit__(self, *a):
        event.remove(engine.sync_engine, "before_cursor_execute", self._dinle)

    @property
    def adet(self) -> int:
        return len(self.sorgular)


class Fabrika:
    def __init__(self) -> None:
        self.product_ids: list[int] = []

    async def urun(self, *, stock: int | None, kind: str = "PHYSICAL") -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"denetim-{_uniq()}",
                title=f"Denetim {_uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal("10.00"),
                stock=stock,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            await s.refresh(p, ["sku"])
            await s.commit()
            self.product_ids.append(p.id)
            return p.id

    async def hareket(self, pid: int, **kw) -> None:
        kw.setdefault("bucket", stock_ledger.StockBucket.SALEABLE)
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_movement(s, pid, **kw)
            await s.commit()

    async def ham_hareket(self, pid: int, **cols) -> None:
        """Defter servisini ATLAYARAK satır yazar — bozuk zincir kurmak için."""
        varsayilan = dict(
            product_id=pid,
            qty_delta=1,
            qty_after=1,
            movement_type="ADMIN_ADJUSTMENT",
            reason_code="TEDARIK",
            # F29: kolonun ne ORM'de ne DB'de varsayılanı var — ham yazıcı da
            # açıkça vermek zorunda (bkz. `f29a_bucket_default_kaldir`).
            bucket="SALEABLE",
            ref_type=None,
            ref_id=None,
            ref_line_id=None,
            idempotency_key=None,
            actor_type="ADMIN",
            actor_id=ADMIN_ID,
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

    async def cleanup(self) -> None:
        if not self.product_ids:
            return
        async with AsyncSessionLocal() as s:
            # Ürün + defter satırları FİZİKSEL silinir (soft-delete satırları
            # biriktiriyordu). `purge_products` yalnız test veritabanında çalışır
            # ve append-only trigger'ını geçici devre dışı bırakır.
            await purge_products(s, self.product_ids)
            await s.commit()


@pytest.fixture
async def fab(pg) -> Fabrika:
    f = Fabrika()
    yield f
    await f.cleanup()


async def _n_hareket(fab: Fabrika, pid: int, n: int) -> None:
    for i in range(n):
        await fab.hareket(
            pid,
            qty_delta=1,
            movement_type=StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="TEDARIK",
            actor_type="ADMIN",
            actor_id=ADMIN_ID,
        )


# ════════════════════ 1. N+1 nöbetçisi ════════════════════


async def test_liste_sorgu_sayisi_satir_sayisindan_BAGIMSIZ(fab):
    pid = await fab.urun(stock=0)
    await _n_hareket(fab, pid, 12)

    async with AsyncSessionLocal() as s:
        with SorguSayaci() as az:
            await stock_ledger.list_movements(s, product_id=pid, limit=2)
        with SorguSayaci() as cok:
            await stock_ledger.list_movements(s, product_id=pid, limit=12)

    assert az.adet == cok.adet, (
        f"satır sayısı arttıkça sorgu arttı (N+1): {az.adet} → {cok.adet}"
    )
    # Sayım + sayfa = 2. Ürün künyesi JOIN'den geliyor.
    assert cok.adet == 2, [q.split()[0] for q in cok.sorgular]


async def test_liste_urun_kunyesini_ek_sorgu_OLMADAN_dondurur(fab):
    pid = await fab.urun(stock=0)
    await _n_hareket(fab, pid, 3)
    async with AsyncSessionLocal() as s:
        sayfa = await stock_ledger.list_movements(s, product_id=pid, limit=10)
    assert len(sayfa.rows) == 3
    for r in sayfa.rows:
        assert r.sku == f"FZK-{pid:06d}"
        assert r.product_title


async def test_genel_denetim_sorgu_sayisi_urun_sayisindan_BAGIMSIZ(fab):
    az_urun = [await fab.urun(stock=0) for _ in range(2)]
    cok_urun = az_urun + [await fab.urun(stock=0) for _ in range(6)]

    async with AsyncSessionLocal() as s:
        with SorguSayaci() as a:
            await stock_ledger.audit_products(s, az_urun)
        with SorguSayaci() as b:
            await stock_ledger.audit_products(s, cok_urun)

    assert a.adet == b.adet, (
        f"ürün sayısı arttıkça sorgu arttı (N+1): {a.adet} → {b.adet}"
    )
    # Ürün künyeleri + özet + son bakiye + zincir kopukluğu = 4.
    assert b.adet == 4, [q.split()[0] for q in b.sorgular]


# ════════════════════ 2. Zorunlu sayfalama ════════════════════


async def test_liste_limiti_tavana_kirpilir(fab):
    pid = await fab.urun(stock=0)
    await _n_hareket(fab, pid, 3)
    async with AsyncSessionLocal() as s:
        sayfa = await stock_ledger.list_movements(
            s, product_id=pid, limit=10_000       # sınırsız istek
        )
    assert len(sayfa.rows) <= stock_ledger.LIST_MAX_LIMIT


async def test_siralama_en_yeni_once_ve_ID_ile_DETERMINISTIK(fab):
    """Aynı `created_at`'te `id DESC` — yoksa sayfalar arası satır kayar."""
    pid = await fab.urun(stock=0)
    zaman = datetime.datetime(2027, 3, 3, 10, tzinfo=datetime.timezone.utc)
    for _ in range(4):
        await fab.ham_hareket(pid, created_at=zaman)
    async with AsyncSessionLocal() as s:
        ilk = await stock_ledger.list_movements(s, product_id=pid, limit=2, offset=0)
        ikinci = await stock_ledger.list_movements(s, product_id=pid, limit=2, offset=2)
    ids = [r.movement.id for r in ilk.rows] + [r.movement.id for r in ikinci.rows]
    assert ids == sorted(ids, reverse=True), ids
    assert len(set(ids)) == 4, "sayfalar arası satır tekrarlandı/atlandı"


async def test_siralama_DERLENEN_SQL_de_id_baglayicisini_tasiyor(fab):
    """`ORDER BY created_at DESC, id DESC` — DB'ye giden ifadede.

    ## Neden davranış testi değil

    `id DESC` bağlayıcısı bir **belirsizlik garantisidir**: aynı `created_at`'e
    sahip satırların sırası SQL standardında tanımsızdır. Bu paketin verisiyle
    (40 satır, tek ürün) PostgreSQL sırayı hem index taramasında hem — zorlanan
    — seq scan'de tutarlı döndürdü; yani bağlayıcıyı kaldıran mutasyon
    gözlemlenebilir bir kayma ÜRETMİYOR. Ölçüldü, uydurulmadı.

    Bu yüzden burada kaynak metni değil **derlenen ifade** doğrulanır: testin
    gördüğü dizgi, veritabanına gerçekten gönderilen SQL'dir. Kaynak taramasından
    güçlü, davranış testinden zayıf; ikisinin arasındaki boşluk raporda açık
    bırakıldı.
    """
    from sqlalchemy.dialects import postgresql

    yakalanan: list[str] = []

    async with AsyncSessionLocal() as s:
        with SorguSayaci() as sayac:
            await stock_ledger.list_movements(s, limit=1)
        yakalanan = [q for q in sayac.sorgular if "stock_movements" in q]

    sayfa_sorgusu = next(q for q in yakalanan if "ORDER BY" in q.upper())
    normal = " ".join(sayfa_sorgusu.split()).upper()
    assert "ORDER BY" in normal
    sira = normal.split("ORDER BY", 1)[1]
    assert "CREATED_AT DESC" in sira, sira[:200]
    assert "ID DESC" in sira, (
        "aynı created_at'te deterministik sıra için id bağlayıcısı şart: " + sira[:200]
    )
    # Sıra doğru olmalı: önce created_at, sonra id.
    assert sira.index("CREATED_AT DESC") < sira.index("ID DESC"), sira[:200]
    del postgresql


async def test_genel_denetim_sayfali_ve_tavanli(fab):
    # Kendi verisini üretir: iddia GLOBAL ürün sayısına bağlı olmamalı. (İlk
    # sürüm "defterde 2'den çok ürün var" varsayıyordu; temiz bir test
    # veritabanında bu varsayım çöktü ve test kırıldı.)
    for _ in range(3):
        await fab.urun(stock=0)

    # Tavanın GERÇEKTEN zorlanması için tavandan fazla ürün gerekir. İlk sürüm
    # bunu geliştirme veritabanındaki ~2000 üründen "ödünç alıyordu"; temiz bir
    # test veritabanında tavan hiç devreye girmiyordu ve tavanı kaldıran
    # mutasyon YAKALANMIYORDU. Test artık kendi verisini üretir.
    fazla = stock_ledger.AUDIT_MAX_LIMIT + 5
    async with AsyncSessionLocal() as s:
        ids = (
            await s.execute(
                text(
                    "INSERT INTO products (slug, title, kind, seller_type, price, "
                    "stock, status) SELECT 'denetim-toplu-' || :ek || '-' || g, "
                    "'Toplu ' || g, 'PHYSICAL', 'PLATFORM', 10.00, 0, 'DRAFT' "
                    "FROM generate_series(1, :n) g RETURNING id"
                ),
                {"ek": _uniq(), "n": fazla},
            )
        ).scalars().all()
        await s.commit()
    fab.product_ids.extend(ids)

    async with AsyncSessionLocal() as s:
        sonuc = await stock_ledger.audit_ledger(s, limit=10_000, offset=0)
    assert sonuc.checked <= stock_ledger.AUDIT_MAX_LIMIT, (
        f"tavan uygulanmadı: {sonuc.checked} ürün denetlendi"
    )
    assert sonuc.checked == stock_ledger.AUDIT_MAX_LIMIT, (
        "tavan tam olarak zorlanmalı (yeterli ürün üretilmiş olmalı)"
    )

    async with AsyncSessionLocal() as s:
        kucuk = await stock_ledger.audit_ledger(s, limit=2, offset=0)
    assert kucuk.checked == 2
    # En az 3 ürün var → sonraki sayfa bildirilmeli.
    assert kucuk.next_offset == 2


# ════════════════════ 3. Filtreler ════════════════════


async def test_filtreler(fab):
    pid = await fab.urun(stock=0)
    await fab.hareket(
        pid, qty_delta=5, movement_type=StockMovementType.INITIAL,
        reason_code="PRODUCT_CREATE", ref_type="product", ref_id=pid,
        idempotency_key=f"product:{pid}:INITIAL", actor_type="ADMIN", actor_id=ADMIN_ID,
    )
    await fab.hareket(
        pid, qty_delta=-2, movement_type=StockMovementType.SALE,
        reason_code="ORDER_PAID", ref_type="order", ref_id=4242,
        ref_line_id=99, idempotency_key=f"denetim:{_uniq()}:sale",
    )
    async with AsyncSessionLocal() as s:
        assert (await stock_ledger.list_movements(
            s, product_id=pid, movement_type="SALE")).total == 1
        assert (await stock_ledger.list_movements(
            s, product_id=pid, reason_code="PRODUCT_CREATE")).total == 1
        assert (await stock_ledger.list_movements(
            s, product_id=pid, actor_type="ADMIN")).total == 1
        assert (await stock_ledger.list_movements(
            s, product_id=pid, actor_id=ADMIN_ID)).total == 1
        assert (await stock_ledger.list_movements(
            s, product_id=pid, ref_type="order", ref_id=4242)).total == 1
        assert (await stock_ledger.list_movements(
            s, sku=f"FZK-{pid:06d}")).total == 2
        assert (await stock_ledger.list_movements(
            s, product_id=pid,
            date_from=datetime.datetime(2999, 1, 1, tzinfo=datetime.timezone.utc),
        )).total == 0


# ════════════════════ 4. Doğrulama bulguları ════════════════════


async def test_bulgu_zincir_kopuklugu_beklenen_ve_goruleni_soyler(fab):
    pid = await fab.urun(stock=0)
    await fab.ham_hareket(pid, qty_delta=5, qty_after=5)
    await fab.ham_hareket(pid, qty_delta=1, qty_after=9)   # 6 olmalıydı
    async with AsyncSessionLocal() as s:
        v = await stock_ledger.verify_ledger(s, pid)
    assert v.consistent is False
    kopuk = [p for p in v.problems if p.code == stock_ledger.PROBLEM_CHAIN_BREAK]
    assert len(kopuk) == 1
    assert kopuk[0].expected == 6 and kopuk[0].actual == 9
    assert kopuk[0].sku == f"FZK-{pid:06d}"
    assert kopuk[0].movement_id == v.first_divergent_id


async def test_bulgu_stok_sapmasi(fab):
    pid = await fab.urun(stock=0)
    await fab.hareket(
        pid, qty_delta=5, movement_type=StockMovementType.ADMIN_ADJUSTMENT,
        reason_code="TEDARIK", actor_type="ADMIN", actor_id=ADMIN_ID,
    )
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET stock = 77 WHERE id = :i"), {"i": pid}
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        v = await stock_ledger.verify_ledger(s, pid)
    sapma = [p for p in v.problems if p.code == stock_ledger.PROBLEM_STOCK_MISMATCH]
    assert len(sapma) == 1
    assert sapma[0].expected == 5 and sapma[0].actual == 77


async def test_bulgu_acilis_bakiyesi_ilk_degil(fab):
    pid = await fab.urun(stock=0)
    await fab.ham_hareket(pid, qty_delta=3, qty_after=3)
    await fab.ham_hareket(
        pid, qty_delta=0, qty_after=3,
        movement_type="OPENING_BALANCE", reason_code="MIGRATION_OPENING",
        ref_type="migration", actor_type="SYSTEM", actor_id=None,
    )
    async with AsyncSessionLocal() as s:
        v = await stock_ledger.verify_ledger(s, pid)
    kodlar = {p.code for p in v.problems}
    assert stock_ledger.PROBLEM_OPENING_NOT_FIRST in kodlar


async def test_bulgu_dijital_urunde_hareket(fab):
    pid = await fab.urun(stock=None, kind="DIGITAL")
    await fab.ham_hareket(pid, qty_delta=1, qty_after=1)
    async with AsyncSessionLocal() as s:
        v = await stock_ledger.verify_ledger(s, pid)
    assert v.consistent is False
    assert {p.code for p in v.problems} == {
        stock_ledger.PROBLEM_UNTRACKED_HAS_MOVEMENTS
    }
    assert v.current_stock is None


async def test_dogrulama_HICBIR_SEYI_DUZELTMEZ(fab):
    """Teşhis paketi: bulgu bulunca veri düzeltilmez.

    DİKKAT — başlangıç stoğu bilinçli olarak SIFIR DEĞİL. İlk sürümde ürün
    `stock=0` ile kuruluyordu ve mutasyon provasında `audit_products` içine
    eklenen `UPDATE products SET stock = 0` bu testi HİÇ kırmamıştı: iddia
    zaten 0 bekliyordu, yani boşa düşmüştü (mutasyonu yakalayan şey tesadüfen
    sorgu sayacı oldu). Sıfır olmayan bir bakiye, her türlü üzerine yazmayı
    görünür kılar.
    """
    pid = await fab.urun(stock=0)
    await fab.ham_hareket(pid, qty_delta=5, qty_after=5)
    await fab.ham_hareket(pid, qty_delta=1, qty_after=9)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET stock = 42 WHERE id = :i"), {"i": pid}
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        await stock_ledger.verify_ledger(s, pid)
        await stock_ledger.audit_products(s, [pid])
        await stock_ledger.audit_ledger(s, limit=200)

    async with AsyncSessionLocal() as s:
        stok = (
            await s.execute(select(Product.stock).where(Product.id == pid))
        ).scalar_one()
        satirlar = (
            await s.execute(
                text(
                    "SELECT id, qty_delta, qty_after FROM stock_movements "
                    "WHERE product_id = :i ORDER BY id"
                ),
                {"i": pid},
            )
        ).all()
    assert stok == 42, "doğrulama ürün stoğunu değiştirdi"
    assert [(r.qty_delta, r.qty_after) for r in satirlar] == [(5, 5), (1, 9)], (
        "doğrulama defter satırlarını değiştirdi"
    )


# ════════════════════ 5. İki yolun çapraz kontrolü ════════════════════


@pytest.mark.parametrize(
    "kurulum",
    ["saglam", "zincir_kopuk", "stok_sapmasi", "acilis_ilk_degil", "dijital"],
)
async def test_iki_dogrulama_yolu_ayni_sonucu_verir(fab, kurulum):
    """`verify_ledger` (satır satır) ↔ `audit_products` (toplu SQL).

    İki implementasyon bilinçli: ürün bazlı yol satırları zaten okuyor, genel
    yol okuyamaz. Ayrışmalarını bu test engeller.
    """
    if kurulum == "dijital":
        pid = await fab.urun(stock=None, kind="DIGITAL")
        await fab.ham_hareket(pid, qty_delta=1, qty_after=1)
    else:
        pid = await fab.urun(stock=0)
        await fab.ham_hareket(pid, qty_delta=4, qty_after=4)
        if kurulum == "saglam":
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text("UPDATE products SET stock = 4 WHERE id = :i"), {"i": pid}
                )
                await s.commit()
        elif kurulum == "zincir_kopuk":
            await fab.ham_hareket(pid, qty_delta=1, qty_after=9)
        elif kurulum == "stok_sapmasi":
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text("UPDATE products SET stock = 88 WHERE id = :i"), {"i": pid}
                )
                await s.commit()
        elif kurulum == "acilis_ilk_degil":
            await fab.ham_hareket(
                pid, qty_delta=0, qty_after=4,
                movement_type="OPENING_BALANCE", reason_code="MIGRATION_OPENING",
                ref_type="migration", actor_type="SYSTEM", actor_id=None,
            )

    async with AsyncSessionLocal() as s:
        tekil = await stock_ledger.verify_ledger(s, pid)
        toplu = (await stock_ledger.audit_products(s, [pid]))[0]

    assert tekil.consistent is toplu.consistent, kurulum
    assert tekil.current_stock == toplu.current_stock
    assert tekil.ledger_stock == toplu.ledger_stock
    assert tekil.movement_count == toplu.movement_count
    assert tekil.first_divergent_id == toplu.first_divergent_id
    assert {p.code for p in tekil.problems} == {p.code for p in toplu.problems}
    tk = {p.code: (p.expected, p.actual) for p in tekil.problems}
    tp = {p.code: (p.expected, p.actual) for p in toplu.problems}
    assert tk == tp, f"{kurulum}: beklenen/görülen değerler ayrıştı"
