import asyncio
from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.store import Product, ProductCategory, ProductImage
from models.tutor import Tutor

async def seed_store():
    async with AsyncSessionLocal() as db:
        # Create Categories
        # Books
        cat_books = ProductCategory(slug="kitap", name="Kitap & Deneme", sort_order=1)
        db.add(cat_books)
        
        # Stationary
        cat_stat = ProductCategory(slug="kirtasiye", name="Kırtasiye & Hediyelik", sort_order=2)
        db.add(cat_stat)
        
        # Digital
        cat_digi = ProductCategory(slug="dijital", name="Dijital Ders Notları", sort_order=3)
        db.add(cat_digi)
        
        await db.commit()
        await db.refresh(cat_books)
        await db.refresh(cat_stat)
        await db.refresh(cat_digi)

        # Get a Tutor (Dilan Kıyar id=4) for the digital product
        res = await db.execute(select(Tutor).where(Tutor.first_name == "Dilan").limit(1))
        tutor = res.scalar_one_or_none()
        tutor_id = tutor.id if tutor else None

        # Products
        p1 = Product(
            slug="yks-matematik-soru-bankasi",
            title="YKS Matematik Soru Bankası",
            description="ÖSYM formatına uygun, yeni nesil sorularla hazırlanmış kapsamlı matematik soru bankası.",
            kind="PHYSICAL",
            seller_type="PLATFORM",
            price=249.90,
            compare_at_price=300.00,
            stock=150,
            weight_grams=450,
            category_id=cat_books.id,
            status="ACTIVE",
            cover_url="/images/products/yks_matematik.png",
            author="Komisyon",
            publisher="3D Yayınları",
            isbn="9786051940015",
            page_count=512,
            dimensions="19,5 x 27,5",
            publication_year=2025,
            edition="1. Basım",
            language="Türkçe",
            cover_type="Karton Kapak",
        )
        db.add(p1)

        p2 = Product(
            slug="lgs-turkce-denemeleri",
            title="LGS Türkçe 10'lu Deneme Sınavı",
            description="LGS müfredatına tam uyumlu, video çözümlü 10'lu Türkçe deneme seti.",
            kind="PHYSICAL",
            seller_type="PLATFORM",
            price=129.90,
            compare_at_price=160.00,
            stock=200,
            weight_grams=300,
            category_id=cat_books.id,
            status="ACTIVE",
            cover_url="/images/products/lgs_turkce.png",
            author="Komisyon",
            publisher="Hız Yayınları",
            isbn="9786051940022",
            page_count=160,
            dimensions="19,5 x 27,5",
            publication_year=2025,
            edition="2. Basım",
            language="Türkçe",
            cover_type="İnce Kapak",
        )
        db.add(p2)

        p3 = Product(
            slug="fizik-ders-notlari-pdf",
            title="TYT-AYT Fizik El Yazısı Ders Notları (PDF)",
            description="Tüm konuları kapsayan, özenle hazırlanmış renkli el yazısı fizik notları. Anında indirme.",
            kind="DIGITAL",
            seller_type="TUTOR",
            tutor_id=tutor_id,
            price=49.90,
            compare_at_price=90.00,
            category_id=cat_digi.id,
            status="ACTIVE",
            cover_url="/images/products/fizik_pdf.png",
            digital_asset_key="pdfs/fizik_notlari.pdf",
            digital_asset_name="Fizik_Ders_Notlari.pdf"
        )
        db.add(p3)

        p4 = Product(
            slug="motivasyon-ajandasi-2027",
            title="Özel Tasarım Öğrenci Motivasyon Ajandası",
            description="Planlı çalışmayı kolaylaştıran, haftalık hedef takipli ve motivasyon sözleri içeren premium ajanda.",
            kind="PHYSICAL",
            seller_type="PLATFORM",
            price=189.90,
            compare_at_price=220.00,
            stock=85,
            weight_grams=250,
            category_id=cat_stat.id,
            status="ACTIVE",
            cover_url="/images/products/ajanda.png"
        )
        db.add(p4)

        await db.commit()
        print("Store seeded successfully with 4 products!")

if __name__ == "__main__":
    asyncio.run(seed_store())
