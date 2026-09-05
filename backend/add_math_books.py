import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.store import Product, ProductCategory
from models.tutor import Tutor

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(ProductCategory).where(ProductCategory.slug == "kitap").limit(1))
        cat = res.scalar_one_or_none()
        if not cat:
            cat = ProductCategory(slug="kitap", name="Kitap", sort_order=1)
            db.add(cat)
            await db.commit()
            await db.refresh(cat)

        books = [
            ("rm-tyt-soru", "49 Günde TYT Matematik Soru Kitabı ve Video Ders Notları Kitabı 2li Set", 758.00, 900.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.7, 641),
            ("rm-ayt-mat", "65 Günde AYT Matematik Kampı Soru Bankası", 450.00, 500.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.9, 120),
            ("rm-geometri", "Geometri Sıfırdan Zirveye Konu Anlatımlı", 320.00, 350.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.5, 34),
            ("rm-tyt-deneme", "TYT Matematik 15'li Çözümlü Deneme Sınavı", 185.00, 200.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.8, 890),
            ("rm-problemler", "Problemler Soru Kitabı Video Çözümlü", 215.00, 250.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.6, 432),
            ("rm-ayt-deneme", "AYT Matematik 10'lu Simulasyon Denemeleri", 240.00, 280.00, "https://cdn.dsmcdn.com/mnresize/400/-/ty1743/product/media/images/prod/PIM/20250912/06/b592ab48-a5c3-469a-9733-25448ac20894/1_org_zoom.jpg", 4.4, 211),
        ]

        res_t = await db.execute(select(Tutor).where(Tutor.first_name == "REHBER MATEMATİK YAYINLARI").limit(1))
        tutor = res_t.scalar_one_or_none()
        if not tutor:
            tutor = Tutor(
                email="rm@test.com",
                hashed_password="pw",
                role_id=2, # Assuming 2 is Tutor role
                first_name="REHBER MATEMATİK YAYINLARI",
                last_name="",
                headline="YKS Hazırlık",
            )
            db.add(tutor)
            await db.commit()
            await db.refresh(tutor)

        for slug, title, price, compare, img, rating, count in books:
            res_p = await db.execute(select(Product).where(Product.slug == slug))
            existing = res_p.scalar_one_or_none()
            if not existing:
                p = Product(
                    slug=slug,
                    title=title,
                    description=f"Rehber Matematik Yayınları - {title}",
                    kind="PHYSICAL",
                    seller_type="TUTOR",
                    tutor_id=tutor.id,
                    price=price,
                    compare_at_price=compare,
                    stock=100,
                    weight_grams=500,
                    category_id=cat.id,
                    status="ACTIVE",
                    cover_url=img,
                    rating_sum=int(rating * count),
                    rating_count=count
                )
                db.add(p)
            
        await db.commit()
        print("6 kitap eklendi.")

if __name__ == "__main__":
    asyncio.run(main())
