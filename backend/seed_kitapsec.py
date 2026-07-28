import asyncio
from sqlalchemy import select, delete
from core.database import AsyncSessionLocal
from models.store import Product, ProductCategory

async def seed_categories():
    async with AsyncSessionLocal() as db:
        # 1. Soft-delete existing categories
        # Let's actually hard-delete them for a clean slate, since this is a dev DB
        await db.execute(delete(ProductCategory))
        await db.commit()

        # 2. Insert new categories based on the Konsantre Kitapseç Model
        categories_data = [
            {
                "name": "Sınav Kitapları",
                "slug": "sinav-kitaplari",
                "sort_order": 1,
                "children": [
                    {"name": "YKS (TYT - AYT) Kitapları", "slug": "yks-kitaplari"},
                    {"name": "LGS Kitapları", "slug": "lgs-kitaplari"},
                    {"name": "KPSS Kitapları", "slug": "kpss-kitaplari"},
                    {"name": "ALES ve DGS Kitapları", "slug": "ales-dgs-kitaplari"},
                    {"name": "YDS Kitapları", "slug": "yds-kitaplari"}
                ]
            },
            {
                "name": "Okula Yardımcı",
                "slug": "okula-yardimci",
                "sort_order": 2,
                "children": [
                    {"name": "Lise Yardımcı Kaynaklar", "slug": "lise-yardimci-kaynaklar"},
                    {"name": "Ortaokul Yardımcı Kaynaklar", "slug": "ortaokul-yardimci-kaynaklar"},
                    {"name": "İlkokul Yardımcı Kaynaklar", "slug": "ilkokul-yardimci-kaynaklar"}
                ]
            },
            {
                "name": "Kırtasiye",
                "slug": "kirtasiye",
                "sort_order": 3,
                "children": [
                    {"name": "Defter ve Ajandalar", "slug": "defter-ajandalar"},
                    {"name": "Kalemler", "slug": "kalemler"}
                ]
            },
            {
                "name": "Dijital Ders Notları",
                "slug": "dijital-ders-notlari",
                "sort_order": 4,
                "children": [
                    {"name": "YKS Dijital Notları", "slug": "yks-dijital-notlari"},
                    {"name": "KPSS Özel Notlar", "slug": "kpss-ozel-notlar"},
                    {"name": "Üniversite Hazırlık Fasikülleri", "slug": "universite-hazirlik-fasikulleri"}
                ]
            }
        ]

        cat_map = {} # to store reference to child categories for product assignment
        
        for main_cat in categories_data:
            parent = ProductCategory(
                name=main_cat["name"],
                slug=main_cat["slug"],
                sort_order=main_cat["sort_order"]
            )
            db.add(parent)
            await db.commit()
            await db.refresh(parent)
            
            for i, child_cat in enumerate(main_cat["children"]):
                child = ProductCategory(
                    name=child_cat["name"],
                    slug=child_cat["slug"],
                    sort_order=i+1,
                    parent_id=parent.id
                )
                db.add(child)
                await db.commit()
                await db.refresh(child)
                cat_map[child.slug] = child.id

        # 3. Re-assign products to new categories
        res = await db.execute(select(Product))
        products = res.scalars().all()

        for p in products:
            if p.slug == "yks-matematik-soru-bankasi":
                p.category_id = cat_map["yks-kitaplari"]
            elif p.slug == "lgs-turkce-denemeleri":
                p.category_id = cat_map["lgs-kitaplari"]
            elif p.slug == "fizik-ders-notlari-pdf":
                p.category_id = cat_map["yks-dijital-notlari"]
            elif p.slug == "motivasyon-ajandasi-2027":
                p.category_id = cat_map["defter-ajandalar"]

        await db.commit()
        print("Categories seeded and products reassigned successfully!")

if __name__ == "__main__":
    asyncio.run(seed_categories())
