"""Varyant grubu iş kuralları: kapılar (Faz 1) + grup CRUD ve türetme (Faz 2).

Kitapta varyant KAPALIDIR. Kitabın "seçeneği" ayrı ISBN'li ayrı bir üründür
(yeni baskı, farklı cilt) ve öyle kalmalıdır: varyant grubuna sokmak
barkod↔ISBN ayrımını, fiyat geçmişini ve künye alanlarını bulanıklaştırır.
Kural DB kısıtı değil servis kapısıdır — "kategori zincirinin kökü kitap mı"
sorusu JOIN ister, CHECK ifade edemez.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.store import Product, ProductCategory, VariantGroup
from schemas.store import (
    VariantGroupCreate,
    VariantGroupDetailOut,
    VariantGroupOut,
    VariantGroupUpdate,
    VariantMemberOut,
)

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


# ── Grup CRUD (Faz 2) ────────────────────────────────────────────────────────


async def _load_group(db: AsyncSession, group_id: int) -> VariantGroup:
    g = await db.get(VariantGroup, group_id)
    if g is None or g.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Varyant grubu bulunamadı")
    return g


async def _member_counts(db: AsyncSession, group_ids: list[int]) -> dict[int, int]:
    if not group_ids:
        return {}
    rows = (
        await db.execute(
            select(Product.variant_group_id, func.count())
            .where(
                Product.variant_group_id.in_(group_ids),
                Product.deleted_at.is_(None),
            )
            .group_by(Product.variant_group_id)
        )
    ).all()
    return {gid: int(n) for gid, n in rows}


def _to_out(g: VariantGroup, member_count: int) -> VariantGroupOut:
    return VariantGroupOut(
        id=g.id,
        title=g.title,
        option1_name=g.option1_name,
        option2_name=g.option2_name,
        member_count=member_count,
    )


async def list_groups(db: AsyncSession) -> list[VariantGroupOut]:
    groups = (
        await db.execute(
            select(VariantGroup)
            .where(VariantGroup.deleted_at.is_(None))
            .order_by(VariantGroup.title, VariantGroup.id)
        )
    ).scalars().all()
    counts = await _member_counts(db, [g.id for g in groups])
    return [_to_out(g, counts.get(g.id, 0)) for g in groups]


async def create_group(
    db: AsyncSession, payload: VariantGroupCreate
) -> VariantGroupOut:
    g = VariantGroup(
        title=payload.title,
        option1_name=payload.option1_name,
        option2_name=payload.option2_name,
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return _to_out(g, 0)


async def get_group_detail(
    db: AsyncSession, group_id: int
) -> VariantGroupDetailOut:
    g = await _load_group(db, group_id)
    members = (
        await db.execute(
            select(Product)
            .where(
                Product.variant_group_id == g.id,
                Product.deleted_at.is_(None),
            )
            .order_by(Product.variant_sort, Product.id)
        )
    ).scalars().all()
    return VariantGroupDetailOut(
        **_to_out(g, len(members)).model_dump(),
        members=[
            VariantMemberOut(
                id=m.id,
                title=m.title,
                option1_value=m.option1_value,
                option2_value=m.option2_value,
                variant_sort=m.variant_sort,
                price=str(m.price),
                stock=m.stock,
                status=m.status,
                cover_url=m.cover_url,
                sku=m.sku,
                barcode=m.barcode,
            )
            for m in members
        ],
    )


async def update_group(
    db: AsyncSession, group_id: int, payload: VariantGroupUpdate
) -> VariantGroupOut:
    g = await _load_group(db, group_id)
    data = payload.model_dump(exclude_unset=True)

    async def _deger_tasiyan(kolon) -> int:
        return (
            await db.execute(
                select(func.count()).where(
                    Product.variant_group_id == g.id,
                    Product.deleted_at.is_(None),
                    kolon.isnot(None),
                )
            )
        ).scalar_one()

    if "option2_name" in data and data["option2_name"] is None:
        # Eksen kaldırma: üyeler o eksende değer taşıyorsa kaldırılamaz —
        # değerler askıda kalır ve varyant seçici adsız kolon gösterirdi.
        tasiyan = await _deger_tasiyan(Product.option2_value)
        if tasiyan:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"2. eksen kaldırılamaz: {tasiyan} üründe bu eksenin değeri "
                "dolu. Önce üyelerin 2. eksen değerlerini temizleyin.",
            )

    # Eksen YENİDEN ADLANDIRMA da üyeler değer taşırken yasak (P2-4): "Renk"
    # → "Ebat" yapılınca "Sarı" değeri Ebat kutusuna düşer ve VARIANT_AXES'in
    # varlık sebebi olan facet karışması geri gelirdi. Boş grupta serbest.
    for alan, kolon, etiket in (
        ("option1_name", Product.option1_value, "1."),
        ("option2_name", Product.option2_value, "2."),
    ):
        if (
            alan in data
            and data[alan] is not None
            and data[alan] != getattr(g, alan)
        ):
            tasiyan = await _deger_tasiyan(kolon)
            if tasiyan:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"{etiket} eksenin adı değiştirilemez: {tasiyan} üründe bu "
                    "eksenin değeri dolu — mevcut değerler yeni eksenin "
                    "anlamına taşınmış olurdu (facet karışması). Önce üyeleri "
                    "gruptan çıkarın ya da yeni bir grup açın.",
                )

    yeni_o1 = data.get("option1_name", g.option1_name)
    yeni_o2 = data.get("option2_name", g.option2_name)
    if yeni_o2 is not None and yeni_o2 == yeni_o1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "İki eksen aynı olamaz")

    for field in ("title", "option1_name", "option2_name"):
        if field in data:
            setattr(g, field, data[field])
    await db.commit()
    await db.refresh(g)
    counts = await _member_counts(db, [g.id])
    return _to_out(g, counts.get(g.id, 0))


async def delete_group(db: AsyncSession, group_id: int) -> None:
    """Grubu FİZİKSEL siler — üyesi varsa anlamlı 409.

    Soft-delete bilinçli DEĞİL: üyeler FK ile gruba bağlı; "silinmiş" bir gruba
    bağlı yaşayan ürünler, seçicisi kaybolmuş yetim varyantlar üretirdi. FK
    RESTRICT son savunmadır (yarışta bile yetim bırakmaz); buradaki sayım onu
    kullanıcı diline çevirir.
    """
    g = await _load_group(db, group_id)
    bagli = (
        await db.execute(
            # Soft-delete edilmiş ürün de FK taşır ve RESTRICT'i tetikler —
            # sayım bu yüzden deleted_at filtresiz.
            select(func.count()).where(Product.variant_group_id == g.id)
        )
    ).scalar_one()
    if bagli:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Grup silinemez: {bagli} ürün bu gruba bağlı (silinmiş ürünler "
            "dahil). Önce ürünleri gruptan çıkarın.",
        )
    await db.execute(delete(VariantGroup).where(VariantGroup.id == g.id))
    await db.commit()


# ── Üyelik doğrulama (ürün yazma yolu buradan geçer) ─────────────────────────


async def validate_membership(
    db: AsyncSession,
    *,
    group_id: int,
    category_id: int | None,
    option1_value: str | None,
    option2_value: str | None,
    barcode: str | None,
) -> VariantGroup:
    """Gruba bağlanacak ürünün alanlarını doğrular; grubu döner.

    DB CHECK'leri (Faz 1) son savunmadır; buradaki erken kontroller aynı
    kuralları admin diline çevirir (400/409, opak IntegrityError yerine).
    """
    g = await _load_group(db, group_id)
    await ensure_variants_allowed(db, category_id)
    if not barcode:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Varyant grubundaki ürün barkod taşımak zorunda — rafta iki "
            "varyant ancak barkodla ayırt edilir.",
        )
    if not option1_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{g.option1_name}' ekseni için bir değer girin.",
        )
    if g.option2_name is None and option2_value is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bu grup tek eksenli; 2. eksen değeri gönderilemez.",
        )
    if g.option2_name is not None and not option2_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{g.option2_name}' ekseni için bir değer girin.",
        )
    return g
