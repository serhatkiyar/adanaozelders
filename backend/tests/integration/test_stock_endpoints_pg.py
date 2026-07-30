"""Defter uçlarının GERÇEK HTTP davranışı (commit 6 mutasyon provası çıktısı).

## Neden bu dosya var

Mutasyon provasında bir uçtan `products.view` bağımlılığı kaldırıldığında
YALNIZCA kaynak metnini tarayan bir kabul testi kırıldı. Kaynak taraması,
"kod böyle yazılmış" der; "istek gerçekten reddediliyor" demez — ve kod bir gün
başka bir yoldan (router-level dependency kaldırma, yeni bir uç) aynı deliği
açtığında sessiz kalır.

Burada uçlara **gerçek HTTP isteği** atılır: token gerçek, admin satırı gerçek,
izin çözümü gerçek `admin_access_service` üzerinden. Ölçülen şey yanıt kodudur.
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

#: Dört ucun tamamı. Biri unutulursa mutasyon provası onu yakalayamaz.
UCLAR = [
    "/api/v1/store/admin/products/1/stock-movements",
    "/api/v1/store/admin/products/1/stock-verify",
    "/api/v1/store/admin/stock-movements",
    "/api/v1/store/admin/stock-verify",
]


@pytest.fixture
async def client():
    """ASGI taşıyıcı — uygulama TESTİN event loop'unda koşar.

    `TestClient` (sync) kendi anyio portal loop'unu açar; asyncpg bağlantıları
    loop'a bağlı olduğu için aynı `engine`'i kullanan testle çakışır
    ("attached to a different loop"). ASGI taşıyıcı bu ayrımı ortadan kaldırır.
    """
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    """İzinli ve izinsiz iki gerçek admin + token."""

    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.product_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> str:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"defter-{ek}@test.local",
                hashed_password="test-only",
                first_name="Defter",
                last_name="Testi",
                username=f"defter{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"DEFTER_{ek.upper()}",
                    name="Defter Testi",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return create_access_token(subject=a.id, role="ADMIN", role_id=1)

    async def bozuk_defterli_urun(self) -> int:
        """Zinciri KASITLI bozuk bir ürün (doğrulamanın "sorun var" dalı için)."""
        from decimal import Decimal

        from models.store import Product

        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"uc-testi-{ek}",
                title=f"Uç Testi {ek}",
                kind="PHYSICAL",
                seller_type="PLATFORM",
                price=Decimal("10.00"),
                stock=9,
                status="DRAFT",
            )
            s.add(p)
            await s.flush()
            await s.refresh(p, ["sku"])
            pid = p.id
            for delta, after in ((5, 5), (1, 9)):     # 6 olmalıydı → zincir kopuk
                await s.execute(
                    text(
                        "INSERT INTO stock_movements (product_id, qty_delta, "
                        "qty_after, movement_type, reason_code, actor_type, "
                        "actor_id) VALUES (:p, :d, :a, 'ADMIN_ADJUSTMENT', "
                        "'TEDARIK', 'ADMIN', 1)"
                    ),
                    {"p": pid, "d": delta, "a": after},
                )
            await s.commit()
        self.product_ids.append(pid)
        return pid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"
                    ),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"),
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
            if self.product_ids:
                # Defter satırları silinemez (append-only); ürün soft-delete.
                await s.execute(
                    text(
                        "UPDATE products SET deleted_at = now() "
                        "WHERE id = ANY(:i) AND deleted_at IS NULL"
                    ),
                    {"i": self.product_ids},
                )
            await s.commit()


@pytest.fixture
async def kurulum(pg) -> Kurulum:
    k = Kurulum()
    yield k
    await k.cleanup()


@pytest.mark.parametrize("yol", UCLAR)
async def test_anonim_istek_reddedilir(client, yol):
    """Token yok → uç hiç çalışmamalı."""
    r = await client.get(yol)
    assert r.status_code in (401, 403), f"{yol} → {r.status_code} ({r.text[:120]})"


@pytest.mark.parametrize("yol", UCLAR)
async def test_izinsiz_admin_reddedilir(client, kurulum, yol):
    """GERÇEK admin, GERÇEK rol, ama `products.view` YOK → 403.

    Mutasyon provası hedefi: uçtan izin bağımlılığı kaldırılırsa bu test 200
    görür ve kırılır.
    """
    token = await kurulum.admin(izinler=["users.view", "reports.view"])
    r = await client.get(yol, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, f"{yol} → {r.status_code} ({r.text[:160]})"


@pytest.mark.parametrize("sablon", [
    "/api/v1/store/admin/products/{pid}/stock-movements",
    "/api/v1/store/admin/products/{pid}/stock-verify",
    "/api/v1/store/admin/stock-movements",
    "/api/v1/store/admin/stock-verify",
])
async def test_izinli_admin_gecer(client, kurulum, sablon):
    """Karşı kanıt: izin verilince aynı uç 200 dönüyor.

    Bu olmadan yukarıdaki 403'ler "uç zaten bozuk" ile karıştırılabilirdi.

    Ürün BULGULU bir defterle kurulur (bozuk zincir): doğrulama uçlarının
    "sorun var" dalı da HTTP üzerinden geçmiş olur. Mutasyon provası sırasında
    tam bu dalda bir üretim hatası bulundu — `LedgerProblem` bir `slots`
    dataclass'ı olduğu için `vars()` `TypeError` atıyordu ve bulgu içeren her
    yanıt 500 dönüyordu. Testler o zamana dek yalnız SERVİS katmanını
    çağırdığından hata görünmemişti.
    """
    token = await kurulum.admin(izinler=["products.view"])
    pid = await kurulum.bozuk_defterli_urun()
    r = await client.get(
        sablon.format(pid=pid), headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 200, f"{sablon} → {r.status_code} ({r.text[:200]})"


async def test_dogrulama_ucu_BULGULARI_donduruyor(client, kurulum):
    """Bulgular yanıt gövdesinde: kod + beklenen/görülen."""
    token = await kurulum.admin(izinler=["products.view"])
    pid = await kurulum.bozuk_defterli_urun()
    r = await client.get(
        f"/api/v1/store/admin/products/{pid}/stock-verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text[:200]
    g = r.json()
    assert g["consistent"] is False
    kodlar = {p["code"] for p in g["problems"]}
    assert "CHAIN_BREAK" in kodlar, g["problems"]
    kopuk = next(p for p in g["problems"] if p["code"] == "CHAIN_BREAK")
    assert kopuk["expected"] == 6 and kopuk["actual"] == 9
    assert kopuk["sku"] == f"FZK-{pid:06d}"


async def test_genel_denetim_ucu_BULGULARI_donduruyor(client, kurulum):
    token = await kurulum.admin(izinler=["products.view"])
    await kurulum.bozuk_defterli_urun()
    r = await client.get(
        "/api/v1/store/admin/stock-verify?limit=200",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text[:200]
    g = r.json()
    assert g["checked"] >= 1
    assert isinstance(g["problems"], list)


@pytest.mark.parametrize("metod", ["post", "put", "patch", "delete"])
async def test_yazma_metotlari_yok(client, kurulum, metod):
    """Defter append-only: izinli admin bile hareket oluşturamaz/silemez."""
    token = await kurulum.admin(izinler=["products.view", "products.manage"])
    r = await client.request(
        metod.upper(),
        "/api/v1/store/admin/stock-movements",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 405, f"{metod.upper()} → {r.status_code}"


async def test_liste_sayfalama_tavani_HTTP_seviyesinde_zorlanir(client, kurulum):
    """`limit` tavanı uçta da doğrulanır (422) — servise düşmeden."""
    token = await kurulum.admin(izinler=["products.view"])
    r = await client.get(
        "/api/v1/store/admin/stock-movements?limit=10000",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422, r.text[:200]


async def test_liste_yanitinda_idempotency_anahtari_YOK(client, kurulum):
    """Ticari kimlik taşıyan anahtar normal listede sızmamalı."""
    token = await kurulum.admin(izinler=["products.view"])
    r = await client.get(
        "/api/v1/store/admin/stock-movements?limit=5",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    gövde = r.json()
    assert "idempotency_key" not in r.text
    for satir in gövde["rows"]:
        assert set(satir) == {
            "id", "product_id", "sku", "product_title", "qty_delta", "qty_after",
            "movement_type", "reason_code", "ref_type", "ref_id", "ref_line_id",
            "actor_type", "actor_id", "note", "created_at",
        }, sorted(satir)
