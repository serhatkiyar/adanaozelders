"""Kategori bazlı varsayılan KDV altyapısı — GERÇEK HTTP + Postgres (Faz 4).

Kanıtlanan davranışlar:
  * `default_tax_rate` kategori API'sinden yazılır/temizlenir (nullable).
  * Kategori listesi mirası ÇÖZÜLMÜŞ `effective_tax_rate` ile döner
    (yaprak NULL → yaprağa en yakın dolu ata; karar: tests/
    test_category_tax_inherit.py docstring'i).
  * Sınır dışı değer 422 (Pydantic) — DB CHECK'i son savunma.
  * DAVRANIŞ DEĞİŞMEDİ: `default_tax_rate` DOLU kategoride bile ürün
    `tax_rate`'i ZORUNLU kalır (sunucu türetmez) ve ürün seviyesinde
    ezilebilir.

MUTLAK KURAL: gerçek KDV oranı YAZILMAZ (mali müşavir onayı bekleniyor).
Aşağıdaki oran sabitleri bilinçli olarak gerçek dışı TEST değerleridir.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import exc as sa_exc
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from models.store import ProductCategory
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service
from tests.integration.db_guard import purge_products

# TEST DEĞERLERİ — gerçek KDV oranı DEĞİLDİR (mali müşavir onayı bekleniyor).
TEST_ORAN = "0.1234"
TEST_ORAN_URUN = "0.4321"

KAT = "/api/v1/store/admin/categories"
URUN = "/api/v1/store/admin/products"


def _u() -> str:
    return uuid.uuid4().hex[:10]


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
        self.product_ids: list[int] = []
        self.category_ids: list[int] = []

    async def admin(self) -> tuple[int, str]:
        ek = _u()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"kdv-{ek}@test.local", hashed_password="test-only",
                first_name="Kdv", last_name="Testi", username=f"kdv{ek}", role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"KDV_{ek.upper()}", name="Kdv Testi",
                    permission_codes=["products.view", "products.manage"],
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

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.product_ids:
                await purge_products(s, self.product_ids)
        # Toplu içe aktarma testi ürün kimliğini HTTP yanıtından alamaz; buna
        # rağmen ürün, bu fixture'ın oluşturduğu kategoriye bağlıdır. RESTRICT
        # FK doğru biçimde kategori silmeyi engellediği için önce o ürünleri de
        # kategori bağı üzerinden fiziksel temizleriz.
        async with AsyncSessionLocal() as s:
            if self.category_ids:
                category_product_ids = (
                    await s.execute(
                        text(
                            "SELECT id FROM products "
                            "WHERE category_id = ANY(:i)"
                        ),
                        {"i": self.category_ids},
                    )
                ).scalars().all()
                if category_product_ids:
                    await purge_products(s, category_product_ids)
        async with AsyncSessionLocal() as s:
            if self.category_ids:
                await s.execute(
                    text("DELETE FROM product_categories WHERE id = ANY(:i)"),
                    {"i": list(reversed(self.category_ids))},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"),
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
        await k.cleanup()


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _kategori(client, kur, tok, *, name, parent_id=None, default_tax_rate=None):
    govde = {"name": name, "parent_id": parent_id}
    if default_tax_rate is not None:
        govde["default_tax_rate"] = default_tax_rate
    r = await client.post(KAT, json=govde, headers=_bas(tok))
    assert r.status_code == 201, r.text
    veri = r.json()
    kur.category_ids.append(veri["id"])
    return veri


async def _listede(client, tok, cat_id: int) -> dict:
    r = await client.get("/api/v1/store/categories")
    assert r.status_code == 200, r.text
    return next(c for c in r.json() if c["id"] == cat_id)


async def test_default_tax_rate_yazilir_ve_temizlenir(client, kur):
    _aid, tok = await kur.admin()
    kat = await _kategori(
        client, kur, tok, name=f"KdvKat {_u()}", default_tax_rate=TEST_ORAN
    )
    assert Decimal(str(kat["default_tax_rate"])) == Decimal(TEST_ORAN)

    r = await client.patch(
        f"{KAT}/{kat['id']}", json={"default_tax_rate": None}, headers=_bas(tok)
    )
    assert r.status_code == 200, r.text
    assert r.json()["default_tax_rate"] is None


async def test_liste_mirasi_cozulmus_effective_doner(client, kur):
    _aid, tok = await kur.admin()
    kok = await _kategori(
        client, kur, tok, name=f"KdvKok {_u()}", default_tax_rate=TEST_ORAN
    )
    yaprak = await _kategori(
        client, kur, tok, name=f"KdvYaprak {_u()}", parent_id=kok["id"]
    )
    satir = await _listede(client, tok, yaprak["id"])
    # Kendi değeri NULL; effective köketen miras.
    assert satir["default_tax_rate"] is None
    assert Decimal(str(satir["effective_tax_rate"])) == Decimal(TEST_ORAN)
    # Kökün effective'i kendi değeri.
    kok_satir = await _listede(client, tok, kok["id"])
    assert Decimal(str(kok_satir["effective_tax_rate"])) == Decimal(TEST_ORAN)


async def test_varsayilansiz_agacta_effective_null(client, kur):
    """DAVRANIŞ DEĞİŞMEDİ nöbetçisi: kimse oran girmediyse hiçbir kategoriye
    oran UYDURULMAZ (bugünkü NULL dünyası birebir)."""
    _aid, tok = await kur.admin()
    kok = await _kategori(client, kur, tok, name=f"KdvBos {_u()}")
    yaprak = await _kategori(
        client, kur, tok, name=f"KdvBosYaprak {_u()}", parent_id=kok["id"]
    )
    for cid in (kok["id"], yaprak["id"]):
        satir = await _listede(client, tok, cid)
        assert satir["default_tax_rate"] is None
        assert satir["effective_tax_rate"] is None


async def test_sinir_disi_oran_reddedilir(client, kur):
    _aid, tok = await kur.admin()
    for bozuk in ("1.0000", "-0.1000"):
        r = await client.post(
            KAT,
            json={"name": f"Bozuk {_u()}", "default_tax_rate": bozuk},
            headers=_bas(tok),
        )
        assert r.status_code == 422, (bozuk, r.text)


async def test_db_check_son_savunma(kur, pg):
    """Pydantic'i atlayan yazıcı (ham ORM/SQL) DB CHECK'ine çarpar."""
    with pytest.raises(sa_exc.IntegrityError) as ei:
        async with AsyncSessionLocal() as s:
            s.add(
                ProductCategory(
                    slug=f"kdv-check-{_u()}", name="Check",
                    default_tax_rate=Decimal("2.0"),  # sınır dışı — oran değil
                )
            )
            await s.commit()
    assert "ck_product_categories_default_tax" in str(ei.value)


async def test_urun_tax_rate_hala_zorunlu_ve_ezilebilir(client, kur):
    """NEGATİF KONTROL çifti:
    (a) default'lu kategoride bile ürün `tax_rate`'siz 422 — sunucu ASLA
        kategori varsayılanından oran türetmez (ön-doldurma yalnız formda).
    (b) ürün, kategorinin varsayılanından FARKLI bir oranla oluşturulabilir
        ve o oranı taşır (ürün seviyesi ezme)."""
    _aid, tok = await kur.admin()
    kat = await _kategori(
        client, kur, tok, name=f"KdvUrun {_u()}", default_tax_rate=TEST_ORAN
    )
    r = await client.post(
        URUN,
        json={
            "title": f"Oransız Ürün {_u()}", "kind": "PHYSICAL",
            "price": "50.00", "category_id": kat["id"],
        },
        headers=_bas(tok),
    )
    assert r.status_code == 422, r.text

    r = await client.post(
        URUN,
        json={
            "title": f"Ezilmiş Oran {_u()}", "kind": "PHYSICAL",
            "price": "50.00", "category_id": kat["id"],
            "tax_rate": TEST_ORAN_URUN,   # kategori varsayılanından FARKLI
        },
        headers=_bas(tok),
    )
    assert r.status_code == 201, r.text
    veri = r.json()
    kur.product_ids.append(veri["id"])
    assert Decimal(str(veri["tax_rate"])) == Decimal(TEST_ORAN_URUN)
