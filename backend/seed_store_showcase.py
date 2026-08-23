"""Geliştirme vitrini için gerçek mağaza ürünlerine bağlı başlangıç kartları.

Kartlar admin paneline girdikten sonra içerik sahipliği CMS'dedir. Bu script
yalnız eksik başlangıç başlıklarını ekler; mevcut kartları güncellemez ve
silinmiş kartları diriltmez.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models import Product, StoreShowcaseCard, StoreShowcaseCardItem
from models.store import ProductStatus


SEED_CARDS: tuple[dict[str, object], ...] = (
    {
        "title": "AYT Matematik Seçkisi",
        "description": "Sınava hazırlananların tercih ettiği kaynaklar",
        "link_url": "/magaza?q=AYT",
        "product_slugs": (
            "bilgi-sarmal-ayt-matematik-soru-bankasi",
            "345-2026-ayt-matematik-soru-bankasi",
            "orijinal-ayt-matematik-soru-bankasi",
        ),
    },
    {
        "title": "TYT Video Çözümlü",
        "description": "Soruyu çöz, videodan kontrol et",
        "link_url": "/magaza?q=TYT",
        "product_slugs": (
            "3d-2026-tyt-matematik-video-cozumlu-soru-bankasi",
        ),
    },
    {
        "title": "Yeni Gelen Kitaplar",
        "description": "Kataloğa yeni eklenen sınav kaynakları",
        "link_url": "/magaza?sort=newest",
        "product_slugs": (
            "orijinal-ayt-matematik-soru-bankasi",
            "3d-2026-tyt-matematik-video-cozumlu-soru-bankasi",
        ),
    },
    {
        "title": "Fiyat Avantajlı Kaynaklar",
        "description": "Güncel indirimli kitaplar",
        "link_url": "/magaza",
        "product_slugs": (
            "345-2026-ayt-matematik-soru-bankasi",
            "bilgi-sarmal-ayt-matematik-soru-bankasi",
        ),
    },
)


async def main() -> None:
    async with AsyncSessionLocal() as db:
        slugs = {
            slug
            for card in SEED_CARDS
            for slug in card["product_slugs"]
        }
        products = list(
            (
                await db.execute(
                    select(Product).where(
                        Product.slug.in_(slugs),
                        Product.deleted_at.is_(None),
                        Product.status == ProductStatus.ACTIVE.value,
                    )
                )
            ).scalars().all()
        )
        by_slug = {product.slug: product for product in products}

        added = 0
        skipped = 0
        for sort_index, definition in enumerate(SEED_CARDS):
            title = str(definition["title"])
            existing = await db.scalar(
                select(StoreShowcaseCard.id).where(
                    StoreShowcaseCard.title == title,
                    StoreShowcaseCard.deleted_at.is_(None),
                )
            )
            if existing is not None:
                skipped += 1
                print(f"  atlandı (zaten var): {title}")
                continue

            selected = [
                by_slug[slug]
                for slug in definition["product_slugs"]
                if slug in by_slug
            ]
            if not selected:
                skipped += 1
                print(f"  atlandı (aktif ürün bulunamadı): {title}")
                continue

            card = StoreShowcaseCard(
                title=title,
                description=str(definition["description"]),
                link_url=str(definition["link_url"]),
                is_active=True,
                sort_order=sort_index * 10,
            )
            db.add(card)
            await db.flush()
            for product_index, product in enumerate(selected):
                db.add(
                    StoreShowcaseCardItem(
                        card_id=card.id,
                        product_id=product.id,
                        sort_order=product_index * 10,
                    )
                )
            added += 1
            print(f"  eklendi: {title}")

        await db.commit()
        print(f"Eklendi: {added}, güncellendi: 0, atlandı: {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
