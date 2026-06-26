"""Demo kitap kataloğuna temsilî künye (kitap bilgileri) doldurur.

Künye kolonları (author/publisher/isbn/page_count/…) sonradan eklendiği için mevcut
seed kitaplarında NULL. Bu script onları temsilî değerlerle doldurur ki ürün detay
sayfasındaki "Ürün Özellikleri" tablosu görünsün. Demo/seed verisidir; gerçek katalog
kayıtları künyeyi admin formundan alır. Idempotent — slug bazlı, tekrar çalıştırılabilir.
"""
import asyncio

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.store import Product

_COMMON = dict(language="Türkçe", dimensions="19,5 x 27,5", publication_year=2025, edition="1. Basım")
_RASYONEL = dict(author="Rasyonel Matematik", publisher="Rasyonel Yayınları", **_COMMON)

SPECS: dict[str, dict] = {
    "yks-matematik-soru-bankasi": dict(
        author="Komisyon", publisher="3D Yayınları", isbn="9786051940015",
        page_count=512, cover_type="Karton Kapak", **_COMMON
    ),
    "lgs-turkce-denemeleri": dict(
        author="Komisyon", publisher="Hız Yayınları", isbn="9786051940022",
        page_count=160, cover_type="İnce Kapak", language="Türkçe",
        dimensions="19,5 x 27,5", publication_year=2025, edition="2. Basım"
    ),
    "rm-tyt-soru": dict(isbn="9786051940039", page_count=480, cover_type="Karton Kapak", **_RASYONEL),
    "rm-ayt-mat": dict(isbn="9786051940046", page_count=520, cover_type="Karton Kapak", **_RASYONEL),
    "rm-geometri": dict(isbn="9786051940053", page_count=624, cover_type="Karton Kapak", **_RASYONEL),
    "rm-tyt-deneme": dict(isbn="9786051940060", page_count=240, cover_type="İnce Kapak", **_RASYONEL),
    "rm-problemler": dict(isbn="9786051940077", page_count=360, cover_type="Karton Kapak", **_RASYONEL),
    "rm-ayt-deneme": dict(isbn="9786051940084", page_count=200, cover_type="İnce Kapak", **_RASYONEL),
}


async def main():
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(select(Product).where(Product.slug.in_(list(SPECS.keys()))))
        ).scalars().all()
        updated = 0
        for p in rows:
            for field, value in SPECS[p.slug].items():
                setattr(p, field, value)
            updated += 1
        await db.commit()
        print(f"Künye dolduruldu: {updated} kitap")


if __name__ == "__main__":
    asyncio.run(main())
