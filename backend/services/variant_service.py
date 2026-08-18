"""Varyant grubu iş kuralları (Faz 1: yalnız kapılar; CRUD Faz 2'de gelir).

Kitapta varyant KAPALIDIR. Kitabın "seçeneği" ayrı ISBN'li ayrı bir üründür
(yeni baskı, farklı cilt) ve öyle kalmalıdır: varyant grubuna sokmak
barkod↔ISBN ayrımını, fiyat geçmişini ve künye alanlarını bulanıklaştırır.
Kural DB kısıtı değil servis kapısıdır — "kategori zincirinin kökü kitap mı"
sorusu JOIN ister, CHECK ifade edemez.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.store import ProductCategory

#: Kitap sayılan KÖK kategori slug'ları. Kural köke bakar: yaprak slug'ları
#: ("tyt-deneme", "matematik-soru-bankasi") kitap kelimesi taşımayabilir ve
#: admin yeni yaprak açtıkça listeyi kovalamak kaybedilecek bir yarıştır;
#: kökler ise az sayıda ve kürasyonludur. Yeni bir kitap kökü açılırsa buraya
#: eklenmelidir (test_gercek_kitap_kokleri_sozlukte canlı kökleri sabitler).
BOOK_ROOT_SLUGS: frozenset[str] = frozenset(
    {"kitap", "sinav-kitaplari", "okula-yardimci"}
)

#: Zincir çözümünde izin verilen en büyük derinlik. Model bugün iki seviyeli;
#: tavan, verideki olası bir parent döngüsünün sorguyu sonsuza sürmesini keser.
_MAX_DEPTH = 10


async def category_ancestor_chain(
    db: AsyncSession, category_id: int
) -> list[ProductCategory]:
    """Kategori + tüm ataları, YAPRAKTAN KÖKE sıralı (recursive CTE).

    `store_service._category_and_descendants`'ın ters yönü. Model bugün iki
    seviyeli ama sorgu derinlikten bağımsız: üçüncü seviye eklenirse kural
    sessizce kök yerine ara kategoriye bakmaya başlamasın.
    """
    base = (
        select(
            ProductCategory.id,
            ProductCategory.parent_id,
            literal(0).label("depth"),
        )
        .where(
            ProductCategory.id == category_id,
            ProductCategory.deleted_at.is_(None),
        )
        .cte("cat_ancestors", recursive=True)
    )
    parent = select(
        ProductCategory.id,
        ProductCategory.parent_id,
        (base.c.depth + 1).label("depth"),
    ).where(
        ProductCategory.id == base.c.parent_id,
        ProductCategory.deleted_at.is_(None),
        base.c.depth < _MAX_DEPTH,
    )
    tree = base.union_all(parent)
    rows = (
        await db.execute(
            select(ProductCategory)
            .join(tree, ProductCategory.id == tree.c.id)
            .order_by(tree.c.depth)
        )
    ).scalars().all()
    return list(rows)


async def is_book_category(db: AsyncSession, category_id: int | None) -> bool:
    """Kategori zincirinde kitap KÖKÜ var mı? (Kategorisiz ürün kitap sayılmaz.)

    Kökle yetinmeyip zincirin TAMAMI taranır: bir kitap kökü ileride başka bir
    kökün altına taşınırsa (yeniden düzenleme) kural taşımayla birlikte kırılmaz.
    """
    if category_id is None:
        return False
    zincir = await category_ancestor_chain(db, category_id)
    return any(c.slug in BOOK_ROOT_SLUGS for c in zincir)


async def ensure_variants_allowed(
    db: AsyncSession, category_id: int | None
) -> None:
    """Bu kategorideki ürün bir varyant grubuna bağlanabilir mi? Bağlanamazsa 409.

    Faz 2'nin grup oluşturma/üye ekleme uçları her üye için bu kapıdan geçer.
    """
    if await is_book_category(db, category_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kitap kategorisindeki ürünlerde varyant açılamaz — farklı "
            "baskı/cilt ayrı ISBN'li ayrı bir üründür.",
        )
