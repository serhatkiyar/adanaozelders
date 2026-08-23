"""Mağaza ana sayfasındaki sıralanabilir ürün ve görsel bölümleri."""

from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import storage
from core.config import settings
from models import Product, StoreHomeSection, StoreHomeSectionItem
from models.store import ProductStatus
from schemas.store_home_section import (
    StoreHomeFeedOut,
    StoreHomeImageTileEdit,
    StoreHomeImageTileMeta,
    StoreHomeProductSectionWrite,
    StoreHomeSectionMeta,
    StoreHomeSectionOut,
    StoreHomeSectionPublicOut,
)
from services.store_service import _compute_global_mean, _tedarikci_stogu, _to_search_out


async def _selected_products(db: AsyncSession, product_ids: list[int]) -> list[Product]:
    rows = list(
        (
            await db.execute(
                select(Product).where(
                    Product.id.in_(product_ids),
                    Product.deleted_at.is_(None),
                    Product.status == ProductStatus.ACTIVE.value,
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {row.id: row for row in rows}
    if len(by_id) != len(product_ids):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Seçilen ürünlerden biri aktif değil veya bulunamadı.",
        )
    return [by_id[product_id] for product_id in product_ids]


async def _items_by_section(
    db: AsyncSession, section_ids: list[int], *, active_only: bool
) -> tuple[dict[int, list[Product]], dict[int, list[int]]]:
    if not section_ids:
        return {}, {}
    conditions = [
        StoreHomeSectionItem.section_id.in_(section_ids),
        StoreHomeSectionItem.deleted_at.is_(None),
        Product.deleted_at.is_(None),
    ]
    if active_only:
        conditions.append(Product.status == ProductStatus.ACTIVE.value)
    rows = (
        await db.execute(
            select(StoreHomeSectionItem, Product)
            .join(Product, Product.id == StoreHomeSectionItem.product_id)
            .where(*conditions)
            .order_by(
                StoreHomeSectionItem.section_id,
                StoreHomeSectionItem.sort_order,
                StoreHomeSectionItem.id,
            )
        )
    ).all()
    products: dict[int, list[Product]] = {}
    ids: dict[int, list[int]] = {}
    for item, product in rows:
        products.setdefault(item.section_id, []).append(product)
        ids.setdefault(item.section_id, []).append(product.id)
    return products, ids


async def _product_outputs(db: AsyncSession, products: list[Product]):
    if not products:
        return []
    prior_mean = await _compute_global_mean(db)
    supplier_stock = await _tedarikci_stogu(db, products)
    return [
        _to_search_out(
            product,
            prior_mean,
            settings.BAYESIAN_CONFIDENCE,
            supplier_qty=supplier_stock.get(product.id),
        )
        for product in products
    ]


def _tiles(section: StoreHomeSection) -> list[dict[str, str]]:
    return list(section.image_tiles or [])


async def _public_out(
    db: AsyncSession,
    section: StoreHomeSection,
    products: list[Product],
) -> StoreHomeSectionPublicOut:
    return StoreHomeSectionPublicOut(
        id=section.id,
        title=section.title,
        description=section.description,
        section_type=section.section_type,
        link_url=section.link_url,
        link_label=section.link_label,
        products=await _product_outputs(db, products),
        image_tiles=_tiles(section),
    )


async def list_public(db: AsyncSession) -> StoreHomeFeedOut:
    configured = bool(
        (
            await db.execute(
                select(func.count(StoreHomeSection.id)).where(
                    StoreHomeSection.deleted_at.is_(None),
                    StoreHomeSection.is_active.is_(True),
                    StoreHomeSection.section_type != "RECENTLY_VIEWED",
                )
            )
        ).scalar_one()
    )
    sections = list(
        (
            await db.execute(
                select(StoreHomeSection)
                .where(
                    StoreHomeSection.deleted_at.is_(None),
                    StoreHomeSection.is_active.is_(True),
                )
                .order_by(StoreHomeSection.sort_order, StoreHomeSection.id)
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    products, _ids = await _items_by_section(
        db, [section.id for section in sections], active_only=True
    )
    output: list[StoreHomeSectionPublicOut] = []
    for section in sections:
        section_products = products.get(section.id, [])
        if section.section_type == "PRODUCT_RAIL" and not section_products:
            continue
        if section.section_type == "IMAGE_GRID" and not 1 <= len(_tiles(section)) <= 4:
            continue
        output.append(await _public_out(db, section, section_products))
    return StoreHomeFeedOut(configured=configured, sections=output)


async def list_admin(db: AsyncSession) -> list[StoreHomeSectionOut]:
    sections = list(
        (
            await db.execute(
                select(StoreHomeSection)
                .where(StoreHomeSection.deleted_at.is_(None))
                .order_by(StoreHomeSection.sort_order, StoreHomeSection.id)
            )
        )
        .scalars()
        .all()
    )
    products, ids = await _items_by_section(
        db, [section.id for section in sections], active_only=False
    )
    output: list[StoreHomeSectionOut] = []
    for section in sections:
        public = await _public_out(db, section, products.get(section.id, []))
        output.append(
            StoreHomeSectionOut(
                **public.model_dump(),
                product_ids=ids.get(section.id, []),
                is_active=section.is_active,
                sort_order=section.sort_order,
                created_at=section.created_at,
                updated_at=section.updated_at,
            )
        )
    return output


async def _get_or_404(db: AsyncSession, section_id: int) -> StoreHomeSection:
    section = await db.get(StoreHomeSection, section_id)
    if section is None or section.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mağaza bölümü bulunamadı.")
    return section


async def _replace_items(db: AsyncSession, section_id: int, product_ids: list[int]) -> None:
    await _selected_products(db, product_ids)
    current = list(
        (
            await db.execute(
                select(StoreHomeSectionItem).where(
                    StoreHomeSectionItem.section_id == section_id,
                    StoreHomeSectionItem.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    for item in current:
        item.deleted_at = now
    await db.flush()
    for index, product_id in enumerate(product_ids):
        db.add(
            StoreHomeSectionItem(
                section_id=section_id,
                product_id=product_id,
                sort_order=index * 10,
            )
        )


async def create_product(
    db: AsyncSession, payload: StoreHomeProductSectionWrite
) -> StoreHomeSectionOut:
    values = payload.model_dump(exclude={"product_ids"})
    section = StoreHomeSection(**values, section_type="PRODUCT_RAIL", image_tiles=[])
    db.add(section)
    await db.flush()
    await _replace_items(db, section.id, payload.product_ids)
    await db.flush()
    return next(row for row in await list_admin(db) if row.id == section.id)


async def update_product(
    db: AsyncSession, section_id: int, payload: StoreHomeProductSectionWrite
) -> StoreHomeSectionOut:
    section = await _get_or_404(db, section_id)
    if section.section_type != "PRODUCT_RAIL":
        raise HTTPException(status.HTTP_409_CONFLICT, "Görsel bölümü ürün şeridine çevrilemez.")
    values = payload.model_dump(exclude={"product_ids"})
    for field, value in values.items():
        setattr(section, field, value)
    await _replace_items(db, section.id, payload.product_ids)
    await db.flush()
    return next(row for row in await list_admin(db) if row.id == section.id)


async def update_recently_viewed(
    db: AsyncSession, section_id: int, *, is_active: bool
) -> StoreHomeSectionOut:
    section = await _get_or_404(db, section_id)
    if section.section_type != "RECENTLY_VIEWED":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu bölüm son görüntülenenler vitrini değil.",
        )
    section.is_active = is_active
    await db.flush()
    return next(row for row in await list_admin(db) if row.id == section.id)


async def _upload_images(
    image_bytes: list[bytes], tile_meta: list[StoreHomeImageTileMeta]
) -> list[dict[str, str]]:
    if not 1 <= len(image_bytes) <= 4 or len(image_bytes) != len(tile_meta):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "1–4 görsel yükleyin; her görsel için bir bağlantı tanımlayın.",
        )
    uploaded: list[str] = []
    try:
        for data in image_bytes:
            uploaded.append(await storage.upload_store_showcase_photo(data))
    except Exception:
        for url in uploaded:
            await storage.delete_file(url)
        raise
    return [
        {"image_url": url, **meta.model_dump()}
        for url, meta in zip(uploaded, tile_meta, strict=True)
    ]


async def create_images(
    db: AsyncSession,
    payload: StoreHomeSectionMeta,
    *,
    image_bytes: list[bytes],
    tile_meta: list[StoreHomeImageTileMeta],
) -> StoreHomeSectionOut:
    tiles = await _upload_images(image_bytes, tile_meta)
    try:
        section = StoreHomeSection(
            **payload.model_dump(), section_type="IMAGE_GRID", image_tiles=tiles
        )
        db.add(section)
        await db.flush()
        return next(row for row in await list_admin(db) if row.id == section.id)
    except Exception:
        await db.rollback()
        for tile in tiles:
            await storage.delete_file(tile["image_url"])
        raise


async def update_images(
    db: AsyncSession,
    section_id: int,
    payload: StoreHomeSectionMeta,
    *,
    tile_edits: list[StoreHomeImageTileEdit],
    image_bytes: list[bytes],
) -> tuple[StoreHomeSectionOut, list[str], list[str]]:
    section = await _get_or_404(db, section_id)
    if section.section_type != "IMAGE_GRID":
        raise HTTPException(status.HTTP_409_CONFLICT, "Ürün şeridi görsel bölümüne çevrilemez.")
    current = _tiles(section)
    if not 1 <= len(tile_edits) <= 4:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Bir görsel bölümünde 1 ile 4 arasında görsel olmalı.",
        )
    existing_indices = [
        edit.existing_index for edit in tile_edits if edit.existing_index is not None
    ]
    file_indices = [edit.file_index for edit in tile_edits if edit.file_index is not None]
    if len(existing_indices) != len(set(existing_indices)) or any(
        index >= len(current) for index in existing_indices
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mevcut görsel seçimi geçersiz.")
    if len(file_indices) != len(set(file_indices)) or set(file_indices) != set(
        range(len(image_bytes))
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Yeni görsel seçimi geçersiz.")

    uploaded: list[str] = []
    try:
        for data in image_bytes:
            uploaded.append(await storage.upload_store_showcase_photo(data))
        tiles: list[dict[str, str]] = []
        for edit in tile_edits:
            image_url = (
                current[edit.existing_index]["image_url"]
                if edit.existing_index is not None
                else uploaded[edit.file_index]
            )
            tiles.append(
                {
                    "image_url": image_url,
                    **edit.model_dump(exclude={"existing_index", "file_index"}),
                }
            )
        kept_urls = {tile["image_url"] for tile in tiles}
        old_urls = [tile["image_url"] for tile in current if tile.get("image_url") not in kept_urls]
        for field, value in payload.model_dump().items():
            setattr(section, field, value)
        section.image_tiles = tiles
        await db.flush()
        output = next(row for row in await list_admin(db) if row.id == section.id)
        return output, old_urls, uploaded
    except Exception:
        await db.rollback()
        for url in uploaded:
            await storage.delete_file(url)
        raise


async def reorder(db: AsyncSession, ordered_ids: list[int]) -> list[StoreHomeSectionOut]:
    rows = list(
        (
            await db.execute(
                select(StoreHomeSection).where(
                    StoreHomeSection.id.in_(ordered_ids),
                    StoreHomeSection.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != len(ordered_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sıralanacak bölümlerden biri bulunamadı.")
    by_id = {row.id: row for row in rows}
    for index, section_id in enumerate(ordered_ids):
        by_id[section_id].sort_order = index * 10
    await db.flush()
    return await list_admin(db)


async def delete(db: AsyncSession, section_id: int) -> list[str]:
    section = await _get_or_404(db, section_id)
    if section.section_type == "RECENTLY_VIEWED":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Son görüntülenenler vitrini silinemez; isterseniz yayından kaldırabilirsiniz.",
        )
    section.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    section.is_active = False
    await db.flush()
    return [tile.get("image_url", "") for tile in _tiles(section) if tile.get("image_url")]
