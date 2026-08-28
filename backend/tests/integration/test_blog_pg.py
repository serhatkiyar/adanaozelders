"""Blog yaşam döngüsü — gerçek PostgreSQL + gerçek izin satırları.

Kapsam: taslak public'te görünmez; yayın akışı; slug değişiminde redirect;
sanitizasyonun HTTP yolundan da çalıştığı; `content.*` izin ayrımı.
Fabrika `vitrin_factory.fabv`'dir: admin + rol + izin satırları gerçek,
dependency override yok.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal

pytestmark = pytest.mark.anyio

YÖNET = ["content.view", "content.manage"]

_TEMIZLE = (
    "DELETE FROM blog_post_redirects WHERE post_id IN "
    "(SELECT id FROM blog_posts WHERE slug LIKE 'blogtest-%')",
    "DELETE FROM blog_posts WHERE slug LIKE 'blogtest-%'",
)


@pytest.fixture(autouse=True)
async def _blog_temizlik():
    yield
    async with AsyncSessionLocal() as s:
        for stmt in _TEMIZLE:
            await s.execute(text(stmt))
        await s.commit()


async def _yazi(http, headers, *, baslik="Blog Testi", slug=None) -> dict:
    from tests.integration.vitrin_factory import uniq

    r = await http.post(
        "/api/v1/admin/blog/posts",
        headers=headers,
        json={
            "title": baslik,
            "slug": slug or f"blogtest-{uniq()}",
            "excerpt": "özet",
            "body_html": "<p>gövde</p>",
            "seo_title": "seo",
            "seo_description": "açıklama",
            "tags": ["tyt"],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_taslak_publicte_gorunmez(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    yazi = await _yazi(http, h)

    r = await http.get(f"/api/v1/blog/posts/{yazi['slug']}")
    assert r.status_code == 404

    liste = await http.get("/api/v1/blog/posts")
    assert liste.status_code == 200
    assert yazi["slug"] not in [i["slug"] for i in liste.json()["items"]]


async def test_yayin_akisi_ve_liste(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    yazi = await _yazi(http, h)

    r = await http.post(f"/api/v1/admin/blog/posts/{yazi['id']}/publish", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PUBLISHED"
    assert r.json()["published_at"] is not None

    detay = await http.get(f"/api/v1/blog/posts/{yazi['slug']}")
    assert detay.status_code == 200
    assert detay.json()["body_html"] == "<p>gövde</p>"
    assert "max-age" in detay.headers.get("cache-control", "")

    liste = await http.get("/api/v1/blog/posts")
    assert yazi["slug"] in [i["slug"] for i in liste.json()["items"]]


async def test_slug_degisince_eski_link_redirect_verir(fabv, http):
    from tests.integration.vitrin_factory import uniq

    _, h = await fabv.admin(izinler=YÖNET)
    yazi = await _yazi(http, h)
    await http.post(f"/api/v1/admin/blog/posts/{yazi['id']}/publish", headers=h)

    yeni_slug = f"blogtest-yeni-{uniq()}"
    r = await http.put(
        f"/api/v1/admin/blog/posts/{yazi['id']}",
        headers=h,
        json={"title": yazi["title"], "slug": yeni_slug, "body_html": "<p>gövde</p>"},
    )
    assert r.status_code == 200, r.text

    eski = await http.get(f"/api/v1/blog/posts/{yazi['slug']}")
    assert eski.status_code == 404
    assert eski.json()["detail"]["redirect_slug"] == yeni_slug

    assert (await http.get(f"/api/v1/blog/posts/{yeni_slug}")).status_code == 200


async def test_sanitizasyon_http_yolundan_calisir(fabv, http):
    """XSS sınırı uçtan uca: script kaydedilmeden atılır."""
    from tests.integration.vitrin_factory import uniq

    _, h = await fabv.admin(izinler=YÖNET)
    r = await http.post(
        "/api/v1/admin/blog/posts",
        headers=h,
        json={
            "title": "XSS",
            "slug": f"blogtest-{uniq()}",
            "body_html": '<p>a</p><script>alert(1)</script><img src=x onerror=y>',
        },
    )
    assert r.status_code == 201, r.text
    assert "<script" not in r.json()["body_html"]
    assert "onerror" not in r.json()["body_html"]


async def test_bos_govde_yayimlanamaz(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    from tests.integration.vitrin_factory import uniq

    r = await http.post(
        "/api/v1/admin/blog/posts",
        headers=h,
        json={"title": "Boş", "slug": f"blogtest-{uniq()}"},
    )
    yazi = r.json()
    r = await http.post(f"/api/v1/admin/blog/posts/{yazi['id']}/publish", headers=h)
    assert r.status_code == 409


async def test_icerik_izni_olmayan_admin_403(fabv, http):
    _, yetkili = await fabv.admin(izinler=YÖNET)
    yazi = await _yazi(http, yetkili)

    _, uruncu = await fabv.admin(izinler=["products.view", "products.manage"])
    assert (
        await http.get("/api/v1/admin/blog/posts", headers=uruncu)
    ).status_code == 403
    assert (
        await http.post(f"/api/v1/admin/blog/posts/{yazi['id']}/publish", headers=uruncu)
    ).status_code == 403

    _, okur = await fabv.admin(izinler=["content.view"])
    assert (await http.get("/api/v1/admin/blog/posts", headers=okur)).status_code == 200
    assert (
        await http.post(f"/api/v1/admin/blog/posts/{yazi['id']}/publish", headers=okur)
    ).status_code == 403
