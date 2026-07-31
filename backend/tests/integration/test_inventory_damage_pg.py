"""F29 hasarlı stok — çift hareket atomikliği ve kova değişmezleri.

Değişmezler (plan §5.5): transfer aynı transaction'da iki satır yazar; yalnız
yarısı yazılamaz; iki hareket ortak `stock_damage_events.id` ile bağlıdır;
retry çiftin tamamını replay eder; hiçbir kova negatife düşemez; dijital ürün
iki kovada da izlenmez; sıfır miktarlı olay yazılmaz.

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.inventory_factory import Fabrika
from tests.inventory_api import servis

ADMIN_ID = 1


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _kovalar(pid: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as db:
        r = (
            await db.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    return r.stock, r.damaged_stock


async def _hareketler(pid: int):
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT bucket, qty_delta, qty_after, movement_type, ref_type, "
                    "ref_id, idempotency_key FROM stock_movements "
                    "WHERE product_id = :i ORDER BY id"
                ),
                {"i": pid},
            )
        ).all()


# ── Transfer ───────────────────────────────────────────────────────────────

async def test_DAMAGE_TRANSFER_iki_kovayi_ayni_transactionda_gunceller(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        olay = await servis().damage_transfer(
            db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
        olay_id = olay.id

    assert await _kovalar(pid) == (7, 3)

    yeni = [h for h in await _hareketler(pid) if h.movement_type == "DAMAGE_TRANSFER"]
    assert len(yeni) == 2, "transfer TEK satır yazamaz"
    kova = {h.bucket: h for h in yeni}
    assert kova["SALEABLE"].qty_delta == -3
    assert kova["DAMAGED"].qty_delta == +3
    assert kova["SALEABLE"].qty_after == 7
    assert kova["DAMAGED"].qty_after == 3
    assert {h.ref_type for h in yeni} == {"damage_event"}
    assert {h.ref_id for h in yeni} == {olay_id}, "çift ortak olayla bağlanmalı"
    assert len({h.idempotency_key for h in yeni}) == 2, "anahtarlar kova bazlı ayrışmalı"


async def test_yetersiz_satilabilir_stokta_transfer_HICBIR_SATIR_yazmaz(fab):
    """Yarım transfer imkânsızlığının doğrudan provası: ilk satır yazılıp
    ikincisi patlarsa saleable düşer, damaged artmaz — kitap buharlaşır."""
    pid = await fab.urun(stock=2)
    once = await _hareketler(pid)
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            await servis().damage_transfer(
                db, pid, qty=5, reason_code="KIRIK", admin_id=ADMIN_ID
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) in (400, 409)
    assert await _kovalar(pid) == (2, 0)
    assert len(await _hareketler(pid)) == len(once)


async def test_transfer_RETRY_cifti_REPLAY_eder(fab):
    """Aynı olay iki kez işlenirse yeni hareket yazılmaz (deterministik anahtar)."""
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        olay = await servis().damage_transfer(
            db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
        olay_id = olay.id
    adet = len(await _hareketler(pid))

    async with AsyncSessionLocal() as db:
        await servis().replay_damage_event(db, olay_id)
        await db.commit()

    assert len(await _hareketler(pid)) == adet
    assert await _kovalar(pid) == (7, 3)


# ── Geri kazanım / imha / tedarikçi iadesi ─────────────────────────────────

async def test_DAMAGE_RECOVERY_hasarliyi_satilabilire_dondurur(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await servis().damage_transfer(
            db, pid, qty=4, reason_code="ISLAK", admin_id=ADMIN_ID
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        await servis().damage_recovery(
            db, pid, qty=2, reason_code="DIGER", note="kurutuldu", admin_id=ADMIN_ID
        )
        await db.commit()
    assert await _kovalar(pid) == (8, 2)


async def test_DAMAGE_DISPOSAL_yalniz_hasarli_kovayi_azaltir(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await servis().damage_transfer(
            db, pid, qty=4, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        await servis().damage_disposal(
            db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
    assert await _kovalar(pid) == (6, 1)
    imha = [h for h in await _hareketler(pid) if h.movement_type == "DAMAGE_DISPOSAL"]
    assert len(imha) == 1 and imha[0].bucket == "DAMAGED"


async def test_SUPPLIER_RETURN_secilen_kovadan_cikar(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await servis().supplier_return(
            db, pid, qty=2, bucket="SALEABLE", reason_code="BASKI_HATASI",
            admin_id=ADMIN_ID,
        )
        await db.commit()
    assert await _kovalar(pid) == (8, 0)


# ── Negatiflik ─────────────────────────────────────────────────────────────

async def test_hasarli_kova_NEGATIFE_dusemez(fab):
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await servis().damage_transfer(
            db, pid, qty=1, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            await servis().damage_disposal(
                db, pid, qty=5, reason_code="KIRIK", admin_id=ADMIN_ID
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) in (400, 409)
    assert await _kovalar(pid) == (9, 1)


async def test_satilabilir_kova_NEGATIFE_dusemez(fab):
    pid = await fab.urun(stock=1)
    with pytest.raises(HTTPException):
        async with AsyncSessionLocal() as db:
            await servis().supplier_return(
                db, pid, qty=9, bucket="SALEABLE", reason_code="DIGER",
                note="fazla", admin_id=ADMIN_ID,
            )
            await db.commit()
    assert await _kovalar(pid) == (1, 0)


# ── Dijital ve sıfır ───────────────────────────────────────────────────────

async def test_dijital_urunde_hasar_islemi_REDDEDILIR(fab):
    pid = await fab.urun(stock=None, kind="DIGITAL")
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            await servis().damage_transfer(
                db, pid, qty=1, reason_code="KIRIK", admin_id=ADMIN_ID
            )
    assert getattr(exc.value, "status_code", None) == 400


async def test_SIFIR_miktarli_hasar_olayi_YAZILMAZ(fab):
    pid = await fab.urun(stock=5)
    once = len(await _hareketler(pid))
    with pytest.raises(HTTPException):
        async with AsyncSessionLocal() as db:
            await servis().damage_transfer(
                db, pid, qty=0, reason_code="KIRIK", admin_id=ADMIN_ID
            )
            await db.commit()
    assert len(await _hareketler(pid)) == once


async def test_DIGER_gerekcesinde_not_ZORUNLU(fab):
    pid = await fab.urun(stock=5)
    with pytest.raises(HTTPException):
        async with AsyncSessionLocal() as db:
            await servis().damage_transfer(
                db, pid, qty=1, reason_code="DIGER", note=None, admin_id=ADMIN_ID
            )
            await db.commit()


# ── Kova bazlı zincir ──────────────────────────────────────────────────────

async def test_kova_zincirlerinin_son_qty_after_degeri_BAKIYEYE_esit(fab):
    """Defterin temel değişmezi kova boyutunda da geçerli olmalı."""
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await servis().damage_transfer(
            db, pid, qty=3, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
    stok, hasarli = await _kovalar(pid)
    async with AsyncSessionLocal() as db:
        son = {
            r.bucket: r.qty_after
            for r in (
                await db.execute(
                    text(
                        "SELECT DISTINCT ON (bucket) bucket, qty_after "
                        "FROM stock_movements WHERE product_id = :i "
                        "ORDER BY bucket, id DESC"
                    ),
                    {"i": pid},
                )
            ).all()
        }
    assert son["SALEABLE"] == stok
    assert son["DAMAGED"] == hasarli


async def test_hic_hareketi_olmayan_HASARLI_kova_ve_sifir_bakiye_GECERLI(fab):
    """Plan §5.3: gereksiz sıfır OPENING_BALANCE üretilmez; boş zincir +
    `damaged_stock = 0` bulgu DEĞİLDİR."""
    from services import stock_ledger

    pid = await fab.urun(stock=5)
    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert sonuc.consistent, f"boş hasarlı kova bulgu üretmemeli: {sonuc.problems}"


async def test_bakiye_varken_HASARLI_kovada_hareket_yoksa_BULGU(fab):
    """Karşı prova: sessiz bir `UPDATE damaged_stock` doğrulamadan kaçamaz."""
    from services import stock_ledger

    pid = await fab.urun(stock=5)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE products SET damaged_stock = 4 WHERE id = :i"), {"i": pid}
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert not sonuc.consistent
