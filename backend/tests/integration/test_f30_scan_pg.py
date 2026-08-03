"""F30 kapı taraması (`/delivery/scan`) — GERÇEK PostgreSQL + GERÇEK HTTP.

Denetim bulgusu 3: paket QR'ının teslimat tarafında çözülmesi hiç test
edilmemişti. Etikette artık **paket** QR'ı basıldığı için (sözleşme §3.3) kurye
kapıda onu okutur; eski durak QR'ı ise basılmış etiketler için çalışmaya devam
etmelidir.

İki QR uzayı ayrıktır ve **karışmamalıdır**:

    paket : PKG1:{package_id}:{token}
    durak : {stop_id}:{token}

`delivery_service.parse_qr_token` payload'u ilk ":"den böler; önek olmasaydı
paket payload'u sessizce bir "durak token'ı" gibi ayrıştırılır ve hata mesajı
yanlış yeri işaret ederdi.
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from core.database import AsyncSessionLocal
from services import delivery_service
from tests.integration.f30_factory import PaketFabrikasi


def _paketleme():
    try:
        from services import packing_service
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_service.py ({exc})", pytrace=False
        )
    return packing_service


def _zimmet():
    fn = getattr(delivery_service, "handover_scan", None)
    if fn is None:
        pytest.fail("HENÜZ YAZILMADI: delivery_service.handover_scan", pytrace=False)
    return fn


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    yield f
    await f.temizle()


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _hazir_paket(fab: PaketFabrikasi, servis, aid: int):
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await servis.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await servis.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        paket = await servis.complete(s, paket.id, admin_id=aid)
    return oid, paket


async def _tura_ekle(oid: int, run_id: int) -> int:
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run_id, [oid])
    return [d for d in tur.stops if d.order_id == oid][0].id


async def _sahaya_cikar(fab: PaketFabrikasi, servis, aid: int, kurye: int):
    """Zimmetlenmiş, turu başlamış bir durak kurar. (order_id, paket, stop_id, run)"""
    zimmet = _zimmet()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _hazir_paket(fab, servis, aid)
    stop_id = await _tura_ekle(oid, run)
    async with AsyncSessionLocal() as s:
        await zimmet(s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}")
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    return oid, paket, stop_id, run


# ══════════════════ Paket QR'ı çözülür ══════════════════════════════════════


@pytest.mark.asyncio
async def test_PAKET_QR_si_kapida_dogru_duragi_cozer(fab):
    """Etiketteki `PKG1:` payload'u durağa ulaşmalı — yoksa kurye kapıda
    okuttuğunda 404 alır ve teslim edemez."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)

    async with AsyncSessionLocal() as s:
        durak, tur_durumu = await delivery_service.scan(
            s, paket.qr_payload, courier_id=kurye
        )
    assert durak.id == stop_id
    assert durak.order_id == oid
    assert tur_durumu == "ACTIVE"


@pytest.mark.asyncio
async def test_ESKI_DURAK_QR_si_CALISMAYA_DEVAM_EDER(fab):
    """Geriye uyum: basılmış eski etiketler geçersizleşmez (sözleşme §3.3)."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    _oid, _paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        token = (
            await s.execute(
                text("SELECT qr_token FROM delivery_stops WHERE id = :i"), {"i": stop_id}
            )
        ).scalar_one()
    async with AsyncSessionLocal() as s:
        durak, _tur = await delivery_service.scan(
            s, f"{stop_id}:{token}", courier_id=kurye
        )
    assert durak.id == stop_id


@pytest.mark.asyncio
async def test_iki_QR_UZAYI_BIRBIRINE_KARISMAZ(fab):
    """Paket token'ı durak uzayında, durak token'ı paket uzayında aranmaz."""
    servis = _paketleme()
    from services.packing_rules import build_package_qr

    aid = await fab.admin()
    kurye = await fab.kurye()
    _oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)

    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        durak_token = (
            await s.execute(
                text("SELECT qr_token FROM delivery_stops WHERE id = :i"), {"i": stop_id}
            )
        ).scalar_one()
        paket_token = (
            await s.execute(
                text("SELECT qr_token FROM order_packages WHERE id = :i"),
                {"i": paket.id},
            )
        ).scalar_one()

    # Paket token'ı DURAK formatında gönderilirse çözülmemeli.
    with pytest.raises(HTTPException) as h1:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(s, f"{stop_id}:{paket_token}", courier_id=kurye)
    assert h1.value.status_code == 404

    # Durak token'ı PAKET formatında gönderilirse çözülmemeli.
    with pytest.raises(HTTPException) as h2:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(
                s, build_package_qr(paket.id, durak_token), courier_id=kurye
            )
    assert h2.value.status_code == 404


# ══════════════════ Yetki ve durum kapıları ═════════════════════════════════


@pytest.mark.asyncio
async def test_BASKA_KURYENIN_paketi_kapida_404(fab):
    """IDOR deseni: yabancı paket 403 değil 404 (varlık sızmasın)."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    await fab.tur(courier_id=kurye_b)
    _oid, paket, _stop, _run = await _sahaya_cikar(fab, servis, aid, kurye_a)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(s, paket.qr_payload, courier_id=kurye_b)
    assert hata.value.status_code == 404


@pytest.mark.asyncio
async def test_ZIMMETLENMEMIS_paket_teslimat_taramasi_SAYILMAZ(fab):
    """Paket hâlâ depoda (`PACKED`) — kapıda okutulması anlamsızdır ve teslim
    akışını açmamalıdır. Belirsiz fiziksel olayda tahmin yok: güvenli dur."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _hazir_paket(fab, servis, aid)
    await _tura_ekle(oid, run)

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(s, paket.qr_payload, courier_id=kurye)
    assert hata.value.status_code == 409


@pytest.mark.asyncio
async def test_RETURN_PENDING_paket_kapida_TESLIM_GIBI_islenmez(fab):
    """Teslim edilemeyip araçta kalan paket, aynı gün ikinci kez okutulursa
    teslim akışını açmaz — sipariş `PAID`'e dönmüş ve durak `FAILED` olmuştur."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    _oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK")

    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(s, paket.qr_payload, courier_id=kurye)
    assert hata.value.status_code == 409


@pytest.mark.asyncio
async def test_TANIMSIZ_paket_QR_si_404(fab):
    await fab.kurye()
    with pytest.raises(HTTPException) as hata:
        async with AsyncSessionLocal() as s:
            await delivery_service.scan(s, "PKG1:999999:yok", courier_id=None)
    assert hata.value.status_code == 404


# ══════════════════ Gerçek HTTP ═════════════════════════════════════════════


@pytest.mark.asyncio
async def test_HTTP_kurye_paket_QR_si_ile_durak_alir(client, fab):
    """Yetki çözümü gerçek istekle kanıtlanır (kök CLAUDE.md §B)."""
    servis = _paketleme()
    aid = await fab.admin()
    kurye = await fab.kurye()
    _hid, token = await fab.kurye_hesabi(kurye)
    oid, paket, stop_id, _run = await _sahaya_cikar(fab, servis, aid, kurye)

    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket.qr_payload},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    govde = r.json()
    assert govde["stop"]["id"] == stop_id
    assert govde["stop"]["order_id"] == oid


@pytest.mark.asyncio
async def test_HTTP_yabanci_kuryeye_404(client, fab):
    servis = _paketleme()
    aid = await fab.admin()
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    _hid, token_b = await fab.kurye_hesabi(kurye_b)
    await fab.tur(courier_id=kurye_b)
    _oid, paket, _stop, _run = await _sahaya_cikar(fab, servis, aid, kurye_a)

    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket.qr_payload},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert r.status_code == 404, r.text
