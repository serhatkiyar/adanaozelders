"""F30 HTTP uçları ve yetki matrisi — GERÇEK HTTP + GERÇEK PostgreSQL.

Yetki iddiaları kaynak taramasıyla değil, **gerçek istekle** kanıtlanır
(kök `CLAUDE.md` §B): "bu uç gerçekten 403 dönüyor" ancak böyle gösterilebilir.
Uygulama testin event loop'unda ASGI taşıyıcıyla koşar (asyncpg loop'a bağlıdır).

Yetki kademeleri (sözleşme §6):
* `packing.view`  — okuma
* `packing.pack`  — paket aç / tara / tamamla
* `packing.manage`— void (kapalı paket) / return-in / repack / unpack
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service
from tests.integration.auth_headers import bearer_token
from tests.integration.f30_factory import PaketFabrikasi

VIEW, PACK, MANAGE = "packing.view", "packing.pack", "packing.manage"

OKUMA_UCLARI = [
    ("GET", "/api/v1/packing/queue"),
    ("GET", "/api/v1/packing/packages"),
    ("GET", "/api/v1/packing/packages/1"),
]
PAKETLEME_UCLARI = [
    ("POST", "/api/v1/packing/orders/1/open"),
    ("POST", "/api/v1/packing/packages/1/scan"),
    ("POST", "/api/v1/packing/packages/1/undo-scan"),
    ("POST", "/api/v1/packing/packages/1/complete"),
]
YONETIM_UCLARI = [
    ("POST", "/api/v1/packing/packages/1/return-in"),
    ("POST", "/api/v1/packing/packages/1/repack"),
    ("POST", "/api/v1/packing/packages/1/unpack"),
]
TUM_UCLAR = OKUMA_UCLARI + PAKETLEME_UCLARI + YONETIM_UCLARI

# Commit 5 denetiminin bulgusu: iki uç matrisin HİÇBİR listesinde yoktu ve
# dolayısıyla token'sız/CLIENT/COURIER/izinsiz-ADMIN denemeleri onlara HİÇ
# uygulanmıyordu. `void` "kapanmış pakette manage ister" testi ayrı dosyada
# vardı ama rol matrisi yoktu; `return-queue` ise hiçbir yerde sınanmamıştı.
#
# `void` `PAKETLEME_UCLARI`'na KONMAZ: izni duruma bağlıdır (OPEN → pack,
# kapanmış → manage) ve `test_VIEW_izni_YAZAMAZ` gibi kademe testleri onu
# yanlış kademeye yerleştirirdi. `return-queue` de `OKUMA_UCLARI`'na konmaz:
# o liste `test_VIEW_izni_OKUYABILIR`'de 200 bekleyen uçlar için değil, 401/403
# kademeleri içindir — ama 401/403 matrisine dahil edilmelidir.
VOID_UCU = ("POST", "/api/v1/packing/packages/1/void")
RETURN_QUEUE_UCU = ("GET", "/api/v1/packing/return-queue")
TUM_UCLAR_GENIS = TUM_UCLAR + [VOID_UCU, RETURN_QUEUE_UCU]
#: Salt-okuma izniyle DENENMEMESİ gereken uçlar. `void` buradadır: en düşük
#: kademesi bile `packing.pack`tir (OPEN pakette), yani `packing.view` ona
#: hiçbir durumda yetmez. Bağımlılığı VIEW'a düşürmek bu matrisi kırar.
YAZMA_UCLARI = PAKETLEME_UCLARI + YONETIM_UCLARI + [VOID_UCU]


def _govde(yol: str) -> dict:
    if yol.endswith("/void"):
        return {"reason": "yetki matrisi testi"}
    if yol.endswith("/scan"):
        return {"code": "FZK-000001"}
    if yol.endswith("/undo-scan"):
        return {"order_item_id": 1, "reason": "yanlış okutuldu"}
    if yol.endswith("/unpack"):
        return {}
    return {}


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> tuple[int, str]:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"pak-{ek}@test.local",
                hashed_password="test-only",
                first_name="Paket",
                last_name="Testi",
                username=f"pak{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"PAK_{ek.upper()}",
                    name="Paketleme Testi",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return a.id, create_access_token(
                subject=a.id, role="ADMIN", role_id=1, auth_version=a.auth_version
            )

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"), {"i": self.role_ids}
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"), {"i": self.admin_ids}
                )
            await s.commit()


@pytest.fixture
async def kur(pg):
    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


@pytest.fixture
async def fab(pg):
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ══════════════════ 401 ═════════════════════════════════════════════════════


@pytest.mark.parametrize("metod,yol", TUM_UCLAR_GENIS, ids=[y for _m, y in TUM_UCLAR_GENIS])
async def test_token_YOKSA_401(client, kur, metod, yol):
    r = await client.request(metod, yol, json=_govde(yol))
    assert r.status_code == 401, f"{metod} {yol} → {r.status_code}"


# ══════════════════ 403: izinsiz admin ══════════════════════════════════════


@pytest.mark.parametrize("metod,yol", TUM_UCLAR_GENIS, ids=[y for _m, y in TUM_UCLAR_GENIS])
async def test_IZINSIZ_admin_403(client, kur, metod, yol):
    """Kullanıcı maddesi: yetkisiz admin okuyamaz/yazamaz."""
    _aid, token = await kur.admin(izinler=["dashboard.view"])
    r = await client.request(metod, yol, json=_govde(yol), headers=_bas(token))
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


@pytest.mark.parametrize(
    "metod,yol",
    YAZMA_UCLARI,
    ids=[y for _m, y in YAZMA_UCLARI],
)
async def test_VIEW_izni_YAZAMAZ(client, kur, metod, yol):
    """Görev ayrılığı: okuyan kişi paketleyemez."""
    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.request(metod, yol, json=_govde(yol), headers=_bas(token))
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


@pytest.mark.parametrize("metod,yol", YONETIM_UCLARI, ids=[y for _m, y in YONETIM_UCLARI])
async def test_PACK_izni_YONETIM_YAPAMAZ(client, kur, metod, yol):
    """Paketleyen kişi tek başına paketi çözemez / geri dönüşü onaylayamaz —
    F29'un üç kademeli envanter ayrımıyla aynı gerekçe."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    r = await client.request(metod, yol, json=_govde(yol), headers=_bas(token))
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


async def test_VIEW_izni_OKUYABILIR(client, kur):
    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.get("/api/v1/packing/queue", headers=_bas(token))
    assert r.status_code == 200


# ══════════════════ Diğer roller ════════════════════════════════════════════


@pytest.mark.parametrize("metod,yol", TUM_UCLAR_GENIS, ids=[y for _m, y in TUM_UCLAR_GENIS])
async def test_KURYE_paketleme_uclarina_ERISEMEZ(client, fab, metod, yol):
    """Kurye yalnız zimmet ucunu kullanır; depo ekranlarına erişemez."""
    kurye = await fab.kurye()
    _hid, token = await fab.kurye_hesabi(kurye)
    r = await client.request(metod, yol, json=_govde(yol), headers=_bas(token))
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


@pytest.mark.parametrize(
    "metod,yol", TUM_UCLAR_GENIS, ids=[y for _m, y in TUM_UCLAR_GENIS]
)
async def test_MUSTERI_paketleme_ucuna_ERISEMEZ(client, fab, metod, yol):
    """CLIENT hiçbir paketleme ucuna erişemez — matris hâlinde.

    Eskiden yalnız `/packing/queue` deneniyordu; `void` ve `return-queue` dahil
    diğer on bir uç hiç sınanmamıştı (commit 5 denetimi).
    """
    cid = await fab.musteri()
    token = await bearer_token(cid, role="CLIENT", role_id=3)
    r = await client.request(metod, yol, json=_govde(yol), headers=_bas(token))
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


async def test_VIEW_izni_RETURN_QUEUE_OKUYABILIR(client, kur):
    """`return-queue` bir OKUMA ucudur: `packing.view` yeter, 200 döner.

    Ters prova görevi görür — yukarıdaki 403 matrisi, ucun tamamen kapalı
    olduğu hâlde de yeşil kalırdı.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.get("/api/v1/packing/return-queue", headers=_bas(token))
    assert r.status_code == 200, r.text
    # Uç commit 7'de sayfalandı (kardeş uçlarla aynı sözleşme): düz liste
    # yerine `{items,total,limit,offset}`. `isinstance(..., list)` iddiası
    # ŞEKLİ ölçüyordu ve yeni şekilde yanlış kırmızı verirdi; asıl ölçtüğü
    # şey — "VIEW izni bu ucu OKUYABİLİR" — korunuyor ve sözleşme alan
    # alan sabitlendi (eskisi `[]` dönen bozuk bir uçta da geçerdi).
    govde = r.json()
    assert set(govde) == {"items", "total", "limit", "offset"}, govde
    assert isinstance(govde["items"], list)
    assert isinstance(govde["total"], int)


async def test_PACK_izni_VOID_UCUNU_KULLANABILIR(client, kur, fab):
    """`void` `packing.pack` kademesindedir (OPEN pakette) — 403 DEĞİL.

    Yukarıdaki matris `void`u yalnız reddedilen roller için ölçüyor; bu düğüm
    ucun gerçekten çalıştığını sabitler, yoksa "hep 403" bir uç da matrisi
    geçerdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/void",
        json={"reason": "Yanlış sipariş"},
        headers=_bas(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "VOID"


# ══════════════════ Tam akış ════════════════════════════════════════════════


async def test_PACK_izniyle_TAM_AKIS_200(client, kur, fab):
    """Uçtan uca gerçek HTTP: paket aç → tara → tamamla.

    Ara adımların yalnız 200 dönmesi yetmez; son durum ve `prepared_at`
    damgası da doğrulanır — "uç çalıştı" ile "iş oldu" aynı şey değildir.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])

    r = await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    assert r.status_code in (200, 201), r.text
    paket = r.json()
    assert paket["status"] == "OPEN"
    assert paket["qr_payload"].startswith("PKG1:")
    assert {k["sku"] for k in paket["items"]} == {sku}

    for _ in range(2):
        r = await client.post(
            f"/api/v1/packing/packages/{paket['id']}/scan",
            json={"code": ean, "idempotency_key": uuid.uuid4().hex},
            headers=_bas(token),
        )
        assert r.status_code == 200, r.text
        assert r.json()["result"] == "OK"

    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PACKED"
    assert await fab.prepared_at(oid) is not None


async def test_scan_YANITI_SONUC_KODU_TASIR(client, kur, fab):
    """Red bir iş sonucudur (200 + `result`), yapısal hata değil — aksi hâlde
    transaction geri alınır ve red taraması ize yazılamazdı (sözleşme §6).

    Bu, sessiz yutmayı da davet eder; bu yüzden `result` alanı zorunludur ve
    DOM testi kırmızı bandı ayrıca doğrular.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    yabanci, yabanci_sku, _ye = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/scan",
        json={"code": yabanci_sku},
        headers=_bas(token),
    )
    assert r.status_code == 200
    assert r.json()["result"] == "WRONG_SKU"
    assert r.json()["items"][0]["scanned_qty"] == 0


async def test_EKSIK_paket_complete_409(client, kur, fab):
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 2)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(token)
    )
    assert r.status_code == 409


async def test_liste_SAYFALAMA_TAVANI_uygular(client, kur):
    """Sayfalama tavanı kaldırılırsa tek istek tüm tabloyu çeker
    (F29 `LIST_MAX_LIMIT=200` deseni)."""
    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.get("/api/v1/packing/packages?limit=100000", headers=_bas(token))
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert len(r.json().get("items", [])) <= 200


async def test_YOK_paket_404(client, kur):
    """Var olmayan paket 404 döner — ama **uç var olduğu için**.

    Bu düğüm bir kez yalancı yeşile düştü: router henüz yazılmamışken de 404
    dönüyordu (olmayan YOL da 404'tür) ve "paket bulunamadı" iddiası hiçbir şey
    kanıtlamıyordu. Ayırt edici gözlem: kimlik doğrulamasız istek. Uç varsa
    yetki katmanı devreye girer ve 404 DIŞINDA bir şey döner (401/403); uç
    yoksa o istek de 404 alır.
    """
    yol = "/api/v1/packing/packages/99999999"
    anonim = await client.get(yol)
    assert anonim.status_code != 404, (
        "packing router'ı yok — 404 'paket bulunamadı' değil 'yol bulunamadı'"
    )

    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.get(yol, headers=_bas(token))
    assert r.status_code == 404


# ══════════════════ Zimmet ucu ══════════════════════════════════════════════


async def test_KURYE_zimmet_ucunu_KULLANABILIR(client, kur, fab):
    """Saha ucu `field_router`'dadır: ADMIN veya KURYE (`_field_user` deseni)."""
    _aid, admin_token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(admin_token))
    ).json()
    await client.post(
        f"/api/v1/packing/packages/{paket['id']}/scan",
        json={"code": ean}, headers=_bas(admin_token),
    )
    await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(admin_token)
    )
    async with AsyncSessionLocal() as s:
        from services import delivery_service

        await delivery_service.add_stops(s, run, [oid])

    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "HANDED_OVER"
    assert (await fab.siparis_durumu(oid))[0] == "SHIPPED"


async def test_MUSTERI_zimmet_ucuna_ERISEMEZ(client, fab):
    cid = await fab.musteri()
    token = await bearer_token(cid, role="CLIENT", role_id=3)
    r = await client.post(
        "/api/v1/delivery/handover/scan", json={"payload": "PKG1:1:x"},
        headers=_bas(token),
    )
    assert r.status_code == 403


# ══════════════════ Kaldırılan uç ═══════════════════════════════════════════


async def test_eski_prepare_ucu_ARTIK_YOK(client, kur, fab):
    """Sözleşme §3.5: elle "Hazır" butonu kaldırıldı — iki kapı bırakmak
    "eksik kalem kabul edilmez" ilkesini boşa çıkarır.

    404/405 bekleniyor. 200 dönerse arka kapı hâlâ açıktır.
    """
    _aid, token = await kur.admin(izinler=["delivery.view", "delivery.manage"])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    r = await client.post(f"/api/v1/delivery/orders/{oid}/prepare", headers=_bas(token))
    assert r.status_code in (404, 405), f"eski prepare ucu hâlâ çalışıyor: {r.status_code}"
    assert await fab.prepared_at(oid) is None
