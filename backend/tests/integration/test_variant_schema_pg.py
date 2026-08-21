"""Varyant grubu veri modeli (Faz 1) — GERÇEK Postgres kısıt davranışı.

Bu testler `variant_groups` tablosunun ve `products` üzerindeki dört CHECK +
kısmi unique index'in **veritabanı seviyesinde** gerçekten nöbet tuttuğunu
kanıtlar. ORM/servis doğrulaması yeterli değildir: toplu içe aktarma, seed ve
ham SQL yazıcıları servis katmanını görmez — son savunma şemadadır.

Kısıtlar (kök CLAUDE.md D maddesi gereği her biri mutasyon provalıdır):
  1. `ck_products_variant_barcode`   — gruplu üründe barkod zorunlu
  2. `ck_products_variant_opt1`      — gruplu üründe 1. eksen değeri zorunlu
  3. `ck_products_variant_opt2`      — 2. eksen değeri 1.'siz olamaz
  4. `ck_products_variant_orphan`    — grupsuz üründe option değeri olamaz
  +  `uq_products_variant_combo`     — aynı kombinasyon iki kez yazılamaz
                                       (NULLS NOT DISTINCT: tek eksenli grupta
                                       option2=NULL çifti de yakalanır)

Koşum (tek kullanımlık test DB — conftest oluşturur + migrate eder):
    $env:POSTGRES_DB='adana_varyant_test'; ...
    python -m pytest tests/integration/test_variant_schema_pg.py -q
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import exc as sa_exc
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Product, VariantGroup
from tests.integration.db_guard import purge_products


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class VaryantFabrika:
    """Test verisi üretir ve kaydını tutar; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.group_ids: list[int] = []

    async def grup(self, s, *, option1_name="Renk", option2_name=None) -> VariantGroup:
        g = VariantGroup(
            title=f"Test Grup {_uniq()}",
            option1_name=option1_name,
            option2_name=option2_name,
        )
        s.add(g)
        await s.flush()
        self.group_ids.append(g.id)
        return g

    def urun(self, **kw) -> Product:
        u = _uniq()
        varsayilan = dict(
            slug=f"varyant-test-{u}",
            title=f"Varyant Test Ürünü {u}",
            kind="PHYSICAL",
            seller_type="PLATFORM",
            price=100,
            stock=0,
        )
        varsayilan.update(kw)
        return Product(**varsayilan)

    async def ekle(self, s, **kw) -> Product:
        p = self.urun(**kw)
        s.add(p)
        await s.flush()
        self.product_ids.append(p.id)
        return p

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.product_ids:
                await purge_products(s, self.product_ids)
            if self.group_ids:
                await s.execute(
                    text("DELETE FROM variant_groups WHERE id = ANY(:i)"),
                    {"i": self.group_ids},
                )
                await s.commit()


@pytest.fixture
async def vf(pg):
    f = VaryantFabrika()
    yield f
    await f.cleanup()


async def _ihlal_bekle(coro):
    """Verilen DB işleminin IntegrityError ile reddedilmesini bekler."""
    with pytest.raises(sa_exc.IntegrityError) as ei:
        await coro
    return str(ei.value)


# ── 1. Gruplu üründe barkod zorunlu ──────────────────────────────────────────


async def test_gruplu_urun_barkodsuz_yazilamaz(vf):
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s)
        p = vf.urun(
            variant_group_id=g.id, option1_value="Kırmızı", barcode=None
        )
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "ck_products_variant_barcode" in mesaj
        await s.rollback()
    # Grup flush'ı rollback'e gitti; kayıt listesinden düş.
    vf.group_ids.clear()


async def test_gruplu_urun_barkodla_yazilir(vf):
    """Pozitif kontrol: kısıt doğru şeyi de reddetmesin."""
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s)
        p = await vf.ekle(
            s, variant_group_id=g.id, option1_value="Kırmızı", barcode=f"869{_uniq()}"
        )
        await s.commit()
        assert p.id


# ── 2. Gruplu üründe 1. eksen değeri zorunlu ─────────────────────────────────


async def test_gruplu_urun_eksen_degersiz_yazilamaz(vf):
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s)
        p = vf.urun(
            variant_group_id=g.id, option1_value=None, barcode=f"869{_uniq()}"
        )
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "ck_products_variant_opt1" in mesaj
        await s.rollback()
    vf.group_ids.clear()


# ── 3. 2. eksen değeri 1.'siz olamaz ─────────────────────────────────────────


async def test_ikinci_eksen_birincisiz_yazilamaz(vf):
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s, option1_name="Renk", option2_name="Ebat")
        p = vf.urun(
            variant_group_id=g.id,
            option1_value=None,
            option2_value="A4",
            barcode=f"869{_uniq()}",
        )
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        # opt1 kısıtından da düşebilir; asıl aranan opt2'nin kapısı. İki kısıt
        # bağımsız nöbet tutar — mutasyon provası opt2'yi tek başına sınar
        # (opt1 kaldırıldığında bu satırı yalnız opt2 reddedebilir).
        assert (
            "ck_products_variant_opt2" in mesaj
            or "ck_products_variant_opt1" in mesaj
        )
        await s.rollback()
    vf.group_ids.clear()


async def test_ikinci_eksen_gruptan_bagimsiz_birincisiz_yazilamaz(vf):
    """Grupsuz üründe bile option2, option1'siz duramaz (kısıt bağımsız)."""
    async with AsyncSessionLocal() as s:
        p = vf.urun(option1_value=None, option2_value="A4")
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "ck_products_variant" in mesaj   # opt2 veya orphan — ikisi de doğru kapı
        await s.rollback()


# ── 4. Grupsuz üründe option değeri olamaz ───────────────────────────────────


async def test_grupsuz_urun_option_degeri_tasiyamaz(vf):
    async with AsyncSessionLocal() as s:
        p = vf.urun(variant_group_id=None, option1_value="Kırmızı")
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "ck_products_variant_orphan" in mesaj
        await s.rollback()


# ── Kombinasyon tekilliği ────────────────────────────────────────────────────


async def test_ayni_kombinasyon_iki_kez_yazilamaz(vf):
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s, option1_name="Renk", option2_name="Ebat")
        await vf.ekle(
            s,
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value="A4",
            barcode=f"869{_uniq()}",
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        p = vf.urun(
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value="A4",
            barcode=f"869{_uniq()}",
        )
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "uq_products_variant_combo" in mesaj
        await s.rollback()


async def test_tek_eksenli_grupta_null_option2_cifti_de_yakalanir(vf):
    """NULLS NOT DISTINCT provası: option2=NULL iki satırda 'farklı' sayılmaz.

    PG varsayılanında unique index NULL'ları birbirinden farklı sayar — o
    varsayılanla tek eksenli grupta aynı renk iki kez yazılabilirdi ve tekillik
    yalnız iki eksenli gruplarda çalışıyor görünürdü (sinsi çünkü testlerin
    çoğu iki eksenli örnek kurar).
    """
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s, option1_name="Renk")
        await vf.ekle(
            s,
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value=None,
            barcode=f"869{_uniq()}",
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        p = vf.urun(
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value=None,
            barcode=f"869{_uniq()}",
        )
        s.add(p)
        mesaj = await _ihlal_bekle(s.commit())
        assert "uq_products_variant_combo" in mesaj
        await s.rollback()


async def test_farkli_kombinasyon_yazilir(vf):
    """Pozitif kontrol: tekillik farklı kombinasyonu engellemez."""
    async with AsyncSessionLocal() as s:
        g = await vf.grup(s, option1_name="Renk", option2_name="Ebat")
        await vf.ekle(
            s,
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value="A4",
            barcode=f"869{_uniq()}",
        )
        await vf.ekle(
            s,
            variant_group_id=g.id,
            option1_value="Kırmızı",
            option2_value="A5",
            barcode=f"869{_uniq()}",
        )
        await s.commit()


# ── Eksen adı kontrollü sözlükten gelmek zorunda ─────────────────────────────


async def test_eksen_adi_sozluk_disi_reddedilir(vf):
    """Serbest metin eksen adı DB'ye giremez (facet karışması kapısı)."""
    async with AsyncSessionLocal() as s:
        g = VariantGroup(title="Kaçak", option1_name="Koku")
        s.add(g)
        mesaj = await _ihlal_bekle(s.commit())
        assert "ck_variant_groups_opt1_axis" in mesaj
        await s.rollback()


# ── Mevcut ürünler etkilenmez ────────────────────────────────────────────────


async def test_yeni_sade_urun_varyant_alanlari_bos_dogar(vf):
    """Varyant kolonları eklenmiş şemada gruba bağlanmamış ürün NULL taşır —
    mevcut ürün CRUD'u varyant modelinden habersiz çalışmaya devam eder."""
    async with AsyncSessionLocal() as s:
        p = await vf.ekle(s)
        await s.commit()
        satir = (
            await s.execute(
                text(
                    "SELECT variant_group_id, option1_value, option2_value, "
                    "variant_sort FROM products WHERE id = :i"
                ),
                {"i": p.id},
            )
        ).one()
        assert satir.variant_group_id is None
        assert satir.option1_value is None
        assert satir.option2_value is None
        assert satir.variant_sort == 0
