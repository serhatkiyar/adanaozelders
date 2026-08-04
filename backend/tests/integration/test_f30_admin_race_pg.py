"""F30 — YÖNETİCİ sevkiyat/teslim uçlarının EŞZAMANLILIĞI (gerçek PostgreSQL).

## Neden ayrı bir dosya

Nihai denetim iki P1 buldu ve ikisinin kökü aynıydı: `order_service`'teki iki
yönetici yolu F30 paket kapısını **Order satırını kilitlemeden** çalıştırıyordu.
Kapının kendisi doğruydu; okuduğu şey bayattı.

* `mark_shipped ↔ open_package` → `order=SHIPPED + package=OPEN`. Bu hâl
  **kurtarılamaz**: paket tamamlanamaz (`complete` siparişin `PAID` olmasını
  arar), zimmetlenemez, `uq_order_packages_live` yüzünden yeni paket açılamaz
  ve sipariş dağıtım kuyruğuna hiç giremez.
* `mark_delivered ↔ cancel_run / fail_stop` → `order=DELIVERED +
  package=RETURN_PENDING`. "Teslim edildi" ile "kutu araçta geri dönüyor" aynı
  anda doğru görünür; geri dönüş kuyruğu teslim edilmiş bir kutuyu arar.

## Desen

`test_f30_packing_race_pg.py`'den devralındı ve gerekçesi aynıdır: her görev
KENDİ session'ında, başında `SET LOCAL lock_timeout` (kilit sırası hatası testi
ASKIDA BIRAKMAZ, kırar) · `gather(..., return_exceptions=True)` sonuçları
taranır, beklenen iş kuralı reddi dışındaki her istisna yeniden yükseltilir ·
her çift **ters başlatma sırasıyla** ve birden çok tur koşar · `sleep` YOK.

Her düğüm önce **kimin kazandığını** okur, sonra o gözleme karşılık gelen TEK
son durumu iddia eder. "Şu VEYA bu" biçimli bir iddia, iki işlem de sessizce
no-op'a düşse yine geçerdi (commit 4 denetiminin bulgusu).
"""
from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import delivery_service, order_service, packing_service
from tests.integration.f30_factory import PaketFabrikasi

TURLAR = 3
KILIT_ZAMAN_ASIMI = "4s"
VIEW, PACK = "packing.view", "packing.pack"
ORDERS_MANAGE = "orders.manage"


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


@pytest.fixture
async def kur(pg):
    from tests.integration.test_f30_packing_api_pg import Kurulum

    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


# ══════════════════ Yarış altyapısı ═════════════════════════════════════════


def _beklenen_mi(exc: BaseException) -> bool:
    return isinstance(exc, HTTPException) and exc.status_code in (400, 404, 409, 422)


def _kilit_hatasi_yok(sonuclar) -> None:
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = getattr(getattr(r, "orig", None), "sqlstate", None) or ""
        if kod == "40P01":
            pytest.fail(f"DEADLOCK (40P01): {r}")
        if kod == "55P03":
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03) — kilit sırası bozuk: {r}")
        if not _beklenen_mi(r):
            raise r


async def _gorev(fn):
    s = AsyncSessionLocal()
    try:
        await s.execute(text(f"SET LOCAL lock_timeout = '{KILIT_ZAMAN_ASIMI}'"))
        return await fn(s)
    finally:
        await s.close()


def _basarili(x) -> bool:
    return not isinstance(x, BaseException)


def _reddedildi(x) -> bool:
    return isinstance(x, HTTPException) and x.status_code in (400, 409)


# ══════════════════ Kurulum yardımcıları ════════════════════════════════════


async def _packed_paket(client, token: str, fab: PaketFabrikasi):
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/scan",
        json={"code": ean, "idempotency_key": uuid.uuid4().hex},
        headers=_bas(token),
    )
    assert r.json()["result"] == "OK", r.text
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(token)
    )
    assert r.status_code == 200, r.text
    return oid, r.json()


async def _durak_id(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"), {"o": order_id}
            )
        ).scalar_one()


async def _zimmetli_kurulum(client, kur, fab):
    """PACKED → tura eklenmiş → kurye tarafından zimmetlenmiş sipariş."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    stop_id = await _durak_id(oid)
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    return oid, paket, stop_id, run, kurye, token


async def _son_durum(order_id: int) -> dict:
    async with AsyncSessionLocal() as s:
        siparis = (
            await s.execute(
                text("SELECT status, tracking_no FROM orders WHERE id = :o"), {"o": order_id}
            )
        ).one()
        paket = (
            await s.execute(
                text(
                    "SELECT status FROM order_packages WHERE order_id = :o "
                    "ORDER BY id DESC LIMIT 1"
                ),
                {"o": order_id},
            )
        ).first()
        durak = (
            await s.execute(
                text(
                    "SELECT status FROM delivery_stops WHERE order_id = :o "
                    "ORDER BY id DESC LIMIT 1"
                ),
                {"o": order_id},
            )
        ).first()
        return {
            "siparis": siparis[0],
            "tracking_no": siparis[1],
            "paket": paket[0] if paket else None,
            "durak": durak[0] if durak else None,
            "shipped_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'SHIPPED'"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
            "delivered_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'DELIVERED'"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
            "outbox": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM outbox_events "
                        "WHERE payload ->> 'order_id' = :o"
                    ),
                    {"o": str(order_id)},
                )
            ).scalar_one(),
        }


# ══════════════════ 1. mark_shipped ↔ open_package ══════════════════════════


@pytest.mark.parametrize("ters", [False, True], ids=["ship_once", "open_once"])
async def test_ELLE_SEVKIYAT_ILE_PAKET_ACMA_CIKMAZ_URETMEZ(fab, ters):
    """`order=SHIPPED + package=OPEN` **asla** oluşmamalı.

    Bu hâl kurtarılamaz: paket tamamlanamaz, zimmetlenemez, canlı paket
    benzersizliği yüzünden yenisi de açılamaz ve sipariş dağıtım kuyruğuna
    giremez. İki başlatma yönünde ve birden çok turda ölçülür.
    """
    for tur in range(TURLAR):
        aid = await fab.admin()
        pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

        gorevler = [
            _gorev(lambda s: order_service.mark_shipped(s, oid, tracking_no="ELLE-1")),
            _gorev(lambda s: packing_service.open_package(s, oid, admin_id=aid)),
        ]
        adlar = ("ship", "open")
        if ters:
            gorevler.reverse()
            adlar = tuple(reversed(adlar))

        sonuclar = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(sonuclar)
        sonuc = dict(zip(adlar, sonuclar, strict=True))
        d = await _son_durum(oid)

        # YASAK HÂL — her turda, kim kazanırsa kazansın.
        assert not (d["siparis"] == "SHIPPED" and d["paket"] == "OPEN"), (
            f"tur {tur}: KURTARILAMAZ ÇIKMAZ — {d}"
        )

        if _basarili(sonuc["open"]):
            # Paket açma kazandı: elle sevkiyat reddedilmiş, sipariş PAID.
            assert _reddedildi(sonuc["ship"]), sonuc["ship"]
            assert d["siparis"] == "PAID", d
            assert d["paket"] == "OPEN", d
            assert d["tracking_no"] is None, d
            assert d["shipped_gecisi"] == 0, d
        else:
            # Elle sevkiyat kazandı: paket AÇILAMAMIŞ olmalı (sipariş PAID değil).
            assert _basarili(sonuc["ship"]), sonuc["ship"]
            assert _reddedildi(sonuc["open"]), sonuc["open"]
            assert d["siparis"] == "SHIPPED", d
            assert d["paket"] is None, d


# ══════════════════ 2. mark_delivered ↔ cancel_run ══════════════════════════


@pytest.mark.parametrize("ters", [False, True], ids=["deliver_once", "cancel_once"])
async def test_ADMIN_TESLIM_ILE_TUR_IPTALI_CELISKI_URETMEZ(client, kur, fab, ters):
    """`order=DELIVERED + package=RETURN_PENDING` **asla** oluşmamalı.

    Tur iptali araçtaki paketi geri dönüşe (`RETURN_PENDING`) alır; teslim ise
    onu terminale taşır. İkisi aynı anda doğru olamaz — biri kazanmalı, diğeri
    409 almalıdır.
    """
    for tur in range(TURLAR):
        oid, _paket, _stop, run, _kurye, _token = await _zimmetli_kurulum(
            client, kur, fab
        )

        gorevler = [
            _gorev(lambda s: order_service.mark_delivered(s, oid)),
            _gorev(lambda s: delivery_service.cancel_run(s, run)),
        ]
        adlar = ("deliver", "cancel")
        if ters:
            gorevler.reverse()
            adlar = tuple(reversed(adlar))

        sonuclar = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(sonuclar)
        sonuc = dict(zip(adlar, sonuclar, strict=True))
        d = await _son_durum(oid)

        assert not (d["siparis"] == "DELIVERED" and d["paket"] == "RETURN_PENDING"), (
            f"tur {tur}: ÇELİŞKİ — teslim edildi ama kutu araçta geri dönüyor: {d}"
        )

        if _basarili(sonuc["deliver"]):
            # Teslim kazandı: üçü BİRLİKTE terminal.
            assert d["siparis"] == "DELIVERED", d
            assert d["paket"] == "DELIVERED", d
            assert d["durak"] == "DELIVERED", d
            assert d["delivered_gecisi"] == 1, d
        else:
            # İptal kazandı: teslim güvenli biçimde reddedilmiş.
            assert _reddedildi(sonuc["deliver"]), sonuc["deliver"]
            assert d["siparis"] != "DELIVERED", d
            assert d["delivered_gecisi"] == 0, d


# ══════════════════ 3. mark_delivered ↔ fail_stop ═══════════════════════════


@pytest.mark.parametrize("ters", [False, True], ids=["deliver_once", "fail_once"])
async def test_ADMIN_TESLIM_ILE_DURAK_BASARISIZ_CELISKI_URETMEZ(client, kur, fab, ters):
    """Aynı durak hem `DELIVERED` hem `FAILED` olamaz; paket de ikisini birden
    gösteremez. Çift bildirim/geçiş de doğmamalı."""
    for tur in range(TURLAR):
        oid, _paket, stop_id, _run, _kurye, _token = await _zimmetli_kurulum(
            client, kur, fab
        )

        gorevler = [
            _gorev(lambda s: order_service.mark_delivered(s, oid)),
            _gorev(lambda s: delivery_service.fail_stop(s, stop_id, reason="kimse yok")),
        ]
        adlar = ("deliver", "fail")
        if ters:
            gorevler.reverse()
            adlar = tuple(reversed(adlar))

        sonuclar = await asyncio.gather(*gorevler, return_exceptions=True)
        _kilit_hatasi_yok(sonuclar)
        sonuc = dict(zip(adlar, sonuclar, strict=True))
        d = await _son_durum(oid)

        assert not (d["siparis"] == "DELIVERED" and d["durak"] == "FAILED"), (
            f"tur {tur}: durak başarısız ama sipariş teslim edildi: {d}"
        )
        assert not (d["siparis"] == "DELIVERED" and d["paket"] == "RETURN_PENDING"), (
            f"tur {tur}: teslim edildi ama kutu geri dönüyor: {d}"
        )
        assert d["delivered_gecisi"] <= 1, f"tur {tur}: çift teslim geçişi — {d}"

        if _basarili(sonuc["deliver"]):
            assert d["siparis"] == "DELIVERED", d
            assert d["paket"] == "DELIVERED", d
            assert d["durak"] == "DELIVERED", d
        else:
            assert _reddedildi(sonuc["deliver"]), sonuc["deliver"]
            assert d["siparis"] != "DELIVERED", d
            assert d["delivered_gecisi"] == 0, d


# ══════════════════ 4. Mutlu yol — TERMİNAL BÜTÜNLÜK ════════════════════════


async def test_ADMIN_TESLIM_MUTLU_YOL_SIPARIS_PAKET_DURAK_BIRLIKTE_TERMINAL(
    client, kur, fab
):
    """Yöneticinin TEK "Teslim edildi" tıklaması operasyonu tamamen kapatır.

    Eski hâlde yalnız sipariş durumu değişiyordu: paket `HANDED_OVER`, durak
    `PENDING`, QR geçerli kalıyordu — yani kurye o durağı ekranında görmeye,
    basılı etiket okutulmaya devam ediyordu ve "kuryede paket var" sorgusu
    hâlâ `true` diyordu. Bu düğüm dördünü birden ölçer ve tekilliği de sayar.
    """
    oid, paket, stop_id, _run, kurye, token = await _zimmetli_kurulum(client, kur, fab)
    _hid, kurye_token = await fab.kurye_hesabi(await fab.kurye())

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as s:
        siparis, delivered_at = (
            await s.execute(
                text("SELECT status, delivered_at FROM orders WHERE id = :o"), {"o": oid}
            )
        ).one()
        p_durum, p_delivered, p_handed, p_kurye = (
            await s.execute(
                text(
                    "SELECT status, delivered_at, handed_over_at, handed_to_courier_id "
                    "FROM order_packages WHERE id = :p"
                ),
                {"p": paket["id"]},
            )
        ).one()
        d_durum, d_delivered = (
            await s.execute(
                text("SELECT status, delivered_at FROM delivery_stops WHERE id = :i"),
                {"i": stop_id},
            )
        ).one()
        sayilar = {
            "delivered_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'DELIVERED'"
                    ),
                    {"o": oid},
                )
            ).scalar_one(),
            "teslim_olayi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM package_scan_events "
                        "WHERE package_id = :p AND event_type = 'DELIVER'"
                    ),
                    {"p": paket["id"]},
                )
            ).scalar_one(),
            "teslim_epostasi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM outbox_events "
                        "WHERE kind = 'email:order_status' "
                        "AND payload ->> 'order_id' = :o "
                        "AND payload ->> 'status' = 'DELIVERED'"
                    ),
                    {"o": str(oid)},
                )
            ).scalar_one(),
            "bildirim": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM notifications "
                        "WHERE link = '/siparislerim' AND message LIKE :m"
                    ),
                    {"m": f"%#{oid} teslim edildi%"},
                )
            ).scalar_one(),
            "audit": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM audit_logs "
                        "WHERE action = 'order.deliver' AND target_id = :o"
                    ),
                    {"o": oid},
                )
            ).scalar_one(),
        }

    assert siparis == "DELIVERED", siparis
    assert delivered_at is not None
    assert p_durum == "DELIVERED", f"paket terminale gitmedi: {p_durum}"
    assert p_delivered is not None, "paket teslim damgası yok"
    # HANDOVER izi KORUNUR: "kim taşıdı" sorusu teslimden sonra da cevaplanmalı.
    assert p_handed is not None, "zimmet damgası silinmiş"
    assert p_kurye == kurye, (p_kurye, kurye)
    assert d_durum == "DELIVERED", f"durak kapanmadı: {d_durum}"
    assert d_delivered is not None, "durak teslim damgası yok"

    for alan, beklenen in (
        ("delivered_gecisi", 1),
        ("teslim_olayi", 1),
        ("teslim_epostasi", 1),
        ("bildirim", 1),
        ("audit", 1),
    ):
        assert sayilar[alan] == beklenen, f"{alan}: {sayilar[alan]} (beklenen {beklenen})"

    # QR ARTIK GEÇERSİZ: terminal pakette zimmet de kapı taraması da reddedilir.
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code in (404, 409), f"teslim edilmiş paketin QR'ı hâlâ işliyor: {r.text}"

    # "Kuryede paket var" artık FALSE — geri dönüş kuyruğu bu kutuyu aramaz.
    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_packages "
                    "WHERE id = :p AND status IN ('HANDED_OVER', 'RETURN_PENDING')"
                ),
                {"p": paket["id"]},
            )
        ).scalar_one() == 0
