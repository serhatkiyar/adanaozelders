"""Faz 3a — public varyant yüzeyi: detayda kardeş seçici verisi + eksen facet'i.

GERÇEK HTTP (anonim public uçlar) + GERÇEK Postgres.

Kanıtlanan davranışlar:
  D-1 Ürün detayı `variants` bloğu döner: grup başlığı + eksen ADLARI
      (option1_name/option2_name) + üyeler variant_sort sırasıyla.
  D-2 Tükenen kardeş listede KALIR ama `in_stock=false` işaretlidir.
  D-3 Public listede görünmeyecek kardeş (HIDDEN/soft-delete) seçicide de yok.
  D-4 Grupsuz üründe `variants` null — mevcut detay davranışı birebir.
  F-1 Facet'ler eksen ADINA göre gruplanır: farklı grupların "Renk" değerleri
      tek kutuda toplanır, "Ebat" değerleriyle KARIŞMAZ (ham option1/option2
      kolon listesi bilinçli olarak YOK).
  F-2 `variant=Eksen:Değer` filtresi yalnız o değeri taşıyan üyeleri döndürür;
      option2 ekseni de aynı parametreyle filtrelenir; eksenler arası AND.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Product, VariantGroup
from tests.integration.db_guard import purge_products
from tests.integration.product_category import integration_product_category_id


def _u() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Fab:
    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.group_ids: list[int] = []

    async def grup(self, *, title=None, option1_name="Renk", option2_name=None) -> int:
        async with AsyncSessionLocal() as s:
            g = VariantGroup(
                title=title or f"Grup {_u()}",
                option1_name=option1_name,
                option2_name=option2_name,
            )
            s.add(g)
            await s.commit()
            self.group_ids.append(g.id)
            return g.id

    async def urun(self, **kw) -> Product:
        u = _u()
        varsayilan = dict(
            slug=f"pub-varyant-{u}",
            title=f"Public Varyant {u}",
            kind="PHYSICAL",
            seller_type="PLATFORM",
            price=100,
            stock=0,
            status="ACTIVE",
        )
        varsayilan.update(kw)
        async with AsyncSessionLocal() as s:
            varsayilan.setdefault(
                "category_id", await integration_product_category_id(s)
            )
            p = Product(**varsayilan)
            s.add(p)
            await s.commit()
            self.product_ids.append(p.id)
            # Yanıtta gerekebilecek alanlar için taze kopya döndür.
            await s.refresh(p)
            s.expunge(p)
            return p

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.product_ids:
                await purge_products(s, self.product_ids)
        async with AsyncSessionLocal() as s:
            if self.group_ids:
                await s.execute(
                    text("DELETE FROM variant_groups WHERE id = ANY(:i)"),
                    {"i": self.group_ids},
                )
                await s.commit()


@pytest.fixture
async def fab(pg):
    f = Fab()
    try:
        yield f
    finally:
        await f.cleanup()


async def _uc_uyeli_grup(fab, *, option2_name=None):
    """Sarı(stok 5, sıra 0) · Pembe(stok 0, sıra 1) · Mavi(HIDDEN, sıra 2)."""
    g = await fab.grup(title=f"Fosforlu {_u()}", option2_name=option2_name)
    o2 = {"option2_value": "A4"} if option2_name else {}
    sari = await fab.urun(
        variant_group_id=g, option1_value="Sarı", variant_sort=0,
        barcode=f"869{_u()}", stock=5, **o2,
    )
    pembe = await fab.urun(
        variant_group_id=g, option1_value="Pembe", variant_sort=1,
        barcode=f"869{_u()}", stock=0,
        **({"option2_value": "A5"} if option2_name else {}),
    )
    gizli = await fab.urun(
        variant_group_id=g, option1_value="Mavi", variant_sort=2,
        barcode=f"869{_u()}", stock=3, status="HIDDEN",
        **({"option2_value": "A6"} if option2_name else {}),
    )
    return g, sari, pembe, gizli


# ── D · Detayda kardeş seçici verisi ─────────────────────────────────────────


async def test_detay_variants_blogu_eksen_adlari_ve_sirali_uyeler(client, fab):
    g, sari, pembe, _gizli = await _uc_uyeli_grup(fab)
    r = await client.get(f"/api/v1/store/products/{sari.slug}")
    assert r.status_code == 200, r.text
    v = r.json()["variants"]
    assert v is not None
    assert v["group_id"] == g
    assert v["option1_name"] == "Renk"
    assert v["option2_name"] is None
    adlar = [(m["option1_value"], m["variant_sort"]) for m in v["members"]]
    assert adlar == [("Sarı", 0), ("Pembe", 1)]   # variant_sort sırası, HIDDEN yok
    # Seçici navigasyonu slug ile yapar; her üye slug taşımalı.
    assert all(m["slug"] for m in v["members"])


async def test_tukenen_kardes_listede_ama_tukendi_isaretli(client, fab):
    _g, sari, _pembe, _gizli = await _uc_uyeli_grup(fab)
    r = await client.get(f"/api/v1/store/products/{sari.slug}")
    uyeler = {m["option1_value"]: m for m in r.json()["variants"]["members"]}
    assert uyeler["Sarı"]["in_stock"] is True
    assert uyeler["Pembe"]["in_stock"] is False   # listede AMA tükendi


async def test_gizli_ve_silinmis_kardes_secicide_yok(client, fab):
    g, sari, pembe, gizli = await _uc_uyeli_grup(fab)
    # Pembe'yi soft-delete et: seçiciden düşmeli (Mavi zaten HIDDEN).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET deleted_at = now() WHERE id = :i"),
            {"i": pembe.id},
        )
        await s.commit()
    r = await client.get(f"/api/v1/store/products/{sari.slug}")
    adlar = [m["option1_value"] for m in r.json()["variants"]["members"]]
    assert adlar == ["Sarı"]


async def test_grupsuz_urunde_variants_null(client, fab):
    p = await fab.urun()
    r = await client.get(f"/api/v1/store/products/{p.slug}")
    assert r.status_code == 200
    assert r.json()["variants"] is None


async def test_iki_eksenli_grupta_eksen_adlari_ve_degerleri(client, fab):
    _g, sari, _pembe, _gizli = await _uc_uyeli_grup(fab, option2_name="Ebat")
    v = (await client.get(f"/api/v1/store/products/{sari.slug}")).json()["variants"]
    assert v["option2_name"] == "Ebat"
    assert [(m["option1_value"], m["option2_value"]) for m in v["members"]] == [
        ("Sarı", "A4"), ("Pembe", "A5"),
    ]


# ── F · Eksen facet'i ve filtresi ────────────────────────────────────────────


async def test_facet_eksen_adina_gore_gruplanir_degerler_karismaz(client, fab):
    """İki AYRI grubun 'Renk' değerleri tek kutuda; 'Ebat' değerleri ayrı
    kutuda — ham option1_value listesi olsaydı Kırmızı ile A4 karışırdı."""
    g1 = await fab.grup(option1_name="Renk")
    g2 = await fab.grup(option1_name="Renk")
    g3 = await fab.grup(option1_name="Ebat")
    isaret = f"Facet{_u()}"   # bu koşumun satırlarını facet sayımında ayırt eder
    await fab.urun(variant_group_id=g1, option1_value=f"Sarı-{isaret}",
                   barcode=f"869{_u()}", stock=1)
    await fab.urun(variant_group_id=g2, option1_value=f"Sarı-{isaret}",
                   barcode=f"869{_u()}", stock=1)
    await fab.urun(variant_group_id=g3, option1_value=f"A4-{isaret}",
                   barcode=f"869{_u()}", stock=1)

    r = await client.get("/api/v1/store/book-facets")
    assert r.status_code == 200, r.text
    axes = r.json()["variant_axes"]
    renk = {o["value"]: o["count"] for o in axes.get("Renk", [])}
    ebat = {o["value"]: o["count"] for o in axes.get("Ebat", [])}
    # İki grubun aynı değeri TEK satırda toplanır…
    assert renk.get(f"Sarı-{isaret}") == 2
    # …ve Ebat değeri Renk kutusuna sızmaz (facet karışması).
    assert f"A4-{isaret}" not in renk
    assert ebat.get(f"A4-{isaret}") == 1


async def test_variant_filtresi_yalniz_o_degeri_dondurur(client, fab):
    g = await fab.grup(option1_name="Renk")
    isaret = f"Filtre{_u()}"
    sari = await fab.urun(
        title=f"{isaret} Sarı", variant_group_id=g,
        option1_value=f"Sarı-{isaret}", barcode=f"869{_u()}", stock=1,
    )
    await fab.urun(
        title=f"{isaret} Pembe", variant_group_id=g,
        option1_value=f"Pembe-{isaret}", barcode=f"869{_u()}", stock=1,
    )
    r = await client.get(
        "/api/v1/store/products",
        params={"q": isaret, "variant": [f"Renk:Sarı-{isaret}"]},
    )
    assert r.status_code == 200, r.text
    ids = [p["id"] for p in r.json()]
    assert ids == [sari.id]


async def test_variant_filtresi_option2_eksenini_de_kapsar(client, fab):
    g = await fab.grup(option1_name="Renk", option2_name="Ebat")
    isaret = f"Ikinci{_u()}"
    a4 = await fab.urun(
        title=f"{isaret} A4", variant_group_id=g,
        option1_value="Sarı", option2_value=f"A4-{isaret}",
        barcode=f"869{_u()}", stock=1,
    )
    await fab.urun(
        title=f"{isaret} A5", variant_group_id=g,
        option1_value="Sarı", option2_value=f"A5-{isaret}",
        barcode=f"869{_u()}", stock=1,
    )
    r = await client.get(
        "/api/v1/store/products",
        params={"q": isaret, "variant": [f"Ebat:A4-{isaret}"]},
    )
    ids = [p["id"] for p in r.json()]
    assert ids == [a4.id]


async def test_ayni_deger_iki_eksende_eksen_adi_ayirt_eder(client, fab):
    """Bağımsız denetim P2-6(b): önceki fixture'larda değerler eksene özgü
    benzersizdi — filtre eksen adını YOK SAYSA da testler yeşil kalıyordu.
    Bu test aynı değeri iki farklı eksende taşır: "Renk:Sarı" filtresi Ebat
    ekseninde "Sarı" taşıyan ürünü GETİRMEMELİ."""
    isaret = f"Capraz{_u()}"
    deger = f"Sarı-{isaret}"          # AYNI değer, iki ayrı eksende
    g_renk = await fab.grup(option1_name="Renk")
    g_ebat = await fab.grup(option1_name="Ebat")
    hedef = await fab.urun(
        title=f"{isaret} renkli", variant_group_id=g_renk,
        option1_value=deger, barcode=f"869{_u()}", stock=1,
    )
    await fab.urun(
        title=f"{isaret} ebatli", variant_group_id=g_ebat,
        option1_value=deger, barcode=f"869{_u()}", stock=1,
    )
    r = await client.get(
        "/api/v1/store/products",
        params={"q": isaret, "variant": [f"Renk:{deger}"]},
    )
    assert r.status_code == 200, r.text
    ids = [p["id"] for p in r.json()]
    assert ids == [hedef.id], "eksen adı yok sayılıyor — Ebat:Sarı da geldi"


async def test_bicimsiz_variant_parametresi_400(client, fab):
    """P2-6(d) HTTP kolu: 'Eksen:Değer' biçiminde olmayan filtre SESSİZCE
    yutulmaz — 400 döner (yutulsaydı 'filtre yok' gibi tüm katalog dönerdi)."""
    for bozuk in ("bozuk", ":deger", "Renk:", "  :  "):
        r = await client.get(
            "/api/v1/store/products", params={"variant": [bozuk]}
        )
        assert r.status_code == 400, (bozuk, r.status_code, r.text)
        assert "Eksen:Değer" in r.json()["detail"]


async def test_variant_filtresi_eksenler_arasi_AND(client, fab):
    g = await fab.grup(option1_name="Renk", option2_name="Ebat")
    isaret = f"VeBagi{_u()}"
    hedef = await fab.urun(
        title=f"{isaret} hedef", variant_group_id=g,
        option1_value=f"Sarı-{isaret}", option2_value=f"A4-{isaret}",
        barcode=f"869{_u()}", stock=1,
    )
    await fab.urun(
        title=f"{isaret} sapan", variant_group_id=g,
        option1_value=f"Sarı-{isaret}", option2_value=f"A5-{isaret}",
        barcode=f"869{_u()}", stock=1,
    )
    r = await client.get(
        "/api/v1/store/products",
        params={
            "q": isaret,
            "variant": [f"Renk:Sarı-{isaret}", f"Ebat:A4-{isaret}"],
        },
    )
    ids = [p["id"] for p in r.json()]
    assert ids == [hedef.id]
