"""Puck nesli uçtan uca — gerçek PostgreSQL (CMS Faz 2).

Sözleşme: puck_data kanonik, blok satırları sunucuda türetilir; publish ve
public okuma Puck'tan habersiz çalışır. Görselli bloklar medya önekine bağlı
olduğundan senaryolar metin bloğuyla kurulur (vitrin_factory notuyla aynı
gerekçe).
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.anyio

YÖNET = ["content.view", "content.manage"]


def puck_veri(*icerik) -> dict:
    return {"root": {"props": {}}, "content": list(icerik), "zones": {}}


def metin(block_key: str | None = None, icerik: str = "puck metni") -> dict:
    props = {"title": "Puck Bölümü", "content": icerik}
    if block_key:
        props["block_key"] = block_key
    return {"type": "RichText", "props": props}


async def _taslak_kaydet(http, h, sayfa_id: int, veri: dict):
    return await http.put(
        f"/api/v1/admin/store-merchandising/pages/{sayfa_id}/draft",
        headers=h,
        json={"title": "Puck", "seo_title": "Puck", "seo_description": "", "puck_data": veri},
    )


async def test_puck_taslagi_blok_satirlarini_turetir(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)

    r = await _taslak_kaydet(http, h, s.id, puck_veri(metin()))
    assert r.status_code == 200, r.text
    govde = r.json()
    # puck_data normalize edilip GERİ döner; sunucu block_key üretmiştir.
    key = govde["puck_data"]["content"][0]["props"]["block_key"]
    assert key
    # Blok satırı TÜRETİLMİŞ ve aynı anahtarı taşıyor.
    assert [b["block_key"] for b in govde["blocks"] if b["is_active"]] == [key]
    assert govde["blocks"][0]["block_type"] == "RICH_TEXT"
    assert govde["blocks"][0]["config"]["content"] == "puck metni"


async def test_puck_taslagi_yayinlanir_ve_publicte_gorunur(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await _taslak_kaydet(http, h, s.id, puck_veri(metin(icerik="yayında görünen metin")))
    assert r.status_code == 200, r.text
    taslak = r.json()

    yayin = await http.post(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/publish",
        headers=h,
        json={"starts_at": "2020-01-01T00:00:00+00:00"},
    )
    assert yayin.status_code == 200, yayin.text

    public = await http.get(f"/api/v1/store/pages/{s.slug}")
    assert public.status_code == 200, public.text
    bloklar = public.json()["revision"]["blocks"]
    assert any(b["config"].get("content") == "yayında görünen metin" for b in bloklar)
    # Metrik anahtarı puck_data ile blok satırında AYNI.
    assert public.json()["revision"]["puck_data"]["content"][0]["props"]["block_key"] in {
        b["block_key"] for b in bloklar
    }


async def test_blocks_gonderimi_puck_verisini_dusurur(fabv, http):
    """Çatallanma kuralı: son yazan kazanır — eski istemci blocks yazarsa
    taslak Puck nesli olmaktan çıkar."""
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await _taslak_kaydet(http, h, s.id, puck_veri(metin()))
    assert r.json()["puck_data"] is not None

    r = await http.put(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/draft",
        headers=h,
        json={
            "title": "Form", "seo_title": "Form", "seo_description": "",
            "blocks": [fabv.metin_blogu("Form bloğu")],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["puck_data"] is None


async def test_puck_ve_blocks_birlikte_422(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await http.put(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/draft",
        headers=h,
        json={
            "title": "X", "seo_title": "X", "seo_description": "",
            "blocks": [fabv.metin_blogu("a")],
            "puck_data": puck_veri(metin()),
        },
    )
    assert r.status_code == 422


async def test_bilinmeyen_puck_tipi_422(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await _taslak_kaydet(
        http, h, s.id,
        puck_veri({"type": "Bilinmeyen", "props": {"block_key": "x"}}),
    )
    assert r.status_code == 422
    assert "Bilinmeyen blok tipi" in r.text


async def test_zengin_metin_sanitize_edilip_publicte_gorunur(fabv, http):
    """XSS sınırı uçtan uca: script/onerror kaydedilmeden atılır, hizalama kalır."""
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)

    kirli = (
        '<p style="text-align: center">Ortalı <strong>metin</strong></p>'
        '<script>alert(1)</script><p style="color:red" onclick="x()">düz</p>'
    )
    r = await _taslak_kaydet(http, h, s.id, puck_veri({
        "type": "RichText",
        "props": {"title": "Zengin", "content_html": kirli},
    }))
    assert r.status_code == 200, r.text
    kayitli = r.json()["blocks"][0]["config"]["content_html"]
    assert "<script" not in kayitli and "onclick" not in kayitli and "color:red" not in kayitli
    assert 'style="text-align: center"' in kayitli
    assert "<strong>metin</strong>" in kayitli

    yayin = await http.post(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/publish",
        headers=h, json={"starts_at": "2020-01-01T00:00:00+00:00"},
    )
    assert yayin.status_code == 200, yayin.text
    public = await http.get(f"/api/v1/store/pages/{s.slug}")
    blok = public.json()["revision"]["blocks"][0]
    assert blok["config"]["content_html"] == kayitli


async def test_gecersiz_gorunum_422(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await _taslak_kaydet(http, h, s.id, puck_veri({
        "type": "RichText",
        "props": {"content_html": "<p>a</p>", "gorunum": {"zemin": "mor"}},
    }))
    assert r.status_code == 422
    assert "geçersiz değer" in r.text
