"""İP-2b — sipariş iptali yarışları (GERÇEK PostgreSQL, deterministik).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §6.4-§6.5

Determinizm: sleep tabanlı pencere yerine `StubProvider.refund_gate`
(asyncio.Event) — sağlayıcı çağrısı, event set edilene dek bekletilir; iki
akış "durum okundu ama yazılmadı" penceresinde KESİN buluşur.

Her testte para+stok+geçmiş bütünü birlikte ölçülür (yalnız HTTP status değil).
"""
from __future__ import annotations

import asyncio

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
            await order_service.refund_order(s, oid)
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


async def test_kirmizi_iptal_ile_kurye_teslim_yarisi(fab, provider):
    """[IP2B-R17] İptal ↔ tur başlatma + kurye teslimi yarışı.

    `cancel_by_client` SHIPPED/DELIVERED guard'ını Order kilidi altında geçer,
    ama `begin_refund` niyeti COMMIT edince kilit bırakılır; sağlayıcı HTTP
    çağrısı sürerken tur başlar (PAID→SHIPPED) ve kurye OTP ile teslim eder
    (SHIPPED→DELIVERED, `delivered_at` damgalanır). İptal kaldığı yerden devam
    eder: sağlayıcı iadesini TAMAMLAR, stoğu geri yükler ve `transition_order`
    kilit sonrası TAZE durumu DEĞİL, iptal session'ının BAYAT bellek kopyasını
    (`status='PAID'`) gördüğü için `CANCELLED` yazımı FSM'den geçer →
    DELIVERED, CANCELLED ile EZİLİR (lost update). Net sonuç: kitap müşteride
    (durak DELIVERED, delivered_at dolu) + para sağlayıcıda iade edilmiş +
    stok defteri kitabı rafta sayıyor + sipariş 'iptal edilmiş' görünüyor.

    Sözleşme: tek işlem sahibi — paket teslim edildiyse (durak DELIVERED)
    sağlayıcıya iade çağrısı GİDEMEZ ve SALE_CANCEL YAZILAMAZ; sipariş
    DELIVERED kalır, para iadesi ancak İP-2a iade (RMA) yolundan yürür."""
    pid = await fab.urun(stock=6)
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], prepared=True)
    run_id = await fab.run(status="PLANNED")
    stop_id = await fab.durak(run_id=run_id, order_id=oid, otp_code="654321")

    provider.refund_gate = asyncio.Event()  # sağlayıcı çağrısını askıda tut

    iptal_gorevi = asyncio.create_task(_iptal(oid))
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

    # Sözleşme: teslim edilmiş pakete iade çağrısı + stok telafisi + CANCELLED
    # yazımı OLAMAZ. (Bugün üçü birden olur; DELIVERED, CANCELLED ile ezilir.)
    ihlaller = []
    if len(provider.refund_calls) > 0:
        ihlaller.append(f"sağlayıcı iadesi {len(provider.refund_calls)} kez gitti")
    if sale_cancel:
        ihlaller.append(f"kitap müşterideyken SALE_CANCEL yazıldı: {sale_cancel}")
    if durum != "DELIVERED":
        ihlaller.append(f"DELIVERED, '{durum}' ile ezildi (lost update)")
    assert not ihlaller, (
        f"iptal ↔ teslim yarışında çift kazanan (iptal sonucu {iptal_sonucu!r}, "
        f"sipariş {durum}/{payment}): " + "; ".join(ihlaller)
    )
