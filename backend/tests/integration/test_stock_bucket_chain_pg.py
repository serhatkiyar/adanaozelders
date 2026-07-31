"""Defterin KOVA boyutu — GERÇEK PostgreSQL (F29 commit 4).

Buradaki tek iddia şu: `products.stock` ve `products.damaged_stock` **iki ayrı
defterdir**. Aynı ürünü paylaşırlar ama zincirleri, açılış kuralları, son-bakiye
karşılaştırmaları ve bulguları birbirinden bağımsızdır.

Neden gerçek Postgres: zincir doğrulamasının iki yolu var ve biri **saf SQL
pencere fonksiyonu** (`audit_products`). `PARTITION BY product_id` yerine
`PARTITION BY product_id, bucket` yazmayı unutmak, mock'lu bir testte asla
görünmezdi — hasarlı kovanın hareketleri satılabilir zinciri sahte kopuk
gösterirdi. Bu dosya o hatayı yakalamak için var.

İzolasyon: her test kendi ürününü üretir; teardown `purge_products` ile ürünü
ve defter satırlarını FİZİKSEL siler (append-only trigger yalnız test
veritabanında ve yalnız o işlem için kapatılır).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.store import Product, StockMovement
from services import stock_ledger
from services.stock_ledger import (
    IdempotencyConflict,
    InsufficientStock,
    StockBucket,
    StockMovementType,
)
from tests.integration.db_guard import purge_products

SALEABLE = StockBucket.SALEABLE
DAMAGED = StockBucket.DAMAGED


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class Fabrika:
    def __init__(self) -> None:
        self.product_ids: list[int] = []

    async def urun(self, *, stock: int | None = 0, kind: str = "PHYSICAL") -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"kova-{_uniq()}",
                title=f"Kova Testi {_uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal("10.00"),
                stock=stock,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            await s.refresh(p, ["sku"])
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        return pid

    async def temizle(self) -> None:
        if not self.product_ids:
            return
        async with AsyncSessionLocal() as s:
            await purge_products(s, self.product_ids)


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _uygula(pid: int, **kw):
    async with AsyncSessionLocal() as s:
        mv = await stock_ledger.apply_movement(s, pid, **kw)
        await s.commit()
        return mv


async def _hasar_transferi(pid: int, adet: int, *, olay_id: int) -> None:
    """Hasar servisi HENÜZ YOK (commit 6). Transferin iki bacağını burada
    defterin kendi toplu yoluyla yazıyoruz — ölçtüğümüz şey servis değil,
    defterin iki kovayı aynı transaction'da doğru zincirlemesi."""
    async with AsyncSessionLocal() as s:
        await stock_ledger.apply_many(
            s,
            [
                {
                    "product_id": pid, "bucket": SALEABLE, "qty_delta": -adet,
                    "movement_type": StockMovementType.DAMAGE_TRANSFER,
                    "reason_code": "KIRIK", "ref_type": "damage_event",
                    "ref_id": olay_id,
                    "idempotency_key": f"damage:{olay_id}:SALEABLE",
                    "actor_type": "ADMIN", "actor_id": 1,
                },
                {
                    "product_id": pid, "bucket": DAMAGED, "qty_delta": adet,
                    "movement_type": StockMovementType.DAMAGE_TRANSFER,
                    "reason_code": "KIRIK", "ref_type": "damage_event",
                    "ref_id": olay_id,
                    "idempotency_key": f"damage:{olay_id}:DAMAGED",
                    "actor_type": "ADMIN", "actor_id": 1,
                },
            ],
        )
        await s.commit()


async def _kovalar(pid: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as s:
        r = (
            await s.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    return int(r.stock), int(r.damaged_stock)


async def _dogrula(pid: int):
    async with AsyncSessionLocal() as s:
        return await stock_ledger.verify_ledger(s, pid)


async def _denetle(pid: int):
    async with AsyncSessionLocal() as s:
        return (await stock_ledger.audit_products(s, [pid]))[0]


async def _ham_hareket(pid: int, **cols) -> None:
    """Defter servisini ATLAYARAK satır yazar — bozuk zincir kurmak için."""
    varsayilan = dict(
        product_id=pid, bucket="SALEABLE", qty_delta=1, qty_after=1,
        movement_type="ADMIN_ADJUSTMENT", reason_code="TEDARIK",
        ref_type=None, ref_id=None, ref_line_id=None, idempotency_key=None,
        actor_type="ADMIN", actor_id=1, note=None, request_id=None,
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


# ═══════════════ 1. İki kova, iki bağımsız zincir ═══════════════

async def test_ayni_urunde_SALEABLE_ve_DAMAGED_zincirleri_BAGIMSIZ(fab):
    """Kritik prova: kovalar aynı `qty_after` zincirini paylaşmaz.

    Zincir kova körü olsaydı hasarlı `+3` hareketinin `qty_after`'ı satılabilir
    bakiyeden türer ve iki kova da yalan söylerdi.
    """
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=10,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 3, olay_id=int(_uniq(), 16) % 10**6)

    assert await _kovalar(pid) == (7, 3)

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                select(StockMovement.bucket, StockMovement.qty_delta,
                       StockMovement.qty_after)
                .where(StockMovement.product_id == pid)
                .order_by(StockMovement.id)
            )
        ).all()
    satilabilir = [(d, a) for b, d, a in satirlar if b == "SALEABLE"]
    hasarli = [(d, a) for b, d, a in satirlar if b == "DAMAGED"]
    assert satilabilir == [(10, 10), (-3, 7)]
    # Hasarlı zincir SIFIRDAN başlar; satılabilir bakiyeyi hiç görmez.
    assert hasarli == [(3, 3)]

    assert (await _dogrula(pid)).consistent is True
    assert (await _denetle(pid)).consistent is True


async def test_hasar_transferinin_IKI_BACAGI_ayni_transactionda(fab):
    """Yetersiz satılabilir stokta transfer HİÇBİR satır yazmaz — yarım
    transfer kitabı buharlaştırırdı."""
    pid = await fab.urun(stock=2)
    with pytest.raises(InsufficientStock):
        await _hasar_transferi(pid, 5, olay_id=int(_uniq(), 16) % 10**6)
    assert await _kovalar(pid) == (2, 0)
    async with AsyncSessionLocal() as s:
        adet = (
            await s.execute(
                text("SELECT count(*) FROM stock_movements WHERE product_id = :i"),
                {"i": pid},
            )
        ).scalar_one()
    assert adet == 0


async def test_hasarli_kova_NEGATIFE_dusemez(fab):
    """`InsufficientStock` kova bazlı okunur: satılabilir bol olsa bile
    hasarlı kovadan fazlası çıkarılamaz."""
    pid = await fab.urun(stock=50)
    await _hasar_transferi(pid, 2, olay_id=int(_uniq(), 16) % 10**6)
    with pytest.raises(InsufficientStock):
        await _uygula(
            pid, bucket=DAMAGED, qty_delta=-9,
            movement_type=StockMovementType.DAMAGE_DISPOSAL,
            reason_code="KIRIK", ref_type="damage_event", ref_id=1,
            idempotency_key=f"imha-{_uniq()}", actor_type="ADMIN", actor_id=1,
        )
    assert await _kovalar(pid) == (48, 2)


# ═══════════════ 2. Bulgular kova bazlı ═══════════════

async def test_bir_kovadaki_ZINCIR_KOPUKLUGU_digerini_bozuk_gostermez(fab):
    """En değerli test: hasarlı kovadaki kopukluk, satılabilir kovanın
    bulgusuna dönüşmemeli — operatör yanlış defteri aramamalı."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=10,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    # Hasarlı kovaya ELLE bozuk bir zincir kur: qty_after 4 olmalıydı, 9 yazıldı.
    await _ham_hareket(
        pid, bucket="DAMAGED", qty_delta=4, qty_after=9,
        movement_type="DAMAGE_TRANSFER", reason_code="KIRIK",
        ref_type="damage_event", ref_id=1, idempotency_key=f"bozuk-{_uniq()}",
    )
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET damaged_stock = 9 WHERE id = :i"), {"i": pid}
        )
        await s.commit()

    for sonuc in (await _dogrula(pid), await _denetle(pid)):
        assert sonuc.consistent is False
        kovalar = {p.bucket for p in sonuc.problems}
        assert kovalar == {"DAMAGED"}, (
            f"satılabilir kova da bulgu üretti: "
            f"{[(p.code, p.bucket) for p in sonuc.problems]}"
        )
        assert sonuc.current_stock == sonuc.ledger_stock == 10


async def test_son_bakiye_ile_URUN_KOLONU_sapmasi_kova_bazli_raporlanir(fab):
    """Elle `UPDATE products SET damaged_stock` yapılırsa yalnız DAMAGED
    kovasında `STOCK_MISMATCH` çıkar."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=5,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 2, olay_id=int(_uniq(), 16) % 10**6)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET damaged_stock = 7 WHERE id = :i"), {"i": pid}
        )
        await s.commit()

    for sonuc in (await _dogrula(pid), await _denetle(pid)):
        assert sonuc.consistent is False
        bulgular = [p for p in sonuc.problems]
        assert len(bulgular) == 1
        assert bulgular[0].code == stock_ledger.PROBLEM_STOCK_MISMATCH
        assert bulgular[0].bucket == "DAMAGED"
        assert (bulgular[0].expected, bulgular[0].actual) == (2, 7)
        assert sonuc.ledger_damaged_stock == 2
        assert sonuc.current_damaged_stock == 7


async def test_SATILABILIR_kovadaki_sapma_hasarliyi_ETKILEMEZ(fab):
    """Simetri provası — ters yön."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=5,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 2, olay_id=int(_uniq(), 16) % 10**6)
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE products SET stock = 99 WHERE id = :i"), {"i": pid})
        await s.commit()

    for sonuc in (await _dogrula(pid), await _denetle(pid)):
        assert sonuc.consistent is False
        assert {p.bucket for p in sonuc.problems} == {"SALEABLE"}
        assert sonuc.ledger_damaged_stock == sonuc.current_damaged_stock == 2


# ═══════════════ 3. Boş hasarlı kova ═══════════════

async def test_HIC_hasar_hareketi_yok_ve_damaged_stock_SIFIR_GECERLI(fab):
    """Plan §5.3: migration gereksiz sıfır `OPENING_BALANCE` üretmez; boş
    zincir + sıfır bakiye bulgu DEĞİLDİR. Bu, hemen her ürünün normal hâlidir —
    yanlış kurgu bütün kataloğu "bozuk" gösterirdi."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=4,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    assert await _kovalar(pid) == (4, 0)
    for sonuc in (await _dogrula(pid), await _denetle(pid)):
        assert sonuc.consistent is True, [p.message for p in sonuc.problems]
        assert sonuc.ledger_damaged_stock == 0
        assert sonuc.current_damaged_stock == 0


async def test_HIC_hasar_hareketi_yok_ama_damaged_stock_SIFIR_DEGIL_BULGU(fab):
    """Karşı prova: sessiz bir `UPDATE damaged_stock` doğrulamadan kaçamaz."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=4,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET damaged_stock = 6 WHERE id = :i"), {"i": pid}
        )
        await s.commit()

    for sonuc in (await _dogrula(pid), await _denetle(pid)):
        assert sonuc.consistent is False
        (bulgu,) = sonuc.problems
        assert bulgu.bucket == "DAMAGED"
        assert (bulgu.expected, bulgu.actual) == (0, 6)


# ═══════════════ 4. Idempotency kova farkını görür ═══════════════

async def test_AYNI_anahtar_YALNIZ_bucket_farkliysa_CATISMA(fab):
    """`bucket` payload karşılaştırmasına girmeseydi ikinci istek sessiz bir
    replay olurdu ve hasarlı hareket HİÇ yazılmazdı — hasar transferinin iki
    bacağını birbirine karıştırmanın tam senaryosu."""
    pid = await fab.urun(stock=10)
    anahtar = f"kova-catisma-{_uniq()}"
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=-2,
        movement_type=StockMovementType.DAMAGE_TRANSFER, reason_code="KIRIK",
        ref_type="damage_event", ref_id=5, idempotency_key=anahtar,
        actor_type="ADMIN", actor_id=1,
    )
    with pytest.raises(IdempotencyConflict) as exc:
        await _uygula(
            pid, bucket=DAMAGED, qty_delta=-2,
            movement_type=StockMovementType.DAMAGE_TRANSFER, reason_code="KIRIK",
            ref_type="damage_event", ref_id=5, idempotency_key=anahtar,
            actor_type="ADMIN", actor_id=1,
        )
    assert "bucket" in exc.value.conflicting_fields
    assert exc.value.conflicting_fields["bucket"] == ("SALEABLE", "DAMAGED")


async def test_AYNI_anahtar_AYNI_bucket_REPLAY(fab):
    """Kova aynıysa davranış değişmedi: retry mevcut hareketi döndürür."""
    pid = await fab.urun(stock=10)
    anahtar = f"kova-replay-{_uniq()}"
    ortak = dict(
        bucket=SALEABLE, qty_delta=-2,
        movement_type=StockMovementType.DAMAGE_TRANSFER, reason_code="KIRIK",
        ref_type="damage_event", ref_id=6, idempotency_key=anahtar,
        actor_type="ADMIN", actor_id=1,
    )
    ilk = await _uygula(pid, **ortak)
    tekrar = await _uygula(pid, **ortak)
    assert ilk.id == tekrar.id
    assert await _kovalar(pid) == (8, 0)


# ═══════════════ 5. Liste: filtre + deterministik sayfalama ═══════════════

async def test_liste_VARSAYILAN_olarak_IKI_KOVAYI_da_gosterir(fab):
    """Varsayılan listenin hasarlı hareketleri gizlemesi, defteri okuyan kişiye
    eksik bir gerçek sunmak olurdu."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=10,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 3, olay_id=int(_uniq(), 16) % 10**6)
    async with AsyncSessionLocal() as s:
        sayfa = await stock_ledger.list_movements(s, product_id=pid, limit=50)
    assert {r.movement.bucket for r in sayfa.rows} == {"SALEABLE", "DAMAGED"}
    assert sayfa.total == 3


async def test_liste_BUCKET_filtresi_daraltir(fab):
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=10,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 3, olay_id=int(_uniq(), 16) % 10**6)
    async with AsyncSessionLocal() as s:
        hasarli = await stock_ledger.list_movements(
            s, product_id=pid, bucket="DAMAGED", limit=50
        )
        satilabilir = await stock_ledger.list_movements(
            s, product_id=pid, bucket="SALEABLE", limit=50
        )
    assert hasarli.total == 1
    assert {r.movement.bucket for r in hasarli.rows} == {"DAMAGED"}
    assert satilabilir.total == 2
    assert {r.movement.bucket for r in satilabilir.rows} == {"SALEABLE"}


async def test_liste_GECERSIZ_bucket_reddeder(fab):
    async with AsyncSessionLocal() as s:
        with pytest.raises(ValueError, match="bucket"):
            await stock_ledger.list_movements(s, bucket="RAFTA")


async def test_bucket_filtreli_sayfalama_DETERMINISTIK(fab):
    """Aynı `created_at`'e sahip satırlarda `id DESC` bağlayıcısı olmasaydı
    sayfalar arası satır tekrarlanır/atlanırdı."""
    import datetime

    pid = await fab.urun(stock=0)
    zaman = datetime.datetime(2027, 5, 5, 12, tzinfo=datetime.timezone.utc)
    for i in range(4):
        await _ham_hareket(
            pid, bucket="DAMAGED", qty_delta=1, qty_after=i + 1,
            movement_type="DAMAGE_TRANSFER", reason_code="KIRIK",
            ref_type="damage_event", ref_id=1,
            idempotency_key=f"sayfa-{_uniq()}", created_at=zaman,
        )
    async with AsyncSessionLocal() as s:
        ilk = await stock_ledger.list_movements(
            s, product_id=pid, bucket="DAMAGED", limit=2, offset=0
        )
        ikinci = await stock_ledger.list_movements(
            s, product_id=pid, bucket="DAMAGED", limit=2, offset=2
        )
    ids_1 = [r.movement.id for r in ilk.rows]
    ids_2 = [r.movement.id for r in ikinci.rows]
    assert len(set(ids_1) & set(ids_2)) == 0, "sayfalar arası satır tekrarlandı"
    assert ids_1 + ids_2 == sorted(ids_1 + ids_2, reverse=True)
    assert ilk.total == ikinci.total == 4


# ═══════════════ 6. audit_products ↔ verify_ledger çapraz kontrolü ═══════════════

@pytest.mark.parametrize(
    "senaryo",
    ["saglam", "hasarli_zincir_kopuk", "hasarli_bakiye_sapmasi",
     "bos_hasarli_gecerli", "hasarsiz_bakiye_var"],
)
async def test_iki_dogrulama_yolu_KOVA_bazinda_da_ayni_sonucu_verir(fab, senaryo):
    """İki implementasyon bilinçli olarak ayrı (biri satır satır, diğeri
    pencere fonksiyonlu SQL). Kova boyutu eklenirken biri güncellenip diğeri
    unutulsaydı bu test yakalardı."""
    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=10,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    if senaryo in ("saglam", "hasarli_zincir_kopuk", "hasarli_bakiye_sapmasi"):
        await _hasar_transferi(pid, 3, olay_id=int(_uniq(), 16) % 10**6)
    if senaryo == "hasarli_zincir_kopuk":
        await _ham_hareket(
            pid, bucket="DAMAGED", qty_delta=1, qty_after=99,
            movement_type="DAMAGE_TRANSFER", reason_code="KIRIK",
            ref_type="damage_event", ref_id=2, idempotency_key=f"kk-{_uniq()}",
        )
    if senaryo == "hasarli_bakiye_sapmasi":
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET damaged_stock = 8 WHERE id = :i"),
                {"i": pid},
            )
            await s.commit()
    if senaryo == "hasarsiz_bakiye_var":
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET damaged_stock = 2 WHERE id = :i"),
                {"i": pid},
            )
            await s.commit()

    tekil = await _dogrula(pid)
    toplu = await _denetle(pid)

    assert tekil.consistent == toplu.consistent, senaryo
    assert tekil.current_stock == toplu.current_stock
    assert tekil.ledger_stock == toplu.ledger_stock
    assert tekil.current_damaged_stock == toplu.current_damaged_stock
    assert tekil.ledger_damaged_stock == toplu.ledger_damaged_stock
    assert tekil.movement_count == toplu.movement_count
    assert {(p.code, p.bucket) for p in tekil.problems} == {
        (p.code, p.bucket) for p in toplu.problems
    }, (
        f"{senaryo}: tekil={[(p.code, p.bucket) for p in tekil.problems]} "
        f"toplu={[(p.code, p.bucket) for p in toplu.problems]}"
    )


async def test_denetim_sorgu_sayisi_KOVA_boyutuyla_ARTMADI(fab):
    """Kova, ürün başına ikinci bir sorgu turuna dönüşmemeli: gruplama SQL
    içinde yapılır, Python'da değil."""
    from tests.integration.test_stock_audit_pg import SorguSayaci

    az = [await fab.urun(stock=5) for _ in range(2)]
    cok = az + [await fab.urun(stock=5) for _ in range(6)]
    # Her ürünün İKİ kovasında da hareket olsun: gruplama gerçekten iki katına
    # çıkan satır sayısıyla sınansın.
    for pid in cok:
        await _hasar_transferi(pid, 1, olay_id=int(_uniq(), 16) % 10**6)
    async with AsyncSessionLocal() as s:
        with SorguSayaci() as a:
            await stock_ledger.audit_products(s, az)
        with SorguSayaci() as b:
            await stock_ledger.audit_products(s, cok)
    assert a.adet == b.adet == 4, [q.split()[0] for q in b.sorgular]


# ═══════════════ 7. Mevcut yazıcılar açıkça SALEABLE gönderiyor ═══════════════

async def test_URUN_OLUSTURMA_yolu_SALEABLE_yaziyor(fab):
    """Kaynak sözleşmesi değil DAVRANIŞ: gerçek `create_product` yolundan
    geçen INITIAL hareketi hangi kovaya düşüyor?"""
    from models.admin import Admin
    from schemas.store import ProductCreate
    from services import store_service

    async with AsyncSessionLocal() as s:
        admin = (await s.execute(select(Admin).limit(1))).scalars().first()
        assert admin is not None, "seed admin yok"
        p = await store_service.create_product(
            s,
            admin,
            ProductCreate(
                title=f"Kova Yazici {_uniq()}",
                kind="PHYSICAL",
                price=Decimal("25.00"),
                stock=6,
            ),
        )
        await s.commit()
        pid = p.id
    fab.product_ids.append(pid)

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                select(StockMovement.bucket, StockMovement.movement_type)
                .where(StockMovement.product_id == pid)
            )
        ).all()
    assert satirlar == [("SALEABLE", "INITIAL")]
    assert await _kovalar(pid) == (6, 0)
    assert (await _dogrula(pid)).consistent is True


async def test_ADMIN_DUZELTMESI_yolu_SALEABLE_yaziyor(fab):
    """Admin ürün formu hasarlı kovaya ASLA dokunamaz."""
    from schemas.store import ProductUpdate
    from services import store_service

    pid = await fab.urun(stock=0)
    await _uygula(
        pid, bucket=SALEABLE, qty_delta=4,
        movement_type=StockMovementType.INITIAL, reason_code="PRODUCT_CREATE",
        ref_type="product", ref_id=pid, idempotency_key=f"product:{pid}:INITIAL",
        actor_type="ADMIN", actor_id=1,
    )
    await _hasar_transferi(pid, 1, olay_id=int(_uniq(), 16) % 10**6)
    onceki_hasarli = (await _kovalar(pid))[1]

    async with AsyncSessionLocal() as s:
        await store_service.update_product(
            s, pid,
            ProductUpdate(stock=10, stock_reason_code="TEDARIK"),
            admin_id=1,
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        kovalar = (
            await s.execute(
                select(StockMovement.bucket)
                .where(
                    StockMovement.product_id == pid,
                    StockMovement.movement_type == "ADMIN_ADJUSTMENT",
                )
            )
        ).scalars().all()
    assert kovalar == ["SALEABLE"]
    assert (await _kovalar(pid))[1] == onceki_hasarli, "hasarlı kova değişti"
    assert (await _dogrula(pid)).consistent is True
