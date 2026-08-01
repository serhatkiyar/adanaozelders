"""İP-2a · İade sonrası stok geri koyma — GERÇEK PG + gerçek stok defteri.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 S1-S4; §3 İP2A-10/11).

Kova sözleşmesi: RETURN hareketi DB CHECK gereği yalnız SALEABLE kovaya
yazılabilir; hasarlı iade iki adımlıdır (RETURN + damage_transfer). KIRMIZI
testler ``KNOWN-RED`` işaretlidir.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.database import AsyncSessionLocal
from schemas.store import OrderReturnItemIn
from services import inventory_damage, order_service, stock_ledger
from tests.integration.ip2a_factory import IadeFabrikasi, uniq


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _talep(order_id: int, *, tip: str, items=None):
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, order_id)
        assert order is not None
        return await order_service.request_return(
            db,
            order,
            "" if tip == "CAYMA" else "hasarli geldi",
            return_type=tip,
            items=items,
        )


# ── YEŞİL NÖBETÇİLER ─────────────────────────────────────────────────────────


async def test_g05_stok_geri_koyma_tekrari_ikinci_hareket_uretmez(fab, provider):
    """G-05: `_restock_items` tekrarı idempotent replay'dir — defter anahtarı
    (`return_line:{id}:RETURN`) ikinci hareketi engeller, stok değişmez."""
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 8
    talep = await _talep(sip.order_id, tip="CAYMA")  # otomatik settle → stok 10

    assert await fab.stok(pid) == 10
    assert len(await fab.hareketler(pid, "RETURN")) == 1

    # Retry/çökme senaryosunun simülasyonu: aynı telafi ikinci kez koşarsa.
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, sip.order_id)
        ret = await order_service._load_return(db, talep.id)
        await order_service._restock_items(db, order, ret)
        await db.commit()

    assert await fab.stok(pid) == 10, "tekrar çağrı stoku değiştiremez"
    assert len(await fab.hareketler(pid, "RETURN")) == 1, (
        "idempotency anahtarı ikinci RETURN hareketini engellemeli"
    )


async def test_g06_kismi_miktar_yalniz_o_kadar_stok_ekler(fab, provider):
    """G-06: qty=3'lük kalemden 2 adet iade yalnız +2'lik TEK hareket yazar."""
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 3)])  # stok 7
    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=2)],
    )

    donen = await fab.hareketler(pid, "RETURN")
    assert len(donen) == 1
    assert donen[0][1] == "SALEABLE"
    assert donen[0][2] == 2, "yalnız iade edilen miktar kadar stok eklenir"
    assert await fab.stok(pid) == 9


async def test_g07_hasarli_iade_dogru_kovaya_gider(fab, provider):
    """G-07: Hasarlı iadenin bugünkü sözleşmesi iki adımlıdır: RETURN yalnız
    SALEABLE'a yazılabilir (DB CHECK), hasar `damage_transfer` ile DAMAGED'a
    taşınır. Her iki yarısı da bugün doğru çalışır ve korunmalıdır."""
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 1)])  # stok 9
    talep = await _talep(sip.order_id, tip="CAYMA")  # stok 10 (SALEABLE)
    admin_id, _ = await fab.admin(izinler=[])

    # (a) Depo hasarlı buldu → SALEABLE −1, DAMAGED +1 (tek transaction).
    async with AsyncSessionLocal() as db:
        await inventory_damage.damage_transfer(
            db,
            pid,
            qty=1,
            reason_code="MUSTERI_IADESI_HASARLI",
            admin_id=admin_id,
            note=f"ip2a iade {talep.id}",
            idempotency_key=f"ip2a-dmg-{uniq()}",
        )
        await db.commit()

    async with AsyncSessionLocal() as s:
        stok, hasarli = (
            await s.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    assert stok == 9, "hasarlı adet satılabilir stoktan düşmeli"
    assert hasarli == 1, "hasarlı adet DAMAGED kovasında izlenmeli"
    bacaklar = {
        (m[1], m[2]) for m in await fab.hareketler(pid, "DAMAGE_TRANSFER")
    }
    assert bacaklar == {("SALEABLE", -1), ("DAMAGED", 1)}, (
        "hasar transferi iki bacaklı ve kova-doğru yazılmalı"
    )

    # (b) RETURN hareketi DAMAGED kovaya YAZILAMAZ — DB CHECK nöbette.
    with pytest.raises((IntegrityError, stock_ledger.StockLedgerError)):
        async with AsyncSessionLocal() as db:
            await stock_ledger.apply_movement(
                db,
                pid,
                qty_delta=1,
                bucket=stock_ledger.StockBucket.DAMAGED,
                movement_type=stock_ledger.StockMovementType.RETURN,
                reason_code="RETURN_ACCEPTED",
                ref_type="order",
                ref_id=sip.order_id,
                ref_line_id=sip.item_ids[0],
                idempotency_key=f"ip2a-ret-damaged-{uniq()}",
            )
            await db.commit()


async def test_g08_reddedilen_iade_stok_ve_para_uretmez(fab, provider):
    """G-08: Uygun bulunmayan (reddedilen) iade hiçbir stok/para hareketi
    üretmez; talep REJECTED'da kalır."""
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 8
    talep = await _talep(sip.order_id, tip="AYIPLI")

    async with AsyncSessionLocal() as db:
        await order_service.reject_return(db, talep.id, admin_note="kanıt yetersiz")

    assert provider.refund_calls == [], "reddedilen iade para hareketi üretemez"
    assert await fab.hareketler(pid, "RETURN") == []
    assert await fab.stok(pid) == 8
    satir = (await fab.iade_satirlari(sip.order_id))[0]
    assert satir["status"] == "REJECTED"
    assert satir["refund_status"] == "NONE"


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r10_teslim_alinmadan_stok_satisa_donmemeli(fab, provider):
    """R-10 · KNOWN-RED(İP2A-10): iade edilen fiziksel ürün işletmeye ulaşıp
    uygun bulunmadan SALEABLE stoğa dönmemelidir.

    Bugün: CAYMA talebi anında para iadesi + anında `RETURN` hareketi üretir
    (`RETURN_RECEIVED` akışı bilinçli olarak yok — inventory_rules.py:82-85).
    Kitap hâlâ müşterinin elindeyken katalog 'stokta var' gösterir; hasarlı
    gelen ürünün DAMAGED'a taşınması tamamen elle bir adıma bırakılmıştır.
    Ödemenin zamanlaması ürün kararıdır (PK-α) — bu test yalnız STOK
    kesinleşmesini ölçer.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 8; kitaplar müşteriye gitti
    await _talep(sip.order_id, tip="CAYMA")

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDED"  # ön koşul: para süreci yürüdü
    assert await fab.hareketler(pid, "RETURN") == [], (
        "KNOWN-RED(İP2A-10): mal daha işletmeye ulaşmadan RETURN hareketi "
        "yazıldı — fiziksel kabul/muayene adımı olmadan stok satılabilir "
        "görünüyor (sözleşme S4/PK-α)"
    )
    assert await fab.stok(pid) == 8, (
        "KNOWN-RED(İP2A-10): teslim alınmamış iade satılabilir stoğa eklendi"
    )
