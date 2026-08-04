"""F29 uçlarının GERÇEK HTTP yetki davranışı — 401 / 403 / 200.

Kaynak taraması "kod böyle yazılmış" der; "istek gerçekten reddediliyor"
demez. Burada token gerçek, admin satırı gerçek, izin çözümü gerçek
`admin_access_service` üzerinden yapılır; ölçülen şey yanıt kodudur
(`test_stock_endpoints_pg.py` deseni — o dosya mutasyon provasında kaynak
testinin yetmediği gösterildiği için yazılmıştı).

Ayrıca burada **yarım izin tuzağı** sınanır: kataloğa eklenmemiş bir izin
kodu hiçbir role bağlanamaz ve uç SUPER_ADMIN dahil herkese sessizce 403
döner (`core/admin_permissions.py:1-13`).

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
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
from tests.integration.inventory_factory import Fabrika

#: F29'un açacağı uçlar. Biri unutulursa mutasyon provası onu yakalayamaz.
OKUMA_UCLARI = [
    ("GET", "/api/v1/inventory/count-sessions"),
    ("GET", "/api/v1/inventory/count-sessions/1"),
    ("GET", "/api/v1/inventory/damage-events"),
]
SAYIM_UCLARI = [
    ("POST", "/api/v1/inventory/count-sessions"),
    ("POST", "/api/v1/inventory/count-sessions/1/start"),
    ("POST", "/api/v1/inventory/count-sessions/1/lines/1/count"),
    ("POST", "/api/v1/inventory/count-sessions/1/submit"),
]
UYGULAMA_UCLARI = [
    ("POST", "/api/v1/inventory/count-sessions/1/apply"),
    ("POST", "/api/v1/inventory/count-sessions/1/reopen"),
    ("POST", "/api/v1/inventory/damage-events"),
]
TUM_UCLAR = OKUMA_UCLARI + SAYIM_UCLARI + UYGULAMA_UCLARI

VIEW, COUNT, APPLY = "inventory.view", "inventory.count", "inventory.apply"


@pytest.fixture
async def client():
    """ASGI taşıyıcı — uygulama TESTİN event loop'unda koşar (asyncpg loop'a bağlı)."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> str:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"env-{ek}@test.local",
                hashed_password="test-only",
                first_name="Envanter",
                last_name="Testi",
                username=f"env{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"ENV_{ek.upper()}",
                    name="Envanter Testi",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return create_access_token(subject=a.id, role="ADMIN", role_id=1, auth_version=a.auth_version)

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
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
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
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


def _bos_govde(yol: str) -> dict:
    if yol.endswith("/count"):
        return {"counted_qty": 1}
    if yol.endswith("/count-sessions"):
        return {"scope": "MANUAL", "product_ids": []}
    if yol.endswith("/damage-events"):
        return {"product_id": 1, "kind": "TRANSFER", "qty": 1, "reason_code": "KIRIK"}
    if yol.endswith("/apply"):
        return {"idempotency_key": "k"}
    if yol.endswith("/cancel"):
        return {"reason": "test"}
    return {}


# ── 401 ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("metod,yol", TUM_UCLAR, ids=[y for _m, y in TUM_UCLAR])
async def test_token_YOKSA_401(client, kur, metod, yol):
    r = await client.request(metod, yol, json=_bos_govde(yol))
    assert r.status_code == 401, f"{metod} {yol} → {r.status_code}"


# ── 403: izinsiz admin ─────────────────────────────────────────────────────

@pytest.mark.parametrize("metod,yol", TUM_UCLAR, ids=[y for _m, y in TUM_UCLAR])
async def test_izinsiz_admin_403(client, kur, metod, yol):
    """Giriş yapabilen ama envanter yetkisi olmayan admin (direktifteki senaryo)."""
    token = await kur.admin(izinler=["dashboard.view"])
    r = await client.request(
        metod, yol, json=_bos_govde(yol), headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


# ── Kademeli yetki ─────────────────────────────────────────────────────────

async def test_yalniz_VIEW_okur_ama_YAZAMAZ(client, kur):
    token = await kur.admin(izinler=[VIEW])
    h = {"Authorization": f"Bearer {token}"}

    r = await client.get("/api/v1/inventory/count-sessions", headers=h)
    assert r.status_code == 200

    for metod, yol in SAYIM_UCLARI + UYGULAMA_UCLARI:
        r = await client.request(metod, yol, json=_bos_govde(yol), headers=h)
        assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


async def test_COUNT_izni_UYGULAMAYA_yetmez(client, kur):
    """Görev ayrılığının kapısı: sayan kişi tek başına envanteri değiştiremez."""
    token = await kur.admin(izinler=[VIEW, COUNT])
    h = {"Authorization": f"Bearer {token}"}
    for metod, yol in UYGULAMA_UCLARI:
        r = await client.request(metod, yol, json=_bos_govde(yol), headers=h)
        assert r.status_code == 403, f"{metod} {yol} → {r.status_code}"


async def test_COUNT_izniyle_oturum_ACILABILIR(client, kur, fab):
    pid = await fab.urun(stock=5)
    token = await kur.admin(izinler=[VIEW, COUNT])
    r = await client.post(
        "/api/v1/inventory/count-sessions",
        json={"scope": "MANUAL", "product_ids": [pid]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (200, 201), r.text


async def test_APPLY_izniyle_tam_akis_200(client, kur, fab):
    pid = await fab.urun(stock=10)
    token = await kur.admin(izinler=[VIEW, COUNT, APPLY])
    h = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/api/v1/inventory/count-sessions",
        json={"scope": "MANUAL", "product_ids": [pid]},
        headers=h,
    )
    assert r.status_code in (200, 201), r.text
    sid = r.json()["id"]

    assert (
        await client.post(f"/api/v1/inventory/count-sessions/{sid}/start", headers=h)
    ).status_code == 200

    r = await client.get(f"/api/v1/inventory/count-sessions/{sid}", headers=h)
    assert r.status_code == 200
    satirlar = r.json()["lines"]
    for satir in satirlar:
        rr = await client.post(
            f"/api/v1/inventory/count-sessions/{sid}/lines/{satir['id']}/count",
            json={"counted_qty": 10 if satir["bucket"] == "SALEABLE" else 0},
            headers=h,
        )
        assert rr.status_code == 200, rr.text

    assert (
        await client.post(f"/api/v1/inventory/count-sessions/{sid}/submit", headers=h)
    ).status_code == 200
    r = await client.post(
        f"/api/v1/inventory/count-sessions/{sid}/apply",
        json={"idempotency_key": "http-1"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APPLIED"


# ── Yanıt gövdesi sözleşmesi ───────────────────────────────────────────────

async def test_yanitta_PARASAL_alan_YOK(client, kur, fab):
    """Direktif: F29 parasal değerleme yapmaz. Ürün fiyatı yanıta sızarsa,
    arayüzde 'hasarlı stok değeri' göstermek bir satırlık iş olur."""
    pid = await fab.urun(stock=5)
    token = await kur.admin(izinler=[VIEW, COUNT])
    h = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/api/v1/inventory/count-sessions",
        json={"scope": "MANUAL", "product_ids": [pid]},
        headers=h,
    )
    sid = r.json()["id"]
    await client.post(f"/api/v1/inventory/count-sessions/{sid}/start", headers=h)
    govde = (
        await client.get(f"/api/v1/inventory/count-sessions/{sid}", headers=h)
    ).text.lower()
    for yasak in ("price", "cost", "amount", "currency", "tutar", "maliyet"):
        assert yasak not in govde, f"parasal alan sızmış: {yasak}"


async def test_liste_ucu_ZORUNLU_SAYFALAMA_uygular(client, kur):
    """Tavan yoksa tek istek bütün tabloyu çeker."""
    token = await kur.admin(izinler=[VIEW])
    r = await client.get(
        "/api/v1/inventory/count-sessions?limit=100000",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert r.json()["limit"] <= 200
