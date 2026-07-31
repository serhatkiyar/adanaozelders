"""F29 hasar servisi — GERÇEK PostgreSQL eşzamanlılık ve idempotency (commit 6).

`test_inventory_lock_order_pg.py` beş çiftin kilit sırasını ölçer; bu dosya
commit 6'nın **kendi** sözleşmesini ölçer: idempotency, yetersiz stok yarışı,
append-only koruması ve transaction sınırı.

## Determinizm

Hiçbir test `sleep` ile yarış sonucu beklemez. Pencere ya **commit edilmemiş
bir transaction** ile ya da **ürün kilidinin kendisiyle** açılır; PostgreSQL
kilit semantiği sonucu belirler.

⚠️ `asyncio.gather(return_exceptions=True)` her hatayı sonuç listesine gömer.
Yalnız PG kilit kodlarına bakan bir nöbetçi, görevin hiç çalışmamış olmasını da
"sorun yok" sayar — bu tuzağa bu pakette bir kez düşüldü. Beklenen iş kuralı
hataları dışındaki her istisna yeniden yükseltilir.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import inventory_damage, inventory_service, stock_ledger
from tests.integration.inventory_factory import Fabrika

ADMIN_ID = 1
LOCK_TIMEOUT = "4s"
DEADLOCK = "40P01"
LOCK_TIMEOUT_CODE = "55P03"
SALEABLE = stock_ledger.StockBucket.SALEABLE


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


def _pg_code(exc: BaseException) -> str | None:
    for cand in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        kod = getattr(cand, "sqlstate", None) or getattr(cand, "pgcode", None)
        if kod:
            return kod
    return None


def _kilit_hatasi_yok(sonuclar) -> None:
    from fastapi import HTTPException

    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = _pg_code(r)
        if kod == DEADLOCK:
            pytest.fail(f"DEADLOCK (40P01): {r}", pytrace=False)
        if kod == LOCK_TIMEOUT_CODE:
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03): {r}", pytrace=False)
        if isinstance(r, HTTPException) and r.status_code in (400, 409):
            continue
        if isinstance(r, stock_ledger.StockLedgerError):
            continue
        raise r


async def _kovalar(pid: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as db:
        r = (
            await db.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    return int(r.stock), int(r.damaged_stock)


async def _olay_sayisi(pid: int) -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text("SELECT count(*) FROM stock_damage_events WHERE product_id = :i"),
                {"i": pid},
            )
        ).scalar_one()


async def _transfer(pid: int, adet: int, *, key: str | None = None):
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        olay = await inventory_damage.damage_transfer(
            db, pid, qty=adet, reason_code="KIRIK", admin_id=ADMIN_ID,
            idempotency_key=key,
        )
        await db.commit()
        return olay.id


async def _zincir_saglam(pid: int) -> None:
    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert sonuc.consistent, f"defter bozuk: {sonuc.problems}"


# ══════════ İdempotency ══════════

async def test_AYNI_anahtar_AYNI_payload_REPLAY_eder(fab):
    """Ağ koptu, istemci aynı isteği tekrarladı: yeni olay ve yeni hareket YOK."""
    pid = await fab.urun(stock=10)
    anahtar = f"hasar-{_uniq()}"
    ilk = await _transfer(pid, 3, key=anahtar)
    assert await _kovalar(pid) == (7, 3)

    ikinci = await _transfer(pid, 3, key=anahtar)
    assert ikinci == ilk, "aynı anahtar YENİ olay üretti"
    assert await _kovalar(pid) == (7, 3), "replay bakiyeyi değiştirdi"
    assert await _olay_sayisi(pid) == 1
    assert await fab.hareket_sayisi(pid) == 3   # INITIAL + 2 transfer bacağı


async def test_AYNI_anahtar_FARKLI_payload_CATISIR(fab):
    """Aynı anahtarla farklı miktar/kova gelmesi sessiz replay DEĞİL çelişkidir."""
    pid = await fab.urun(stock=10)
    anahtar = f"hasar-{_uniq()}"
    await _transfer(pid, 3, key=anahtar)

    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_transfer(
                db, pid, qty=5, reason_code="KIRIK", admin_id=ADMIN_ID,
                idempotency_key=anahtar,
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409
    assert "qty" in str(exc.value.detail)
    assert await _kovalar(pid) == (7, 3)


async def test_YENI_anahtar_ayni_isi_TEKRAR_yapar(fab):
    """Yeni anahtar = yeni iş talebi; stok yeterliyse çalışır."""
    pid = await fab.urun(stock=10)
    await _transfer(pid, 3, key=f"a-{_uniq()}")
    await _transfer(pid, 3, key=f"b-{_uniq()}")
    assert await _kovalar(pid) == (4, 6)
    assert await _olay_sayisi(pid) == 2


async def test_YENI_anahtar_stok_yetmezse_CALISMAZ(fab):
    pid = await fab.urun(stock=4)
    await _transfer(pid, 3, key=f"a-{_uniq()}")
    with pytest.raises(Exception) as exc:
        await _transfer(pid, 3, key=f"b-{_uniq()}")
    assert getattr(exc.value, "status_code", None) == 409
    assert await _kovalar(pid) == (1, 3)
    assert await _olay_sayisi(pid) == 1


async def test_ANAHTARSIZ_cagri_her_seferinde_YENI_is(fab):
    """Anahtar isteğe bağlıdır; verilmezse her çağrı yeni bir olaydır."""
    pid = await fab.urun(stock=10)
    await _transfer(pid, 2)
    await _transfer(pid, 2)
    assert await _kovalar(pid) == (6, 4)
    assert await _olay_sayisi(pid) == 2


async def test_ESZAMANLI_AYNI_anahtar_TEK_olay_uretir(fab):
    """İki istek aynı anda, aynı anahtarla. Ürün kilidi onları sıraya sokar;
    ikincisi birincinin olayını görüp replay eder."""
    pid = await fab.urun(stock=10)
    anahtar = f"es-{_uniq()}"

    # DETERMİNİSTİK pencere: ürün kilidi bir transaction'da TUTULURKEN üç istek
    # de başlatılır, sonra kilit bırakılır. Böylece üçü de aynı anda "uçuşta"
    # olur — `sleep` ile şansa bırakılmaz.
    tutan = AsyncSessionLocal()
    try:
        await stock_ledger.lock_products(tutan, [pid])
        gorevler = [
            asyncio.create_task(_transfer(pid, 3, key=anahtar)) for _ in range(3)
        ]
        await asyncio.sleep(0.3)
        assert all(not g.done() for g in gorevler), "istekler ürün kilidini beklemedi"
    finally:
        await tutan.rollback()
        await tutan.close()
    sonuclar = await asyncio.gather(*gorevler, return_exceptions=True)

    # Ürün kilidi kaldırılırsa üçü de "kayıt yok" görür, üçü de olay yazmaya
    # kalkar ve `uq_stock_damage_events_idem` üzerinde IntegrityError sızdırır;
    # nöbetçi beklenmeyen istisnayı yeniden yükseltir.
    _kilit_hatasi_yok(sonuclar)
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    assert len(basarili) == 3, f"üçü de replay/başarı olmalıydı: {sonuclar}"
    assert len(set(basarili)) == 1, "birden fazla olay üretildi"
    assert await _kovalar(pid) == (7, 3)
    assert await _olay_sayisi(pid) == 1
    await _zincir_saglam(pid)


async def test_ESZAMANLI_FARKLI_anahtar_IKI_olay_uretir(fab):
    pid = await fab.urun(stock=10)
    sonuclar = await asyncio.gather(
        _transfer(pid, 3, key=f"x-{_uniq()}"),
        _transfer(pid, 3, key=f"y-{_uniq()}"),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    assert len([r for r in sonuclar if not isinstance(r, BaseException)]) == 2
    assert await _kovalar(pid) == (4, 6)
    assert await _olay_sayisi(pid) == 2
    await _zincir_saglam(pid)


async def test_YETERSIZ_STOK_yarisinda_YALNIZ_MUMKUN_OLAN_KADAR_kazanir(fab):
    """Stok 5, üç istek 2'şer adet: **tam olarak iki** kazanmalı.

    Kırpma yasak; üçüncü istek 409 alır ve hiçbir satır bırakmaz.
    """
    pid = await fab.urun(stock=5)
    sonuclar = await asyncio.gather(
        _transfer(pid, 2, key=f"k1-{_uniq()}"),
        _transfer(pid, 2, key=f"k2-{_uniq()}"),
        _transfer(pid, 2, key=f"k3-{_uniq()}"),
        return_exceptions=True,
    )
    _kilit_hatasi_yok(sonuclar)
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    assert len(basarili) == 2, f"kazanan sayısı yanlış: {sonuclar}"
    assert await _kovalar(pid) == (1, 4)
    assert await _olay_sayisi(pid) == 2
    await _zincir_saglam(pid)


# ══════════ Kova çiftinin atomikliği ══════════

async def test_YETERSIZ_stokta_HICBIR_olay_ve_hareket_kalmaz(fab):
    """Yetersizlikte hiçbir iz kalmaz **ve** hata operatöre hangi kovada ne
    kadar eksik olduğunu söyler.

    Mesaj sözleşmenin parçasıdır: servis ön kontrolü kaldırılırsa hata yine
    409 olur ama defterin genel mesajına düşer ve operatör hangi kovaya
    bakacağını öğrenemez. Mutasyon provasında tam olarak bu görüldü.
    """
    pid = await fab.urun(stock=2)
    hareket_once = await fab.hareket_sayisi(pid)
    with pytest.raises(Exception) as exc:
        await _transfer(pid, 5)
    assert getattr(exc.value, "status_code", None) == 409
    detay = str(exc.value.detail)
    assert "SALEABLE" in detay, detay
    assert "2" in detay and "5" in detay, detay
    assert await _kovalar(pid) == (2, 0)
    assert await _olay_sayisi(pid) == 0, "olay satırı kaldı"
    assert await fab.hareket_sayisi(pid) == hareket_once


async def test_OLAY_ve_HAREKETLER_AYNI_transactionda(fab):
    """Transaction sınırı provası: servis `commit` YAPMAZ.

    Çağıran commit etmezse ne olay ne hareket ne de bakiye kalır — üçü de aynı
    transaction'ın parçasıdır.
    """
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await inventory_damage.damage_transfer(
            db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        # COMMIT YOK — session kapanınca rollback.
    assert await _kovalar(pid) == (10, 0)
    assert await _olay_sayisi(pid) == 0
    async with AsyncSessionLocal() as db:
        hareket = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_movements WHERE product_id = :i "
                    "AND movement_type = 'DAMAGE_TRANSFER'"
                ),
                {"i": pid},
            )
        ).scalar_one()
    assert hareket == 0


# ══════════ Append-only koruması ══════════

async def test_hasar_olayi_UPDATE_ve_DELETE_reddedilir(fab):
    """Trigger gerçek DB'de sınanır: iz sonradan sessizce değiştirilemez."""
    from sqlalchemy.exc import DBAPIError, IntegrityError

    pid = await fab.urun(stock=10)
    olay_id = await _transfer(pid, 2)
    for sql in (
        "UPDATE stock_damage_events SET qty = 9 WHERE id = :i",
        "DELETE FROM stock_damage_events WHERE id = :i",
    ):
        with pytest.raises((IntegrityError, DBAPIError)) as exc:
            async with AsyncSessionLocal() as db:
                await db.execute(text(sql), {"i": olay_id})
                await db.commit()
        assert "append-only" in str(exc.value).lower()


# ══════════ Diğer işlemlerin eşzamanlılığı ══════════

async def test_IMHA_ve_TRANSFER_yarisi(fab):
    """İmha hasarlı kovadan düşer, transfer ona ekler. İkisi aynı anda."""
    pid = await fab.urun(stock=10)
    await _transfer(pid, 4, key=f"hazirlik-{_uniq()}")

    async def imha():
        async with AsyncSessionLocal() as db:
            await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            await inventory_damage.damage_disposal(
                db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
            )
            await db.commit()

    sonuclar = await asyncio.gather(
        imha(), _transfer(pid, 2), return_exceptions=True
    )
    _kilit_hatasi_yok(sonuclar)
    satilabilir, hasarli = await _kovalar(pid)
    assert satilabilir == 4 and hasarli == 3, (satilabilir, hasarli)
    await _zincir_saglam(pid)


async def test_KURTARMA_ve_SAYIM_APPLY_yarisi(fab):
    """Kurtarma iki kovayı da değiştirir; sayım uygulaması satılabilire yazar."""
    pid = await fab.urun(stock=20)
    await _transfer(pid, 5, key=f"hazirlik-{_uniq()}")   # 15 / 5

    async with AsyncSessionLocal() as db:
        oturum = await inventory_service.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await inventory_service.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in (
            await db.execute(
                text("SELECT id, bucket FROM stock_count_lines WHERE session_id = :s"),
                {"s": sid},
            )
        ).all():
            await inventory_service.set_counted(
                db, r.id, 15 if r.bucket == "SALEABLE" else 5, admin_id=ADMIN_ID
            )
        await inventory_service.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    async def uygula():
        async with AsyncSessionLocal() as db:
            await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            await inventory_service.apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key=f"u-{_uniq()}"
            )
            await db.commit()

    async def kurtar():
        async with AsyncSessionLocal() as db:
            await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            await inventory_damage.damage_recovery(
                db, pid, qty=2, reason_code="DIGER", note="kurutuldu",
                admin_id=ADMIN_ID,
            )
            await db.commit()

    sonuclar = await asyncio.gather(uygula(), kurtar(), return_exceptions=True)
    _kilit_hatasi_yok(sonuclar)
    # Sayım farkı 0 (sayılan = beklenen); kurtarma 2 adeti hasarlıdan alır.
    assert await _kovalar(pid) == (17, 3)
    await _zincir_saglam(pid)


async def test_TEDARIKCI_IADESI_yalniz_SECILEN_kovadan_duser(fab):
    """Diğer kovaya sessiz transfer YOK."""
    pid = await fab.urun(stock=10)
    await _transfer(pid, 4, key=f"hazirlik-{_uniq()}")   # 6 / 4
    async with AsyncSessionLocal() as db:
        await inventory_damage.supplier_return(
            db, pid, qty=3, bucket="DAMAGED", reason_code="BASKI_HATASI",
            admin_id=ADMIN_ID,
        )
        await db.commit()
    assert await _kovalar(pid) == (6, 1)
    async with AsyncSessionLocal() as db:
        kovalar = (
            await db.execute(
                text(
                    "SELECT bucket FROM stock_movements WHERE product_id = :i "
                    "AND movement_type = 'SUPPLIER_RETURN'"
                ),
                {"i": pid},
            )
        ).scalars().all()
    assert kovalar == ["DAMAGED"], "başka kovaya da hareket yazılmış"


async def test_TEDARIKCI_IADESINDE_kova_ZORUNLU(fab):
    pid = await fab.urun(stock=10)
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_damage.supplier_return(
                db, pid, qty=1, bucket="RAFTA", reason_code="KIRIK",
                admin_id=ADMIN_ID,
            )
    assert getattr(exc.value, "status_code", None) == 400


# ══════════ Kilit disiplini ══════════

def test_hasar_servisi_KENDI_kilidini_ACMAZ():
    """Ürün kilidi alan TEK yer `stock_ledger.lock_products` olmalı.

    ⚠️ Bu **düşük güçlü** bir kaynak sözleşmesidir ve mutasyon provasında
    öğrenilen bir sınırın karşılığıdır: `lock_products`'ın kendi sıralamasını
    ters çevirmek gerçek bir kusur DEĞİLDİR — tek huni olduğu için bütün
    çağıranlar aynı (ters) sırayı alır ve döngü doğmaz. Gerçek risk, bir
    servisin **kendi** sıralamasıyla ikinci bir kilit yolu açmasıdır; ölçülen
    budur. Davranış eşi: `test_inventory_lock_order_pg.py` beş çift.
    """
    import ast
    import pathlib as _p

    kaynak = (
        _p.Path(__file__).resolve().parents[2] / "services" / "inventory_damage.py"
    ).read_text(encoding="utf-8")
    agac = ast.parse(kaynak)
    for d in ast.walk(agac):
        if isinstance(d, ast.Call) and "with_for_update" in ast.unparse(d.func):
            raise AssertionError(
                f"hasar servisi kendi ürün kilidini açıyor: {ast.unparse(d)}"
            )
    assert "lock_products" in kaynak, "ürün kilidi hiç alınmıyor"


async def test_hasar_islemi_URUN_KILIDINI_bekler(fab):
    """Davranış: kilit gerçekten alınıyor mu? Ürün başka bir transaction'da
    kilitliyken hasar işlemi BEKLER (kod okumasıyla değil, kilitle kanıt)."""
    pid = await fab.urun(stock=10)
    tutan = AsyncSessionLocal()
    gorev = None
    try:
        await stock_ledger.lock_products(tutan, [pid])

        async def transfer():
            async with AsyncSessionLocal() as db:
                await db.execute(text("SET LOCAL lock_timeout = '10s'"))
                await inventory_damage.damage_transfer(
                    db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID
                )
                await db.commit()

        gorev = asyncio.create_task(transfer())
        await asyncio.sleep(0.3)
        assert not gorev.done(), "hasar işlemi ürün kilidini beklemedi"
    finally:
        await tutan.rollback()
        await tutan.close()
    await gorev
    assert await _kovalar(pid) == (8, 2)
