"""İP-2b — sipariş iptali yarışları (GERÇEK PostgreSQL, deterministik).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §6.4-§6.5

Determinizm: sleep tabanlı pencere yerine `StubProvider.refund_gate`
(asyncio.Event) — sağlayıcı çağrısı, event set edilene dek bekletilir; iki
akış "durum okundu ama yazılmadı" penceresinde KESİN buluşur.

Her testte para+stok+geçmiş bütünü birlikte ölçülür (yalnız HTTP status değil).
"""
from __future__ import annotations

import asyncio
import logging

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import delivery_service, order_service

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int) -> str | None:
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        try:
            await order_service.cancel_by_client(s, order)
            return "cancel"
        except HTTPException:
            return None


async def _admin_iade(oid: int) -> str | None:
    async with AsyncSessionLocal() as s:
        try:
            # Gerekçe artık ZORUNLU (İP-2b R3): yönetici iadesi para hareketi
            # başlatır ve gerekçesiz kaydedilemez.
            await order_service.refund_order(s, oid, reason="Yarış testi: admin iadesi")
            return "refund"
        except HTTPException:
            return None


async def test_yesil_cift_musteri_iptali_tek_kazanan(fab, provider):
    """İki eşzamanlı müşteri iptali: sağlayıcı iadesi TEK, SALE_CANCEL TEK,
    geçmişte tek CANCELLED satırı, bildirim tam bir kez. Kaybeden 409 alır
    (idempotent sonuç) — çift telafi YOK."""
    pid = await fab.urun(stock=10)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 3, "PHYSICAL", "100.00")], client_id=cid)

    sonuclar = await asyncio.gather(_iptal(oid), _iptal(oid))
    kazananlar = [r for r in sonuclar if r is not None]
    assert len(kazananlar) == 1, f"tam olarak biri kazanmalı: {sonuclar}"

    assert len(provider.refund_calls) == 1
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 3)]
    assert await fab.stok(pid) == 10
    assert (await fab.siparis_durumu(oid)) == ("CANCELLED", "REFUNDED")
    gecmis = [h for h in await fab.history(oid) if h[1] == "CANCELLED"]
    assert len(gecmis) == 1
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1


async def test_yesil_iade_penceresinde_ikinci_iptal_409(fab, provider):
    """[I8] Kilit sırasını DETERMİNİSTİK sabitleyen dar nöbetçi (sleep YOK).

    `asyncio.gather` ile iki iptali yarıştırmak, kaybedenin kilidi TAM olarak
    hangi anda aldığını şansa bırakır — kusurlu kod bu yüzden yerelde yeşil,
    CI'da kırmızı görünüyordu. Burada pencere kapı (`refund_gate`) ile açık
    tutulur ve ikinci iptal, birincinin sağlayıcıda ASILI olduğu (Order kilidi
    `begin_refund` commit'iyle BIRAKILMIŞ, `status=PAID` ama
    `payment_status=REFUNDING`) anda kilidi alır.

    Kusurun anatomisi: kaybeden taze durumu okuyordu, ama `payment_status`
    yalnız `== 'PAID'` ile sınanıp geri kalan HER değer "ödenmemiş sipariş"
    sayıldığı için `REFUNDING` de para-hareketsiz iptal dalına düşüyordu →
    ikinci çağrı da başarı dönüyor ve müşteriye İKİNCİ bildirim gidiyordu.
    """
    pid = await fab.urun(stock=10)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 3, "PHYSICAL", "100.00")], client_id=cid)

    provider.refund_gate = asyncio.Event()
    kazanan_gorev = asyncio.create_task(_iptal(oid))
    try:
        # Pencere GERÇEKTEN açıldı mı: sağlayıcıya girildiği an set edilir.
        await asyncio.wait_for(provider.refund_entered.wait(), timeout=30)
        async with AsyncSessionLocal() as s:
            ara_durum = (
                await s.execute(
                    text("SELECT status, payment_status FROM orders WHERE id = :o"),
                    {"o": oid},
                )
            ).one()
        assert tuple(ara_durum) == ("PAID", "REFUNDING"), (
            f"kurgu bozuldu — pencerede beklenen ara durum yok: {tuple(ara_durum)}"
        )

        # Kaybeden: kilidi bu pencerede alır ve TAZE ara durumu görür.
        kaybeden = await _iptal(oid)
    finally:
        provider.refund_gate.set()
        kazanan = await asyncio.wait_for(kazanan_gorev, timeout=30)

    assert kazanan == "cancel", "pencereyi açan iptal kazanmalıydı"
    assert kaybeden is None, "iadesi süren siparişte ikinci iptal 409 almalı"

    # Yan etkilerin tamamı TEK: para, defter, geçmiş, bildirim.
    assert len(provider.refund_calls) == 1
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 3)]
    assert await fab.stok(pid) == 10
    assert (await fab.siparis_durumu(oid)) == ("CANCELLED", "REFUNDED")
    assert len([h for h in await fab.history(oid) if h[1] == "CANCELLED"]) == 1
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1


async def test_yesil_musteri_iptali_admin_iadesi_yarisi(fab, provider):
    """Müşteri iptali ↔ admin iadesi aynı anda: escrow claim'i tek kazanan
    seçer — sağlayıcıya TEK iade gider, stok TEK kez geri yüklenir, sipariş
    tutarlı bir terminal durumda biter (CANCELLED ya da REFUNDED)."""
    pid = await fab.urun(stock=8)
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")])

    sonuclar = await asyncio.gather(_iptal(oid), _admin_iade(oid))
    kazananlar = [r for r in sonuclar if r is not None]
    assert len(kazananlar) == 1, f"tam olarak biri kazanmalı: {sonuclar}"

    assert len(provider.refund_calls) == 1
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 2)]
    assert await fab.stok(pid) == 8
    durum, payment = await fab.siparis_durumu(oid)
    assert payment == "REFUNDED"
    assert durum == ("CANCELLED" if kazananlar[0] == "cancel" else "REFUNDED")


async def test_yesil_iptal_ile_kurye_teslim_yarisi_teslimi_ezmez(fab, provider, caplog):
    """[IP2B-R17] İptal ↔ tur başlatma + kurye teslimi yarışı.

    Kusur: `cancel_by_client` SHIPPED/DELIVERED guard'ını Order kilidi altında
    geçer, ama `begin_refund` niyeti COMMIT edince kilit BIRAKILIR; sağlayıcı
    HTTP çağrısı sürerken tur başlar (PAID→SHIPPED) ve kurye OTP ile teslim eder
    (SHIPPED→DELIVERED). İptal kaldığı yerden devam edince — kilit sonrası TAZE
    durumu değil, session'ının BAYAT bellek kopyasını (`status='PAID'`) gördüğü
    için — stoğu geri yüklüyor ve `CANCELLED` yazımı FSM'den geçiyordu:
    **DELIVERED, CANCELLED ile EZİLİYORDU** (lost update). Net sonuç: kitap
    müşteride + para iade + defter kitabı rafta sayıyor + sipariş "iptal".

    ── Kanonik yarış sözleşmesi (ULAŞILABİLİR invariant) ─────────────────────
    Bu nöbetçinin ilk hâli "sağlayıcıya HİÇ iade çağrısı gitmemeli" diyordu ama
    kurgusu, teslimatı ancak `provider.refund` çağrıldıktan SONRA tetikliyordu
    (kapı orada açılıyor): iki şart birbirini dışlıyordu ve test hiçbir üretim
    koduyla yeşile dönemezdi. Sözleşme, ulaşılabilir olana çekildi — bu bir
    **assertion gevşetmesi değil, birbirini dışlayan iki şartın düzeltilmesidir**
    (gerekçe: docs/ip2b-siparis-iptal-telafi-sozlesme.md §6.6):

    * teslim kesinleşmişse `DELIVERED` **ezilmez**;
    * kitap müşteride olduğu için `SALE_CANCEL` **yazılmaz**;
    * sağlayıcı iade çağrısı **en fazla bir kez** yapılır;
    * çağrı çoktan gönderilmişse **otomatik ikinci finansal işlem yapılmaz**
      (ters tahsilat/otomatik RMA İP-2b kapsamı DIŞINDA);
    * durum sessiz kalmaz: görünür `MANUAL_REVIEW`/ERROR kaydı + audit izi +
      yönetici bildirimi.
    """
    caplog.set_level(logging.ERROR)
    pid = await fab.urun(stock=6)
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], prepared=True)
    run_id = await fab.run(status="PLANNED")
    stop_id = await fab.durak(run_id=run_id, order_id=oid, otp_code="654321")

    provider.refund_gate = asyncio.Event()  # sağlayıcı çağrısını askıda tut

    iptal_gorevi = asyncio.create_task(_iptal(oid))
    try:
        # İptal, sağlayıcıya ulaşana dek bekle (refund() önce kaydeder sonra bekler).
        for _ in range(500):
            if provider.refund_calls:
                break
            await asyncio.sleep(0.01)
        assert provider.refund_calls, "iptal sağlayıcıya hiç ulaşmadı (kurulum hatası)"

        # Pencerede: tur başlar, kurye teslim eder.
        async with AsyncSessionLocal() as s:
            await delivery_service.start_run(s, run_id)
        async with AsyncSessionLocal() as s:
            await delivery_service.verify_delivery(s, stop_id, code="654321")
        assert (await fab.siparis_durumu(oid))[0] == "DELIVERED"
    finally:
        provider.refund_gate.set()
        iptal_sonucu = await asyncio.wait_for(iptal_gorevi, timeout=30)

    durum, payment = await fab.siparis_durumu(oid)
    async with AsyncSessionLocal() as s:
        durak_durumu, delivered_at = (
            await s.execute(
                text(
                    "SELECT ds.status, o.delivered_at FROM delivery_stops ds "
                    "JOIN orders o ON o.id = ds.order_id WHERE ds.id = :s"
                ),
                {"s": stop_id},
            )
        ).one()
    sale_cancel = await fab.hareketler(pid, "SALE_CANCEL")

    # Paket fiziksel olarak müşteriye verildi (kurye DELIVERED'ı commit etti).
    assert durak_durumu == "DELIVERED" and delivered_at is not None

    ihlaller = []
    if len(provider.refund_calls) > 1:
        ihlaller.append(
            f"sağlayıcıya {len(provider.refund_calls)} iade çağrısı gitti "
            "(en fazla bir kez olmalı)"
        )
    if sale_cancel:
        ihlaller.append(f"kitap müşterideyken SALE_CANCEL yazıldı: {sale_cancel}")
    if durum != "DELIVERED":
        ihlaller.append(f"DELIVERED, '{durum}' ile ezildi (lost update)")
    assert not ihlaller, (
        f"iptal ↔ teslim yarışında çift kazanan (iptal sonucu {iptal_sonucu!r}, "
        f"sipariş {durum}/{payment}): " + "; ".join(ihlaller)
    )
    # Stok fiziksel gerçekle uyumlu: 6 − 2 satış = 4 (geri yükleme YOK).
    assert await fab.stok(pid) == 4

    # Sessiz kalmadı: ERROR kaydı + audit satırı + yönetici bildirimi.
    assert any(
        r.levelno >= logging.ERROR and "MANUAL_REVIEW" in r.getMessage()
        and str(oid) in r.getMessage()
        for r in caplog.records
    ), "gönderilmiş iade sessizce kayboldu — MANUAL_REVIEW kaydı yok"
    assert await fab.audit_kayitlari(
        action="order.refund_after_delivery", target_id=oid
    ), "MANUAL_REVIEW durumu audit izine yazılmadı"
