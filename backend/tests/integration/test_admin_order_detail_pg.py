"""Yönetim tekil sipariş okuma ucu — GERÇEK FastAPI HTTP + GERÇEK PostgreSQL.

`GET /store/admin/orders/{id}`: `orders.view` ile kalemler + iade durumu döner,
salt okumadır (audit yazmaz), sahiplik süzmez; eksik/soft-delete 404, izinsiz 403.
Müşteri ucu `/orders/{id}` sahiplik davranışı değişmez.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.ip2a_factory import IadeFabrikasi

KOK = "/api/v1/store"


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _audit_toplam_order(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM audit_logs WHERE target_type = 'order' AND target_id = :i"
                ),
                {"i": order_id},
            )
        ).scalar_one()


async def test_orders_view_tek_siparisi_kalemler_ve_iadeyle_okur(fab, provider, client):
    """`orders.view` sahibi admin başka müşteriye ait siparişi okur; kalemler ve
    en güncel iade durumu yanıttadır; okuma audit satırı üretmez."""
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    # Gerçek müşteri CAYMA talebi → otomatik onay; iade durumu siparişe yansır.
    r = await client.post(
        f"{KOK}/orders/{sip.order_id}/return",
        json={"type": "CAYMA", "reason": "", "items": []},
        headers=chead,
    )
    assert r.status_code == 201, r.text

    _, ahead = await fab.admin(izinler=["orders.view"])
    audit_once = await _audit_toplam_order(sip.order_id)
    y = await client.get(f"{KOK}/admin/orders/{sip.order_id}", headers=ahead)
    assert y.status_code == 200, y.text
    govde = y.json()
    assert govde["id"] == sip.order_id
    assert govde["order_no"]
    assert len(govde["items"]) == 1
    assert govde["items"][0]["product_id"] == pid
    assert govde["items"][0]["quantity"] == 2
    assert govde["return_status"] == "APPROVED"
    assert govde["payment_status"] == "REFUNDED"
    assert await _audit_toplam_order(sip.order_id) == audit_once


async def test_orders_view_olmayan_admin_403(fab, client):
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 1)])
    _, ahead = await fab.admin(izinler=["products.view"])
    y = await client.get(f"{KOK}/admin/orders/{sip.order_id}", headers=ahead)
    assert y.status_code == 403, y.text


async def test_olmayan_ve_soft_delete_siparis_404(fab, client):
    pid = await fab.urun(stock=5)
    sip = await fab.siparis(items=[(pid, 1)])
    _, ahead = await fab.admin(izinler=["orders.view"])

    yok = await client.get(f"{KOK}/admin/orders/999999999", headers=ahead)
    assert yok.status_code == 404
    assert yok.json()["detail"] == "Sipariş bulunamadı"

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE orders SET deleted_at = now() WHERE id = :i"),
            {"i": sip.order_id},
        )
        await s.commit()
    silinmis = await client.get(f"{KOK}/admin/orders/{sip.order_id}", headers=ahead)
    assert silinmis.status_code == 404
    assert silinmis.json()["detail"] == "Sipariş bulunamadı"


async def test_musteri_ucunda_sahiplik_regresyonu_yok(fab, client):
    """Yönetim ucu sahiplik süzmez; müşteri ucu ise yabancı siparişe 404 vermeye
    devam eder (403/404 ayrımıyla kimlik uzayı taranamaz)."""
    pid = await fab.urun(stock=5)
    cid_a, head_a = await fab.musteri()
    _cid_b, head_b = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 1)], client_id=cid_a)

    sahibi = await client.get(f"{KOK}/orders/{sip.order_id}", headers=head_a)
    assert sahibi.status_code == 200
    assert sahibi.json()["id"] == sip.order_id

    yabanci = await client.get(f"{KOK}/orders/{sip.order_id}", headers=head_b)
    assert yabanci.status_code == 404

    _, ahead = await fab.admin(izinler=["orders.view"])
    yonetim = await client.get(f"{KOK}/admin/orders/{sip.order_id}", headers=ahead)
    assert yonetim.status_code == 200
    # Yönetim yanıtı kalemleri ve kargo alanlarını taşır (orders.view yetkili yüzey).
    assert len(yonetim.json()["items"]) == 1
    assert "ship_phone" in yonetim.json()
