"""İP-2b — sipariş iptalinin teslimat turu/durağı/outbox üzerindeki etkileri
(GERÇEK PostgreSQL, gerçek servis katmanı).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §7

Mevcut yeşil kapsamla (test_delivery_invariants_pg: iptal açık durağı kapatır,
kaçak durak turu bloklamaz) ÇAKIŞMAZ; buradaki testler o dosyada ölçülmeyen
boşlukları hedefler: kaçak durakta OTP/verify, iptal sonrası bayat outbox
SMS'i, iptal ↔ tura-ekleme yarışı ve hazırlama damgasının iptalde asılı kalması.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core import outbox
from core.database import AsyncSessionLocal
from services import delivery_service, order_service

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int):
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        return await order_service.cancel_by_client(s, order)


async def _bekleyen_durak(oid: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM delivery_stops "
                    "WHERE order_id = :o AND status = 'PENDING'"
                ),
                {"o": oid},
            )
        ).scalar_one()


# ── Hazırlama durumu ────────────────────────────────────────────────────────────


async def test_kirmizi_hazirlanmis_siparis_iptali_damgayi_sokmeli(fab, provider):
    """[IP2B-R13] Hazırlanmış (toplanmış+etiketlenmiş) PAID siparişin iptali
    fiziksel geri almayı İZLEMELİ: asgari ölçülebilir sözleşme, `prepared_at`
    damgasının temizlenmesidir (başarısız teslim yolunun yaptığı gibi —
    `roll_promise_after_failed_attempt` damgayı sıfırlar).

    Bugün damga asılı kalır: paket masada, defter kitabı rafta sayar
    (SALE_CANCEL yazıldı), hiçbir kuyruk/iş emri paketi sökmeyi söylemez.
    Not: F30/OrderPackage üretimde YOKTUR — test mevcut `prepared_at` modeline
    göre ölçer; paket sökme iş emri tasarımı ürün kararıdır (sözleşme §8.4)."""
    pid = await fab.urun(stock=5)
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")], prepared=True
    )

    await _iptal(oid)
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 2)]

    async with AsyncSessionLocal() as s:
        hazir = (
            await s.execute(
                text("SELECT prepared_at FROM orders WHERE id = :o"), {"o": oid}
            )
        ).scalar_one()
    assert hazir is None, (
        "iptal edilen siparişin hazırlama damgası asılı kaldı — paketlenmiş "
        "kitap fiziksel olarak rafta DEĞİLKEN defter rafta sayıyor ve hiçbir "
        "operasyonel sinyal üretilmedi"
    )


# ── Kaçak durakta teslim aksiyonları ────────────────────────────────────────────


async def test_yesil_cancelled_siparisin_duragi_teslim_edilemez(fab, provider):
    """Eski QR/OTP ile teslim engellenir: CANCELLED siparişin (kaçak) PENDING
    durağında `verify_delivery` FSM duvarına çarpar — durak DELIVERED olmaz,
    sipariş CANCELLED kalır. (Son savunma hattının nöbetçisi.)"""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    await _iptal(oid)
    run_id = await fab.run(status="ACTIVE")
    stop_id = await fab.durak(run_id=run_id, order_id=oid, otp_code="123456")

    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as s:
            await delivery_service.verify_delivery(s, stop_id, code="123456")
    assert exc.value.status_code == 409

    async with AsyncSessionLocal() as s:
        st = (
            await s.execute(
                text("SELECT status FROM delivery_stops WHERE id = :s"),
                {"s": stop_id},
            )
        ).scalar_one()
    assert st != "DELIVERED"
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"


async def test_kirmizi_cancelled_siparise_teslim_otp_smsi_gitmez(fab, provider, sms_kayit):
    """[IP2B-R14] Kaçak PENDING durakta `send_otp` sipariş durumuna hiç bakmaz:
    iptal edilmiş siparişin müşterisine 'teslimat kodun' SMS'i gider, kurye
    kapıya yönlendirilir, 409 ancak kod doğrulanırken görülür.

    Sözleşme: teslim aksiyon zinciri kapının EN BAŞINDA (send_otp/scan) sipariş
    yaşam döngüsünü doğrulamalı — 409 dönmeli, SMS atılmamalı."""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    await _iptal(oid)
    run_id = await fab.run(status="ACTIVE")
    stop_id = await fab.durak(run_id=run_id, order_id=oid)

    kod_409 = False
    try:
        async with AsyncSessionLocal() as s:
            await delivery_service.send_otp(s, stop_id)
    except HTTPException as exc:
        kod_409 = exc.status_code == 409

    assert kod_409, "iptal edilmiş siparişin durağına OTP akışı kabul edildi"
    assert sms_kayit.mesajlar == [], (
        f"iptal edilmiş siparişin müşterisine {len(sms_kayit.mesajlar)} SMS gitti: "
        f"{[m[1][:40] for m in sms_kayit.mesajlar]}"
    )


# ── Bayat outbox olayları ───────────────────────────────────────────────────────


async def test_kirmizi_iptal_bekleyen_takip_smsini_iptal_eder(fab, provider, sms_kayit):
    """[IP2B-R15] Tur başladı → 'kuryen yola çıktı' SMS'i outbox'a yazıldı ama
    henüz GÖNDERİLMEDİ (worker gecikmesi / sessiz saat ertelemesi). Sipariş bu
    arada iade edildi ve durağı kapatıldı. Sözleşme: iade/iptal, siparişin
    kuyruktaki teslimat SMS'lerini de geçersiz kılmalı — müşteriye 'kuryen
    yolda' SMS'i GİTMEMELİ.

    Bugün outbox olayı iptal edilmez; dispatch olayı aynen gönderir."""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    run_id = await fab.run(status="PLANNED")
    await fab.durak(run_id=run_id, order_id=oid)

    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run_id)  # SHIPPED + sms:tracking_link
    assert ("sms:tracking_link", "PENDING") in await fab.outbox_olaylari(oid)

    async with AsyncSessionLocal() as s:
        await order_service.refund_order(s, oid)  # REFUNDED + durak CANCELLED
    assert (await fab.siparis_durumu(oid)) == ("REFUNDED", "REFUNDED")

    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)

    takip_smsleri = [m for m in sms_kayit.mesajlar if "takip" in m[1] or "dağıtıma" in m[1]]
    assert takip_smsleri == [], (
        "iade edilmiş siparişin müşterisine kuyruktaki 'kuryen yola çıktı' "
        f"SMS'i gönderildi: {takip_smsleri[0][1][:60]!r}"
    )


# ── İptal ↔ tura ekleme yarışı ──────────────────────────────────────────────────


async def test_kirmizi_iptal_ile_tura_ekleme_yarisi(fab, provider, monkeypatch):
    """[IP2B-R16] `add_stops` siparişi KİLİTSİZ okur (`db.get`); uygunluk
    kontrolünden sonra, INSERT'ten önce sipariş iptal edilirse CANCELLED
    siparişe PENDING durak yazılır (kısmi indeks yalnız 'ikinci açık durak'
    yarışını kapatır, sipariş durumundan habersizdir). Durak sahada OTP/teslim
    zincirine girer (IP2B-R14 ile birleşince müşteriye SMS de gider).

    Sözleşme: iptal ↔ tura ekleme yarışının HER sıralamasında CANCELLED
    siparişin bekleyen durağı OLAMAZ."""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    run_id = await fab.run(status="PLANNED")

    gercek = delivery_service._has_open_stop
    kapida = asyncio.Event()
    devam = asyncio.Event()

    async def yavas_has_open_stop(db, order_id):
        sonuc = await gercek(db, order_id)
        kapida.set()          # uygunluk kontrolleri bitti, INSERT bekliyor
        await devam.wait()    # bu pencerede iptal koşacak
        return sonuc

    monkeypatch.setattr(delivery_service, "_has_open_stop", yavas_has_open_stop)

    async def _ekle():
        async with AsyncSessionLocal() as s:
            try:
                await delivery_service.add_stops(s, run_id, [oid])
                return "eklendi"
            except HTTPException as exc:
                return f"409:{exc.status_code}"

    ekleme = asyncio.create_task(_ekle())
    await asyncio.wait_for(kapida.wait(), timeout=10)
    monkeypatch.setattr(delivery_service, "_has_open_stop", gercek)

    await _iptal(oid)  # add_stops kilit tutmadığından bloklanmaz
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"

    devam.set()
    await asyncio.wait_for(ekleme, timeout=10)

    assert await _bekleyen_durak(oid) == 0, (
        "CANCELLED siparişe PENDING durak yazıldı — kurye listesinde iptal "
        "edilmiş sipariş sahaya çıkacak"
    )
