"""Gerçek kitap kataloğu ekler (Kitapseç verisi — ISBN/yayınevi/yazar/sayfa/ebat).

Platform fiziksel ürünleri; YKS (TYT-AYT) Kitapları kategorisine (slug yks-kitaplari).
Kapaklar frontend/public/images/products/ altına kopyalandı. Idempotent — ISBN varsa atlar.
Yalnızca kullanıcının verdiği gerçek alanlar doldurulur (cover_type/edition/year gibi
verilmeyenler boş bırakılır — uydurulmaz).
"""
import asyncio

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.store import Product, ProductCategory

BOOKS = [
    dict(
        slug="bilgi-sarmal-ayt-matematik-soru-bankasi",
        title="AYT Matematik Soru Bankası - Bilgi Sarmal Yayınları",
        price=339.00, compare_at_price=399.00,
        author="Seyit Dönmez", publisher="Bilgi Sarmal Yayınları",
        isbn="9786258070187", page_count=416, dimensions="19 x 27",
        cover_url="/images/products/bilgi-sarmal-ayt-matematik.jpg",
    ),
    dict(
        slug="345-2026-ayt-matematik-soru-bankasi",
        title="2026 AYT Matematik Soru Bankası - Üç Dört Beş Yayınları",
        price=349.00, compare_at_price=549.00,
        author="Mehmet Kıvrak", publisher="Üç Dört Beş Yayınları",
        isbn="9786058136816", page_count=375, dimensions="22 x 29",
        publication_year=2026, cover_url="/images/products/345-ayt-matematik.jpg",
    ),
    dict(
        slug="3d-2026-tyt-matematik-video-cozumlu-soru-bankasi",
        title="2026 TYT 3D Matematik Tamamı Video Çözümlü Soru Bankası",
        price=370.00, compare_at_price=580.00,
        author="Özgür Balcı", publisher="3D Yayınları",
        isbn="9786051949291", page_count=360, dimensions="22 x 29",
        publication_year=2026, cover_url="/images/products/3d-tyt-matematik.jpg",
    ),
    dict(
        slug="orijinal-ayt-matematik-soru-bankasi",
        title="AYT Orijinal Matematik Soru Bankası - Orijinal Yayınları",
        price=339.00, compare_at_price=399.00,
        author="Murat Çevik, Zafer Balcı", publisher="Orijinal Yayınları",
        isbn="9786050657104", page_count=431, dimensions="19 x 27",
        cover_url="/images/products/orijinal-ayt-matematik.jpg",
    ),
]


async def main():
    async with AsyncSessionLocal() as db:
        cat = (
            await db.execute(
                select(ProductCategory).where(ProductCategory.slug == "yks-kitaplari")
            )
        ).scalar_one()

        existing = set(
            (
                await db.execute(
                    select(Product.isbn).where(
                        Product.isbn.in_([b["isbn"] for b in BOOKS])
                    )
                )
            ).scalars().all()
        )

        added = 0
        for b in BOOKS:
            if b["isbn"] in existing:
                print(f"  atlandı (zaten var): {b['title']}")
                continue
            db.add(
                Product(
                    kind="PHYSICAL",
                    seller_type="PLATFORM",
                    category_id=cat.id,
                    status="ACTIVE",
                    currency="TRY",
                    stock=25,
                    language="Türkçe",
                    **b,
                )
            )
            added += 1
            print(f"  eklendi: {b['title']}")
        await db.commit()
        print(f"Toplam {added} kitap eklendi.")


if __name__ == "__main__":
    asyncio.run(main())
