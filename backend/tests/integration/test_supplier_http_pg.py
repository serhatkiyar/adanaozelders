"""Tedarikçi uçlarının GERÇEK HTTP davranışı — 401 / 403 / 200 / 409.

Kaynak taraması "kod böyle yazılmış" der; "istek gerçekten reddediliyor"
demez (`test_inventory_endpoints_pg.py` deseni). Burada token gerçek, admin
satırı gerçek, izin çözümü gerçek `admin_access_service` üzerinden yapılır.

## Ölçülen üç şey

1. **Görev ayrılığı** — `products.manage` tedarikçi ayarını AÇMAZ. Ürün metnini
   düzenleyen kişi API token'ını değiştirememeli (sözleşme §3). S4'ün hedefi.
2. **D-5, at-rest** — token veritabanında düz metin DEĞİLDİR ve HİÇBİR yanıtta
   geri dönmez. Şema testi (`test_supplier_contract.py`) alanın yokluğunu
   ölçüyor; burası gerçek gövdeyi tarar.
3. **Yarım izin tuzağı** — kataloğa eklenmemiş bir izin kodu hiçbir role
   bağlanamaz ve uç SUPER_ADMIN dahil herkese sessizce 403 döner
   (`core/admin_permissions.py:1-13`).
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.supplier_factory import GECERLI_BARKODLAR, Fabrika

GIZLI_TOKEN = "eyJhbGciOiJIUzI1NiJ9.PANELDEN-GIRILEN-GIZLI-TOKEN.imza"

VIEW, MANAGE = "suppliers.view", "suppliers.manage"


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    yield f
    await f.temizle()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ═══════════════ Yetki ═══════════════


async def test_kimliksiz_istek_401(fab, client):
    sid = await fab.tedarikci()
    for method, yol in (
        ("GET", "/api/v1/store/admin/suppliers"),
        ("PATCH", f"/api/v1/store/admin/suppliers/{sid}"),
        ("POST", f"/api/v1/store/admin/suppliers/{sid}/sync"),
        ("GET", f"/api/v1/store/admin/suppliers/{sid}/products"),
    ):
        r = await client.request(method, yol, json={})
        assert r.status_code == 401, f"{method} {yol} → {r.status_code}"


async def test_urun_izni_tedarikci_ayarini_acmaz(fab, client):
    """S4'ün hedefi. `products.manage` bir ÜRÜN iznidir; token bir SIRDIR."""
    sid = await fab.tedarikci()
    token = await fab.admin_token(izinler=["products.view", "products.manage"])

    for method, yol in (
        ("GET", "/api/v1/store/admin/suppliers"),
        ("PATCH", f"/api/v1/store/admin/suppliers/{sid}"),
        ("POST", f"/api/v1/store/admin/suppliers/{sid}/sync"),
    ):
        r = await client.request(method, yol, json={"reason": "x"}, headers=_h(token))
        assert r.status_code == 403, f"{method} {yol} → {r.status_code}"


async def test_view_izni_okur_yazamaz(fab, client):
    sid = await fab.tedarikci()
    token = await fab.admin_token(izinler=[VIEW])

    assert (
        await client.get("/api/v1/store/admin/suppliers", headers=_h(token))
    ).status_code == 200
    assert (
        await client.get(
            f"/api/v1/store/admin/suppliers/{sid}/products", headers=_h(token)
        )
    ).status_code == 200

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"is_enabled": True, "reason": "dene"},
        headers=_h(token),
    )
    assert r.status_code == 403

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/sync",
        json={"scope": "stock"},
        headers=_h(token),
    )
    assert r.status_code == 403


async def test_manage_izni_yazabilir(fab, client):
    sid = await fab.tedarikci(is_enabled=False)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"is_enabled": True, "stock_interval_seconds": 90, "reason": "kurulum"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_enabled"] is True
    assert r.json()["stock_interval_seconds"] == 90


# ═══════════════ D-5: token at-rest ve yanıtta ═══════════════


async def test_token_veritabaninda_sifreli_durur(fab, client):
    sid = await fab.tedarikci(token=None)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"api_token": GIZLI_TOKEN, "reason": "token girildi"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as s:
        ham = (
            await s.execute(
                text("SELECT api_token FROM suppliers WHERE id = :i"), {"i": sid}
            )
        ).scalar_one()
    assert ham is not None
    assert ham != GIZLI_TOKEN, "token düz metin saklanmış (D-5)"
    assert GIZLI_TOKEN not in ham
    assert "PANELDEN" not in ham

    # Uygulama katmanı düz metni geri okuyabilmeli (roundtrip).
    from models.supplier import Supplier

    async with AsyncSessionLocal() as s:
        sup = await s.get(Supplier, sid)
        assert sup.api_token == GIZLI_TOKEN


async def test_token_hicbir_yanitta_donmez(fab, client):
    sid = await fab.tedarikci(token=GIZLI_TOKEN)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    liste = await client.get("/api/v1/store/admin/suppliers", headers=_h(token))
    patch = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"stock_interval_seconds": 45, "reason": "hizlandir"},
        headers=_h(token),
    )

    for r in (liste, patch):
        assert GIZLI_TOKEN not in r.text
        assert "PANELDEN" not in r.text

    kayit = next(x for x in liste.json() if x["id"] == sid)
    assert kayit["has_token"] is True, "panel token'ın GİRİLİ olduğunu bilmeli"


async def test_bos_token_mevcut_tokeni_silmez(fab, client):
    """Form her açıldığında token kutusu BOŞTUR (değer ön-doldurulmaz).
    Boş kutuyla kaydetmek, token'ı silmek anlamına gelmemeli — yoksa yönetici
    aralığı değiştirdiğinde senkron sessizce durur."""
    sid = await fab.tedarikci(token=GIZLI_TOKEN)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"stock_interval_seconds": 45, "reason": "yalniz aralik"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["has_token"] is True

    from models.supplier import Supplier

    async with AsyncSessionLocal() as s:
        assert (await s.get(Supplier, sid)).api_token == GIZLI_TOKEN


# ═══════════════ Doğrulama sınırları ═══════════════


async def test_alt_sinirin_altinda_aralik_reddedilir(fab, client):
    """30 saniyeden sık tarama origin'i döver (rapor §2.11: keşifte 502'ler
    gözlendi). Sınır hem şemada hem DB CHECK'inde var."""
    sid = await fab.tedarikci()
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"stock_interval_seconds": 5, "reason": "cok sik"},
        headers=_h(token),
    )
    assert r.status_code == 422


async def test_gerekce_zorunlu(fab, client):
    """`ReasonDialog` deseni: kritik ayar değişikliği audit'e gerekçesiz
    yazılamaz."""
    sid = await fab.tedarikci()
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.patch(
        f"/api/v1/store/admin/suppliers/{sid}",
        json={"is_enabled": True},
        headers=_h(token),
    )
    assert r.status_code == 422


# ═══════════════ Eşleşmemiş favoriler + elle bağlama ═══════════════


async def test_eslesmemis_favoriler_listelenir(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun()
    bagli = await fab.tedarikci_urunu(
        sid, product_id=pid, link_source="AUTO", barcode=GECERLI_BARKODLAR[0]
    )
    bagsiz = await fab.tedarikci_urunu(sid, barcode=GECERLI_BARKODLAR[1])
    token = await fab.admin_token(izinler=[VIEW])

    r = await client.get(
        f"/api/v1/store/admin/suppliers/{sid}/products",
        params={"linked": "false"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    idler = {x["id"] for x in r.json()}
    assert bagsiz in idler and bagli not in idler
    assert r.headers.get("X-Total-Count") == "1"


async def test_elle_baglama_ve_cozme_ucu(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun()
    spid = await fab.tedarikci_urunu(sid, barcode=GECERLI_BARKODLAR[1])
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/products/{spid}/link",
        json={"product_id": pid, "reason": "elle eslestirme"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["product_id"] == pid
    assert r.json()["link_source"] == "MANUAL"

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/products/{spid}/unlink",
        json={"reason": "yanlis olmus"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["product_id"] is None


async def test_baglama_gerekce_ister(fab, client):
    sid = await fab.tedarikci()
    pid = await fab.urun()
    spid = await fab.tedarikci_urunu(sid)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/products/{spid}/link",
        json={"product_id": pid},
        headers=_h(token),
    )
    assert r.status_code == 422


async def test_baska_tedarikcinin_satirina_dokunulamaz(fab, client):
    """IDOR kapısı: yol parametresindeki `supplier_id` ile satırın sahibi
    uyuşmazsa 404 — "var ama senin değil" bilgisi de sızmamalı."""
    sid_a = await fab.tedarikci(provider="yildirim")
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE suppliers SET provider = 'yildirim' WHERE id = :i"),
            {"i": sid_a},
        )
        await s.commit()
    spid = await fab.tedarikci_urunu(sid_a)
    pid = await fab.urun()
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    olmayan = sid_a + 99999
    r = await client.post(
        f"/api/v1/store/admin/suppliers/{olmayan}/products/{spid}/link",
        json={"product_id": pid, "reason": "olmaz"},
        headers=_h(token),
    )
    assert r.status_code == 404


# ═══════════════ Elle senkron ═══════════════


async def test_kapali_tedarikcide_sync_400(fab, client):
    sid = await fab.tedarikci(is_enabled=False)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/sync",
        json={"scope": "stock"},
        headers=_h(token),
    )
    assert r.status_code == 400
    assert GIZLI_TOKEN not in r.text


async def test_ag_kapaliyken_sync_503_dondurur(fab, client):
    """Test ortamında `SUPPLIER_NETWORK_DISABLED` açık; istemci ağa çıkmayı
    reddeder. Uç bunu opak 500'e değil, `Retry-After`'lı 503'e çevirmeli
    (`RoutingUnavailable` kalıbı)."""
    sid = await fab.tedarikci(is_enabled=True, token=GIZLI_TOKEN)
    token = await fab.admin_token(izinler=[VIEW, MANAGE])

    r = await client.post(
        f"/api/v1/store/admin/suppliers/{sid}/sync",
        json={"scope": "stock"},
        headers=_h(token),
    )
    assert r.status_code == 503, r.text
    assert GIZLI_TOKEN not in r.text


# ═══════════════ /health ═══════════════


async def test_health_tedarikci_durumunu_raporlar(fab, client):
    await fab.tedarikci(is_enabled=False)
    r = await client.get("/health")
    assert r.status_code in (200, 503)
    govde = r.json()
    assert "supplier_sync" in govde, "/health tedarikçi senkronunu raporlamalı"
    assert govde["supplier_sync"]["enabled"] is False
