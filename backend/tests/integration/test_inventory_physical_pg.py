"""F29 fiziksel stok semantiği — ON_PREMISE, rezerve ve SHIPPED ayrımı.

Bu dosya paketin **kavramsal çekirdeğini** ölçer: `products.stock` satılabilir
miktardır, işletmedeki fiziksel kitap sayısı DEĞİLDİR.

Kanıt zinciri (üretim kodundan):
* `SALE` ödeme anında yazılır — `order_service.py:703`
* kitap işletmeden tur başlarken çıkar — `delivery_service.py:467` (`SHIPPED`)
* teslim edilemeyen paket işletmeye döner — `order_service.py:159`
* iade stoğu **fiziksel kabulden önce** yazılır — `order_service.py:1717`

Bu testler "eski/naif uygulamanın" geçemeyeceği testlerdir: `counted - stock`
ile çalışan bir sayım, aşağıdaki ilk üç testin hepsinde yanlış sonuç üretir.

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
"""
from __future__ import annotations

import pytest
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


async def _on_premise(pid: int):
    async with AsyncSessionLocal() as db:
        sonuc = await servis().expected_on_premise(db, [pid])
    return sonuc[pid]


# ── reserved_on_premise ────────────────────────────────────────────────────

async def test_SALE_fiziksel_ON_PREMISE_miktarini_DEGISTIRMEZ(fab):
    """Ödeme kitabı işletmeden çıkarmaz; yalnız satılabilirlikten düşürür.

    Naif uygulama (`expected = products.stock`) burada 8 der ve sayımda 10
    bulan personelin +2 fazlası varmış gibi görünür.
    """
    pid = await fab.urun(stock=10)
    await fab.siparis(product_id=pid, quantity=2)      # SALE −2

    assert await fab.stok(pid) == 8
    op = await _on_premise(pid)
    assert op.saleable == 8
    assert op.reserved == 2
    assert op.damaged == 0
    assert op.total == 10, "kitap hâlâ işletmede; ON_PREMISE değişmemeliydi"


async def test_SHIPPED_siparis_ON_PREMISE_hesabindan_CIKAR(fab):
    """Tur başladı = kurye kontrolüne geçti (`delivery_service.py:467`)."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()

    op = await _on_premise(pid)
    assert op.reserved == 0, "SHIPPED kalem rezerve sayılmamalı"
    assert op.total == 8


async def test_DELIVERED_siparis_ON_PREMISE_hesabinda_YOK(fab):
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=3)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'DELIVERED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    op = await _on_premise(pid)
    assert op.reserved == 0
    assert op.total == 7


async def test_HAZIRLANMIS_ama_tura_girmemis_paket_ON_PREMISE_ICINDE(fab):
    """`prepared_at` paketi işletmede tutar (`delivery_service.py:765`).
    Hazırlık damgası rezerveyi düşürürse, paketleme masasındaki kitaplar
    sayımda 'fazla' görünür."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET prepared_at = now(), prepared_by = 'test' "
                 "WHERE id = :i"),
            {"i": oid},
        )
        await db.commit()
    op = await _on_premise(pid)
    assert op.reserved == 2
    assert op.total == 10


async def test_TESLIM_EDILEMEYEN_paket_ON_PREMISEe_geri_doner(fab):
    """Başarısız teslimat siparişi PAID'e döndürür (`order_service.py:158`)."""
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'SHIPPED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    assert (await _on_premise(pid)).total == 8

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'PAID', prepared_at = NULL, "
                 "failed_delivery_count = 1 WHERE id = :i"),
            {"i": oid},
        )
        await db.commit()
    op = await _on_premise(pid)
    assert op.reserved == 2
    assert op.total == 10


async def test_ODENMEMIS_siparis_rezerve_SAYILMAZ(fab):
    """PENDING sipariş stoktan düşmez; rezerve de değildir. İki kez sayılırdı."""
    pid = await fab.urun(stock=10)
    await fab.siparis(
        product_id=pid, quantity=2, status="PENDING",
        payment_status="PENDING", sale_yaz=False,
    )
    op = await _on_premise(pid)
    assert op.saleable == 10 and op.reserved == 0 and op.total == 10


async def test_IPTAL_EDILMIS_siparis_rezerve_SAYILMAZ(fab):
    pid = await fab.urun(stock=10)
    oid = await fab.siparis(product_id=pid, quantity=2)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE orders SET status = 'CANCELLED' WHERE id = :i"), {"i": oid}
        )
        await db.commit()
    assert (await _on_premise(pid)).reserved == 0


# ── Sayımın rezerveyi hesaba katması ───────────────────────────────────────

async def _say_ve_uygula(fab, pid: int, sayilan: int, *, hasarli: int = 0):
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satirlar = (
            await db.execute(
                text(
                    "SELECT id, bucket FROM stock_count_lines WHERE session_id = :s"
                ),
                {"s": sid},
            )
        ).all()
        for r in satirlar:
            await s_mod.set_counted(
                db, r.id, sayilan if r.bucket == "SALEABLE" else hasarli,
                admin_id=ADMIN_ID,
            )
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key=f"k{sid}")
        await db.commit()
    return sid


async def test_rezerve_kadar_sayan_personel_FARK_URETMEZ(fab):
    """Kullanıcının senaryosu: stok 10, arada 2 satış, rafta 10 kitap duruyor.

    Naif `counted - stock` = 10 − 8 = **+2** yazardı (yanlış).
    Doğru: beklenen ON_PREMISE = 8 + 2 = 10 → fark 0, hareket yok.
    """
    pid = await fab.urun(stock=10)
    await fab.siparis(product_id=pid, quantity=2)
    hareket_once = await fab.hareket_sayisi(pid)

    await _say_ve_uygula(fab, pid, 10)

    assert await fab.stok(pid) == 8
    assert await fab.hareket_sayisi(pid) == hareket_once


async def test_gercekten_EKSIK_sayimda_satilabilir_stok_duser(fab):
    """Aynı kurulum, personel 8 sayıyor: 2 kitap fiziksel olarak kayıp."""
    pid = await fab.urun(stock=10)
    await fab.siparis(product_id=pid, quantity=2)

    await _say_ve_uygula(fab, pid, 8)

    assert await fab.stok(pid) == 6
    op = await _on_premise(pid)
    assert op.total == 8, "yeniden hesaplanan ON_PREMISE sayılana eşitlenmeli"


# ── RETURN belirsizliği ────────────────────────────────────────────────────

async def test_fiziksel_kabulu_olmayan_RETURN_satiri_STALE_yapar(fab):
    """`RETURN` hareketi iade ONAYINDA yazılıyor (`order_service.py:1717`);
    kitabın işletmeye ulaşıp ulaşmadığı bilinmiyor. Sayım bunu 'eksik' diye
    düzeltirse, yolda olan kitabı kayıp ilan eder."""
    pid = await fab.urun(stock=10)
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satir_id = (
            await db.execute(
                text(
                    "SELECT id FROM stock_count_lines WHERE session_id = :s "
                    "AND bucket = 'SALEABLE'"
                ),
                {"s": sid},
            )
        ).scalar_one()
        await s_mod.set_counted(db, satir_id, 10, admin_id=ADMIN_ID)
        await db.commit()

    # Sayımdan SONRA iade onaylanıyor
    oid = await fab.siparis(product_id=pid, quantity=1, sale_yaz=False)
    async with AsyncSessionLocal() as db:
        from services import stock_ledger

        await stock_ledger.apply_movement(
            db, pid, qty_delta=+1,
            movement_type=stock_ledger.StockMovementType.RETURN,
            reason_code="IADE",
            ref_type="order_return", ref_id=oid, ref_line_id=oid,
            idempotency_key=f"test-return:{oid}",
        )
        await db.commit()

    async with AsyncSessionLocal() as db:
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        durum = (
            await db.execute(
                text("SELECT status, stale_reason FROM stock_count_lines WHERE id = :i"),
                {"i": satir_id},
            )
        ).one()
    assert durum.status == "STALE"
    assert durum.stale_reason, "STALE sebebi operatöre gösterilmek üzere yazılmalı"


async def test_sayimdan_sonraki_SALE_satiri_STALE_YAPMAZ(fab):
    """Karşı prova: fiziksel etkisi KESİN olan olay uzlaştırılır, engellemez.

    Bu test olmadan 'her hareket STALE yapsın' gibi aşırı-korumacı bir
    uygulama da yeşil kalırdı ve sayım pratikte hiç uygulanamazdı.
    """
    pid = await fab.urun(stock=10)
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        for r in (
            await db.execute(
                text("SELECT id, bucket FROM stock_count_lines WHERE session_id = :s"),
                {"s": sid},
            )
        ).all():
            await s_mod.set_counted(
                db, r.id, 10 if r.bucket == "SALEABLE" else 0, admin_id=ADMIN_ID
            )
        await db.commit()

    await fab.siparis(product_id=pid, quantity=3)      # sayımdan SONRA satış

    async with AsyncSessionLocal() as db:
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        durumlar = (
            await db.execute(
                text("SELECT status FROM stock_count_lines WHERE session_id = :s"),
                {"s": sid},
            )
        ).scalars().all()
    assert "STALE" not in durumlar

    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k")
        await db.commit()
    assert await fab.stok(pid) == 7, "satış korunmalı, sayım fark üretmemeli"
