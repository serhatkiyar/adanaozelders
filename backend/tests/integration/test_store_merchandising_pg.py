"""Öznitelik/medya uçları — gerçek PostgreSQL (manuel vitrin sonrası yüzey).

Landing/koleksiyon akışları söküldü; kalan sözleşme: öznitelik CRUD'u
`products.*` ile, medya listesi `content.*` ile korunur ve izin ayrımı
gerçek rol satırlarıyla ölçülür (fabrika: vitrin_factory.fabv).
"""
from __future__ import annotations


from tests.integration.vitrin_factory import uniq

# anyio işareti kaldırıldı (26 Eyl 2026): suite pytest-asyncio (asyncio_mode=auto)
# döngüsüyle koşuyor; anyio kendi döngüsünü açınca paylaşılan asyncpg havuzu
# "attached to a different loop" hatası veriyordu (CI).


async def test_oznitelik_crud_ve_public_liste(fabv, http):
    _, h = await fabv.admin(izinler=["products.view", "products.manage"])

    r = await http.post(
        "/api/v1/admin/store-merchandising/attributes",
        headers=h, json={"name": f"Cilt {uniq()}", "sort_order": 0, "is_active": True},
    )
    assert r.status_code == 201, r.text
    tanim = r.json()

    r = await http.post(
        f"/api/v1/admin/store-merchandising/attributes/{tanim['id']}/values",
        headers=h, json={"label": "Ciltli", "sort_order": 0, "is_active": True},
    )
    assert r.status_code == 201, r.text

    public = await http.get("/api/v1/store/attributes")
    assert public.status_code == 200
    adlar = {d["name"] for d in public.json()}
    assert tanim["name"] in adlar

    fabv.attribute_ids.append(tanim["id"])


async def test_izin_ayrimi(fabv, http):
    """Öznitelik yazımı products.manage ister; medya listesi content.view ister."""
    _, uruncu = await fabv.admin(izinler=["products.view", "products.manage"])
    _, icerikci = await fabv.admin(izinler=["content.view", "content.manage"])

    # İçerikçi öznitelik YAZAMAZ.
    r = await http.post(
        "/api/v1/admin/store-merchandising/attributes",
        headers=icerikci, json={"name": f"X {uniq()}", "sort_order": 0, "is_active": True},
    )
    assert r.status_code == 403

    # Ürüncü medya listesini GÖREMEZ; içerikçi görür.
    assert (await http.get("/api/v1/admin/store-merchandising/media", headers=uruncu)).status_code == 403
    assert (await http.get("/api/v1/admin/store-merchandising/media", headers=icerikci)).status_code == 200


async def test_oturumsuz_admin_uclari_401(http):
    assert (await http.get("/api/v1/admin/store-merchandising/attributes")).status_code == 401
    assert (await http.get("/api/v1/admin/store-merchandising/media")).status_code == 401
