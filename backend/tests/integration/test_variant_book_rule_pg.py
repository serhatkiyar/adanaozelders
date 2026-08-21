"""Kitapta varyant kapalı — servis katmanı davranış testi (gerçek Postgres).

Kural: kategori **ata zincirinin kökü** kitap köklerinden biriyse
(`variant_service.BOOK_ROOT_SLUGS`) ürün bir varyant grubuna bağlanamaz.
Kitabın "varyantı" ayrı ISBN'li ayrı üründür (yeni baskı/cilt); onu varyant
grubuna sokmak barkod-ISBN ayrımını ve fiyat geçmişini bozar.

Kural DB kısıtı değil servis kapısıdır (bilinçli): kategori ağacına bakmak
JOIN ister, CHECK ifade edemez. Bu yüzden davranış testi buradadır ve
zincir çözümü gerçek recursive CTE ile sınanır (iki seviyeli sahte veriyle
değil).
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import ProductCategory
from services import variant_service


def _uniq() -> str:
    return uuid.uuid4().hex[:8]


class KategoriFabrika:
    def __init__(self) -> None:
        self.ids: list[int] = []

    async def kategori(self, s, *, slug: str, parent_id: int | None = None):
        c = ProductCategory(slug=slug, name=slug.title(), parent_id=parent_id)
        s.add(c)
        await s.flush()
        self.ids.append(c.id)
        return c

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.ids:
                # Çocuklar önce (FK SET NULL olsa da sıra deterministik olsun).
                await s.execute(
                    text("DELETE FROM product_categories WHERE id = ANY(:i)"),
                    {"i": list(reversed(self.ids))},
                )
                await s.commit()


@pytest.fixture
async def kf(pg):
    f = KategoriFabrika()
    yield f
    await f.cleanup()


async def test_kitap_koku_altinda_varyant_reddedilir(kf):
    """Kök `sinav-kitaplari` benzeri kitap kökünün YAPRAK kategorisinde varyant
    açılamaz — ret zinciri köke kadar çözerek verilmeli (yaprak slug'ı kitapla
    ilgisiz görünse bile)."""
    async with AsyncSessionLocal() as s:
        kok = await kf.kategori(s, slug=f"sinav-kitaplari-{_uniq()}")
        # Gerçek köklerden biriyle eşleşmesi için test kökünü sözlüğe monkeypatch
        # etmek yerine GERÇEK kök slug'ı kullanılamaz (dev verisiyle çakışır);
        # bu yüzden zincir, sözlükteki gerçek köke bağlanır: kökün slug'ı
        # sözlükten SEÇİLMİŞ bir ada normalize edilerek doğrulanır.
        yaprak = await kf.kategori(s, slug=f"tyt-deneme-{_uniq()}", parent_id=kok.id)
        await s.commit()
        kok_id, yaprak_id = kok.id, yaprak.id

    async with AsyncSessionLocal() as s:
        # Zincir çözümü: yaprak → kök.
        zincir = await variant_service.category_ancestor_chain(s, yaprak_id)
        assert [c.id for c in zincir] == [yaprak_id, kok_id]

        # Kural: kök slug'ı kitap köküyse ret. Test kökü benzersiz slug taşıdığı
        # için sözlüğe geçici eklenir — kural kökün SLUG'ına bakar, adına değil.
        eski = variant_service.BOOK_ROOT_SLUGS
        variant_service.BOOK_ROOT_SLUGS = eski | {zincir[-1].slug}
        try:
            with pytest.raises(HTTPException) as ei:
                await variant_service.ensure_variants_allowed(s, yaprak_id)
            assert ei.value.status_code == 409
        finally:
            variant_service.BOOK_ROOT_SLUGS = eski


async def test_kitap_disi_kategoride_varyant_serbest(kf):
    async with AsyncSessionLocal() as s:
        kok = await kf.kategori(s, slug=f"kirtasiye-{_uniq()}")
        yaprak = await kf.kategori(s, slug=f"kalemler-{_uniq()}", parent_id=kok.id)
        await s.commit()
        # Ret YOK — sessizce döner.
        await variant_service.ensure_variants_allowed(s, yaprak.id)


async def test_kategorisiz_urun_varyant_serbest(kf):
    """Kategorisi olmayan ürün kitap sayılamaz; kapı açık kalır."""
    async with AsyncSessionLocal() as s:
        await variant_service.ensure_variants_allowed(s, None)


async def test_gercek_kitap_kokleri_sozlukte():
    """Canlı katalogdaki üç kitap kökü sözlükte olmalı — kural gerçek veriyle
    eşleşmezse hiçbir kitabı korumaz (yalancı yeşilin en sinsi hâli)."""
    assert {"kitap", "sinav-kitaplari", "okula-yardimci"} <= (
        variant_service.BOOK_ROOT_SLUGS
    )
