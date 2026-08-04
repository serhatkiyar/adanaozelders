"""İP-2a · İade sonrası stok geri koyma — GERÇEK PG + gerçek stok defteri.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 S1-S4; §3 İP2A-10; §9 PK-α).

Kova sözleşmesi: RETURN hareketi DB CHECK gereği yalnız SALEABLE kovaya
yazılabilir; hasarlı iade iki adımlıdır (RETURN + damage_transfer).

## PK-α sonrası kurulum değişikliği (bilinçli)

Stok artık **para iadesinde değil, fiziksel kabulde** döner. Bu yüzden stok
davranışını ölçen her senaryo `fab.teslim_al(...)` adımını AÇIKÇA geçer;
"para döndü, stok da dönmüştür" varsayımı tam olarak İP2A-10'un kendisiydi.
Nöbetçilerin ölçtüğü iddialar (idempotent replay, kısmi miktar, kova
doğruluğu) değişmedi — yalnız hareketi doğuran adım değişti.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.database import AsyncSessionLocal
from models.admin import Admin
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
    talep = await _talep(sip.order_id, tip="CAYMA")  # para iadesi (stok DEĞİŞMEZ)
    assert await fab.stok(pid) == 8, "PK-α: para iadesi tek başına stok üretmez"
    await fab.teslim_al(talep.id)  # fiziksel kabul → stok 10

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
    talep = await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=2)],
    )
    await fab.teslim_al(talep.id)

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
    talep = await _talep(sip.order_id, tip="CAYMA")  # para iadesi
    await fab.teslim_al(talep.id)  # fiziksel kabul → stok 10 (SALEABLE)
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
    """R-10 · İP2A-10 / PK-α: stok yalnız FİZİKSEL KABULLE döner.

    Testin ölçtüğü iddia iki bacaklıdır ve ürün kararı (PK-α) onaylandıktan
    sonra ikinci bacak eklenmiştir — tarihsel hâli yalnız "para iadesinde stok
    artmamalı" diyordu ve doğru davranışın nasıl göründüğünü ölçmüyordu:

    1. Para iadesi kesinleşse bile mal işletmeye ULAŞMADAN hiçbir kovaya
       girmez (kitap hâlâ müşterinin elinde; katalog "stokta var" diyemez).
    2. Fiziksel kabulden sonra dönüş TAM BİR KEZ ve DOĞRU kovada gerçekleşir.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])  # stok 8; kitaplar müşteriye gitti
    await _talep(sip.order_id, tip="CAYMA")

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDED"  # ön koşul: para süreci yürüdü
    assert talep["received_at"] is None, "ön koşul: mal henüz teslim alınmadı"
    assert await fab.hareketler(pid, "RETURN") == [], (
        "İP2A-10/PK-α: mal daha işletmeye ulaşmadan RETURN hareketi yazıldı — "
        "fiziksel kabul/muayene adımı olmadan stok satılabilir görünüyor"
    )
    assert await fab.stok(pid) == 8, (
        "İP2A-10/PK-α: teslim alınmamış iade satılabilir stoğa eklendi"
    )

    # ── İkinci bacak: fiziksel kabul stoğu TAM BİR KEZ geri koyar ──
    await fab.teslim_al(talep["id"])
    donen = await fab.hareketler(pid, "RETURN")
    assert len(donen) == 1 and donen[0][1] == "SALEABLE" and donen[0][2] == 2, (
        f"fiziksel kabul sonrası tek SALEABLE dönüşü beklenir, görülen: {donen}"
    )
    assert await fab.stok(pid) == 10
    satir = (await fab.iade_satirlari(sip.order_id))[0]
    assert satir["received_at"] is not None, "kabul damgası yazılmalı"


async def test_r10b_hasarli_kabul_dogru_kovaya_gider(fab, provider):
    """PK-α: kabul edilen hasarlı adet SALEABLE'a değil DAMAGED'a gider.

    Net etki tek işlemde ölçülür: satılabilir yalnız sağlam adet kadar artar,
    hasarlı adet hasarlı kovada birikir. (Defter iki bacaklıdır — `RETURN`
    yalnız SALEABLE'a yazılabildiği için hasar `DAMAGE_TRANSFER` ile taşınır;
    bkz. G-07.)
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 3)])  # stok 7
    talep = await _talep(sip.order_id, tip="CAYMA")
    kalemler = await fab.iade_kalemleri(talep.id)
    assert len(kalemler) == 1 and kalemler[0]["quantity"] == 3

    await fab.teslim_al(talep.id, hasarli={kalemler[0]["id"]: 2})

    async with AsyncSessionLocal() as s:
        stok, hasarli = (
            await s.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    assert stok == 8, "yalnız SAĞLAM adet (1) satılabilir stoğa eklenmeli"
    assert hasarli == 2, "hasarlı adet DAMAGED kovasında izlenmeli"
    son = (await fab.iade_kalemleri(talep.id))[0]
    assert (son["accepted_quantity"], son["damaged_quantity"]) == (1, 2)


async def test_r10c_kabul_edilmeyen_adet_hicbir_kovaya_girmez(fab, provider):
    """PK-α: gelmeyen adet stoğa yazılmaz; kabul TEKRARI ikinci hareket üretmez.

    "Müşteri 3 kitap iade edeceğini söyledi ama kutudan 1 çıktı" gerçek bir
    depo vakasıdır. Beyan edilen adet değil, TESLİM ALINAN adet stoğa döner —
    ve saha ekranında ikinci dokunuş stoğu bir daha artıramaz.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 3)])  # stok 7
    talep = await _talep(sip.order_id, tip="CAYMA")
    kalem = (await fab.iade_kalemleri(talep.id))[0]

    admin_id, _ = await fab.admin(izinler=["returns.view", "returns.manage"])
    async with AsyncSessionLocal() as db:
        admin = await db.get(Admin, admin_id)
        await order_service.receive_return(
            db,
            talep.id,
            lines=[order_service.ReceiveLine(kalem["id"], 1, 0)],  # yalnız 1 geldi
            actor=admin,
        )

    assert await fab.stok(pid) == 8, "yalnız teslim alınan 1 adet stoğa dönmeli"
    assert len(await fab.hareketler(pid, "RETURN")) == 1

    # Tekrarlı kabul (saha ekranında çift dokunuş) idempotent no-op'tur.
    async with AsyncSessionLocal() as db:
        admin = await db.get(Admin, admin_id)
        await order_service.receive_return(
            db,
            talep.id,
            lines=[order_service.ReceiveLine(kalem["id"], 3, 0)],
            actor=admin,
        )
    assert await fab.stok(pid) == 8, "tekrarlı kabul ikinci kez stok üretemez"
    assert len(await fab.hareketler(pid, "RETURN")) == 1
    son = (await fab.iade_kalemleri(talep.id))[0]
    assert son["accepted_quantity"] == 1, "ilk kabul kaydı ezilemez"


async def test_r10d_onaylanmamis_talebin_mali_teslim_alinamaz(fab, provider):
    """PK-α: kabul, onaylanmış talebe bağlıdır — PENDING talep stok üretemez."""
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])
    talep = await _talep(sip.order_id, tip="AYIPLI")  # PENDING kalır
    kalem = (await fab.iade_kalemleri(talep.id))[0]

    admin_id, _ = await fab.admin(izinler=["returns.view", "returns.manage"])
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            admin = await db.get(Admin, admin_id)
            await order_service.receive_return(
                db,
                talep.id,
                lines=[order_service.ReceiveLine(kalem["id"], 2, 0)],
                actor=admin,
            )
    assert exc.value.status_code == 409
    assert await fab.hareketler(pid, "RETURN") == []
    assert await fab.stok(pid) == 8
