"""Faz 3b — arama listesinde GRUP BAŞINA TEK KART (gerçek HTTP + Postgres).

En riskli parça: DISTINCT ON sıralamayla çakıştığı için gruplama
`ROW_NUMBER() OVER (PARTITION BY grup)` alt sorgusuyla yapılır ve LIMIT/OFFSET
DIŞ sorguda (grup kartları üzerinde) uygulanır.

Kanıtlanan davranışlar:
  G-1..G-6 ALTI sıralama kipinin HER BİRİNDE grup tek kart olur, temsilci
      kipe uygun üyedir ve kart doğru KONUMDA sıralanır:
        default (skor) · rating · price_asc · price_desc · newest ·
        relevance (q'lu, sort'suz)
  G-7 in_stock filtresi GRUP semantiği taşır: filtreyle eşleşen üyelerden
      herhangi biri stoktaysa grup görünür; hepsi tükenikse görünmez.
  G-8 Kart "X TL'den başlayan" verisi taşır: `group_min_price` grubun en düşük
      üye fiyatı, `variant_count` üye sayısı; tekil üründe variant_count=1.
  G-9 Sayfalama GRUP sayısına göredir ve sayfa sınırında kayma olmaz
      (sayfa2, sayfa1'i tekrarlamaz; birleşim tam kümedir).
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Product, ProductCategory, VariantGroup
from tests.integration.db_guard import purge_products


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
    """İzole vitrin: her koşum kendi KATEGORİSİNİ kurar ve aramayı ona
    daraltır — q'suz sıralama kipleri başka test verisiyle karışmaz."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.group_ids: list[int] = []
        self.category_id: int | None = None

    async def kategori(self) -> int:
        async with AsyncSessionLocal() as s:
            c = ProductCategory(slug=f"liste-test-{_u()}", name="Liste Testi")
            s.add(c)
            await s.commit()
            self.category_id = c.id
            return c.id

    async def grup(self, *, option1_name="Renk") -> int:
        async with AsyncSessionLocal() as s:
            g = VariantGroup(title=f"Grup {_u()}", option1_name=option1_name)
            s.add(g)
            await s.commit()
            self.group_ids.append(g.id)
            return g.id

    async def urun(
        self,
        *,
        price,
        stock=1,
        group_id=None,
        option1_value=None,
        rating=None,          # (sum, count)
        created_gunu=None,    # kaç gün önce (newest kipi için)
        title=None,
    ) -> int:
        u = _u()
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"liste-{u}",
                title=title or f"Liste Ürünü {u}",
                kind="PHYSICAL",
                seller_type="PLATFORM",
                price=Decimal(str(price)),
                stock=stock,
                status="ACTIVE",
                category_id=self.category_id,
                variant_group_id=group_id,
                option1_value=option1_value,
                barcode=f"869{u}" if group_id else None,
                rating_sum=rating[0] if rating else 0,
                rating_count=rating[1] if rating else 0,
            )
            s.add(p)
            await s.flush()
            if created_gunu is not None:
                await s.execute(
                    text(
                        "UPDATE products SET created_at = now() - "
                        "make_interval(days => :d) WHERE id = :i"
                    ),
                    {"d": created_gunu, "i": p.id},
                )
            await s.commit()
            self.product_ids.append(p.id)
            return p.id

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
            if self.category_id:
                await s.execute(
                    text("DELETE FROM product_categories WHERE id = :i"),
                    {"i": self.category_id},
                )
            await s.commit()


@pytest.fixture
async def fab(pg):
    f = Fab()
    await f.kategori()
    try:
        yield f
    finally:
        await f.cleanup()


async def _liste(client, fab, **params) -> list[dict]:
    r = await client.get(
        "/api/v1/store/products",
        params={"category_id": fab.category_id, **params},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _standart_vitrin(fab):
    """Grup(3 üye: 50₺ stok0 · 30₺ stok5 · 80₺ stok2) + tekil 40₺ + tekil 90₺."""
    g = await fab.grup()
    uyeler = {
        "orta": await fab.urun(price=50, stock=0, group_id=g, option1_value="Sarı",
                               rating=(50, 10), created_gunu=10),
        "ucuz": await fab.urun(price=30, stock=5, group_id=g, option1_value="Pembe",
                               rating=(10, 10), created_gunu=5),
        "pahali": await fab.urun(price=80, stock=2, group_id=g, option1_value="Mavi",
                                 rating=(30, 10), created_gunu=1),
    }
    tekil_40 = await fab.urun(price=40, stock=3, created_gunu=7, rating=(20, 10))
    tekil_90 = await fab.urun(price=90, stock=3, created_gunu=20, rating=(45, 10))
    return g, uyeler, tekil_40, tekil_90


def _grup_karti(liste: list[dict], group_id: int) -> list[dict]:
    return [p for p in liste if p.get("variant_group_id") == group_id]


# ── G-1..G-6 · Altı sıralama kipi ────────────────────────────────────────────


async def test_G1_default_skor_kipinde_grup_tek_kart(client, fab):
    g, uyeler, tekil_40, tekil_90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab)
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1, [p["id"] for p in liste]
    assert len(liste) == 3   # grup kartı + 2 tekil
    # Temsilci skor kipinde en yüksek bayesian üye: rating 5.0 (sum50/count10).
    assert kartlar[0]["id"] == uyeler["orta"]
    # Sıra: skor azalan → tekil_90(4.5) > grup(5.0)? 5.0 > 4.5 → grup önce.
    assert [p["id"] for p in liste] == [uyeler["orta"], tekil_90, tekil_40]


async def test_G2_rating_kipinde_grup_tek_kart(client, fab):
    g, uyeler, tekil_40, tekil_90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab, sort="rating")
    assert len(_grup_karti(liste, g)) == 1
    assert [p["id"] for p in liste] == [uyeler["orta"], tekil_90, tekil_40]


async def test_G3_price_asc_temsilci_en_ucuz(client, fab):
    g, uyeler, tekil_40, tekil_90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab, sort="price_asc")
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1
    assert kartlar[0]["id"] == uyeler["ucuz"]        # 30₺ temsil eder
    assert [p["id"] for p in liste] == [uyeler["ucuz"], tekil_40, tekil_90]


async def test_G4_price_desc_temsilci_en_pahali(client, fab):
    g, uyeler, tekil_40, tekil_90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab, sort="price_desc")
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1
    assert kartlar[0]["id"] == uyeler["pahali"]      # 80₺ temsil eder
    assert [p["id"] for p in liste] == [tekil_90, uyeler["pahali"], tekil_40]


async def test_G5_newest_temsilci_en_yeni(client, fab):
    g, uyeler, tekil_40, tekil_90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab, sort="newest")
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1
    assert kartlar[0]["id"] == uyeler["pahali"]      # 1 gün önce = en yeni üye
    assert [p["id"] for p in liste] == [uyeler["pahali"], tekil_40, tekil_90]


async def test_G6_relevance_q_kipinde_grup_tek_kart(client, fab):
    isaret = f"Relq{_u()}"
    g = await fab.grup()
    a = await fab.urun(price=50, stock=1, group_id=g, option1_value="Sarı",
                       title=f"{isaret} Kalem Sarı", rating=(50, 10))
    await fab.urun(price=60, stock=1, group_id=g, option1_value="Pembe",
                   title=f"{isaret} Kalem Pembe", rating=(10, 10))
    tekil = await fab.urun(price=70, stock=1, title=f"{isaret} Defter")
    liste = await _liste(client, fab, q=isaret)
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1, [p["id"] for p in liste]
    assert {p["id"] for p in liste} == {kartlar[0]["id"], tekil}
    # Skor birincil bağlayıcı: yüksek puanlı üye temsil eder.
    assert kartlar[0]["id"] == a


# ── G-7 · in_stock grup semantiği ────────────────────────────────────────────


async def test_G7_in_stock_grubun_herhangi_bir_uyesi_stokta(client, fab):
    g, uyeler, _t40, _t90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab, in_stock=True)
    # "orta" üye (temsilci adayı) stok 0 ama kardeşleri stokta → grup GÖRÜNÜR
    # ve kartın stok durumu GRUBUN durumudur ("Tükendi" basılamaz).
    kartlar = _grup_karti(liste, g)
    assert len(kartlar) == 1
    assert kartlar[0]["in_stock"] is True

    # Tüm üyeleri tüketince grup kaybolmalı.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET stock = 0 WHERE variant_group_id = :g"),
            {"g": g},
        )
        await s.commit()
    liste = await _liste(client, fab, in_stock=True)
    assert _grup_karti(liste, g) == []


# ── G-8 · "X TL'den başlayan" ───────────────────────────────────────────────


async def test_G8_kart_baslayan_fiyat_ve_uye_sayisi_tasir(client, fab):
    g, _uyeler, tekil_40, _t90 = await _standart_vitrin(fab)
    liste = await _liste(client, fab)
    kart = _grup_karti(liste, g)[0]
    assert kart["variant_count"] == 3
    assert Decimal(str(kart["group_min_price"])) == Decimal("30.00")
    tekil = next(p for p in liste if p["id"] == tekil_40)
    assert tekil["variant_count"] == 1


# ── G-9 · Sayfalama grup sayısına göre, sınırda kayma yok ────────────────────


async def test_G9_sayfalama_grup_bazli_ve_kaymasiz(client, fab):
    """4 kart (2 grup + 2 tekil), limit=2: iki sayfanın birleşimi tam küme,
    kesişimi boş — grup üyeleri sayfa sınırında karta bölünüp tekrarlamaz."""
    g1 = await fab.grup()
    await fab.urun(price=10, group_id=g1, option1_value="Sarı")
    await fab.urun(price=12, group_id=g1, option1_value="Pembe")
    g2 = await fab.grup()
    await fab.urun(price=20, group_id=g2, option1_value="Sarı")
    await fab.urun(price=22, group_id=g2, option1_value="Mavi")
    await fab.urun(price=15)
    await fab.urun(price=25)

    sayfa1 = await _liste(client, fab, sort="price_asc", limit=2, offset=0)
    sayfa2 = await _liste(client, fab, sort="price_asc", limit=2, offset=2)
    sayfa3 = await _liste(client, fab, sort="price_asc", limit=2, offset=4)
    assert len(sayfa1) == 2 and len(sayfa2) == 2
    assert sayfa3 == []                      # 4 kart var, 3. sayfa boş
    ids1 = {p["id"] for p in sayfa1}
    ids2 = {p["id"] for p in sayfa2}
    assert not (ids1 & ids2), "sayfa sınırında tekrar var"
    assert len(ids1 | ids2) == 4
    # Fiyat sırası sayfalar ARASINDA da korunur: 10, 15 | 20, 25.
    fiyatlar = [Decimal(str(p["price"])) for p in sayfa1 + sayfa2]
    assert fiyatlar == sorted(fiyatlar)
