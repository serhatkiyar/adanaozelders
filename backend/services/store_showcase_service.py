"""Mağaza vitrin kartlarının sıralama ve ürün bağlama iş kuralları."""

from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import storage
from models import Product, StoreShowcaseCard, StoreShowcaseCardItem
from models.store import ProductStatus
from schemas.store_showcase_card import (
    StoreShowcaseCardCreate,
    StoreShowcaseCustomCardMeta,
    StoreShowcaseCustomTileEdit,
    StoreShowcaseCustomTileMeta,
    StoreShowcaseCardOut,
    StoreShowcaseCardPublicOut,
    StoreShowcaseCardUpdate,
    StoreShowcaseFeedOut,
    StoreShowcaseProductOut,
)


async def _products(db: AsyncSession, product_ids: list[int]) -> list[Product]:
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


async def _items_by_card(db: AsyncSession, card_ids: list[int]) -> dict[int, list[Product]]:
    if not card_ids:
        return {}
    rows = (
        await db.execute(
            select(StoreShowcaseCardItem, Product)
            .join(Product, Product.id == StoreShowcaseCardItem.product_id)
            .where(
                StoreShowcaseCardItem.card_id.in_(card_ids),
                StoreShowcaseCardItem.deleted_at.is_(None),
                Product.deleted_at.is_(None),
                Product.status == ProductStatus.ACTIVE.value,
            )
            .order_by(
                StoreShowcaseCardItem.card_id,
                StoreShowcaseCardItem.sort_order,
                StoreShowcaseCardItem.id,
            )
        )
    ).all()
    result: dict[int, list[Product]] = {}
    for item, product in rows:
        result.setdefault(item.card_id, []).append(product)
    return result


def _product_out(product: Product) -> StoreShowcaseProductOut:
    return StoreShowcaseProductOut(
        id=product.id, slug=product.slug, title=product.title, cover_url=product.cover_url
    )


def _custom_tiles(card: StoreShowcaseCard) -> list[dict[str, str]]:
    return list(card.custom_tiles or [])


async def list_public(db: AsyncSession) -> StoreShowcaseFeedOut:
    configured = bool((await db.execute(select(func.count(StoreShowcaseCard.id)))).scalar_one())
    cards = list(
        (
            await db.execute(
                select(StoreShowcaseCard)
                .where(
                    StoreShowcaseCard.deleted_at.is_(None), StoreShowcaseCard.is_active.is_(True)
                )
                .order_by(StoreShowcaseCard.sort_order, StoreShowcaseCard.id)
                .limit(8)
            )
        )
        .scalars()
        .all()
    )
    items = await _items_by_card(db, [card.id for card in cards])
    output = [
        StoreShowcaseCardPublicOut(
            id=card.id,
            title=card.title,
            description=card.description,
            link_url=card.link_url,
            link_label=card.link_label,
            content_mode=card.content_mode,
            products=[_product_out(product) for product in items.get(card.id, [])],
            custom_tiles=_custom_tiles(card),
        )
        for card in cards
        if (card.content_mode == "PRODUCTS" and items.get(card.id))
        or (card.content_mode == "CUSTOM" and 1 <= len(_custom_tiles(card)) <= 4)
    ]
    return StoreShowcaseFeedOut(configured=configured, cards=output)


async def list_admin(db: AsyncSession) -> list[StoreShowcaseCardOut]:
    cards = list(
        (
            await db.execute(
                select(StoreShowcaseCard)
                .where(StoreShowcaseCard.deleted_at.is_(None))
                .order_by(StoreShowcaseCard.sort_order, StoreShowcaseCard.id)
            )
        )
        .scalars()
        .all()
    )
    items = await _items_by_card(db, [card.id for card in cards])
    return [
        StoreShowcaseCardOut(
            id=card.id,
            title=card.title,
            description=card.description,
            link_url=card.link_url,
            link_label=card.link_label,
            content_mode=card.content_mode,
            products=[_product_out(product) for product in items.get(card.id, [])],
            custom_tiles=_custom_tiles(card),
            product_ids=[product.id for product in items.get(card.id, [])],
            is_active=card.is_active,
            sort_order=card.sort_order,
            created_at=card.created_at,
            updated_at=card.updated_at,
        )
        for card in cards
    ]


async def _get_or_404(db: AsyncSession, card_id: int) -> StoreShowcaseCard:
    card = await db.get(StoreShowcaseCard, card_id)
    if card is None or card.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vitrin kartı bulunamadı.")
    return card


async def _replace_items(db: AsyncSession, card_id: int, product_ids: list[int]) -> None:
    await _products(db, product_ids)
    old_items = list(
        (
            await db.execute(
                select(StoreShowcaseCardItem).where(
                    StoreShowcaseCardItem.card_id == card_id,
                    StoreShowcaseCardItem.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    for item in old_items:
        item.deleted_at = now
    await db.flush()
    for index, product_id in enumerate(product_ids):
        db.add(StoreShowcaseCardItem(card_id=card_id, product_id=product_id, sort_order=index * 10))


async def create(db: AsyncSession, payload: StoreShowcaseCardCreate) -> StoreShowcaseCardOut:
    values = payload.model_dump(exclude={"product_ids"})
    card = StoreShowcaseCard(**values)
    db.add(card)
    await db.flush()
    await _replace_items(db, card.id, payload.product_ids)
    await db.flush()
    return next(row for row in await list_admin(db) if row.id == card.id)


async def _upload_custom_tiles(
    image_bytes: list[bytes], tile_meta: list[StoreShowcaseCustomTileMeta]
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


async def create_custom(
    db: AsyncSession,
    payload: StoreShowcaseCustomCardMeta,
    *,
    image_bytes: list[bytes],
    tile_meta: list[StoreShowcaseCustomTileMeta],
) -> StoreShowcaseCardOut:
    tiles = await _upload_custom_tiles(image_bytes, tile_meta)
    try:
        card = StoreShowcaseCard(**payload.model_dump(), content_mode="CUSTOM", custom_tiles=tiles)
        db.add(card)
        await db.flush()
        return next(row for row in await list_admin(db) if row.id == card.id)
    except Exception:
        await db.rollback()
        for tile in tiles:
            await storage.delete_file(tile["image_url"])
        raise


async def update_custom(
    db: AsyncSession,
    card_id: int,
    payload: StoreShowcaseCustomCardMeta,
    *,
    tile_edits: list[StoreShowcaseCustomTileEdit],
    image_bytes: list[bytes],
) -> tuple[StoreShowcaseCardOut, list[str], list[str]]:
    card = await _get_or_404(db, card_id)
    current = _custom_tiles(card)
    if not 1 <= len(tile_edits) <= 4:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Bir kartta 1 ile 4 arasında görsel olmalı.",
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
            setattr(card, field, value)
        card.custom_tiles = tiles
        card.content_mode = "CUSTOM"
        await db.flush()
        output = next(row for row in await list_admin(db) if row.id == card.id)
        return output, old_urls, uploaded
    except Exception:
        await db.rollback()
        for url in uploaded:
            await storage.delete_file(url)
        raise


async def update(
    db: AsyncSession, card_id: int, payload: StoreShowcaseCardUpdate
) -> StoreShowcaseCardOut:
    card = await _get_or_404(db, card_id)
    changes = payload.model_dump(exclude_unset=True)
    product_ids = changes.pop("product_ids", None)
    for field, value in changes.items():
        if value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} boş olamaz.")
        setattr(card, field, value)
    if product_ids is not None:
        await _replace_items(db, card.id, product_ids)
        card.content_mode = "PRODUCTS"
    await db.flush()
    return next(row for row in await list_admin(db) if row.id == card.id)


async def reorder(db: AsyncSession, ordered_ids: list[int]) -> list[StoreShowcaseCardOut]:
    rows = list(
        (
            await db.execute(
                select(StoreShowcaseCard).where(
                    StoreShowcaseCard.id.in_(ordered_ids), StoreShowcaseCard.deleted_at.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != len(ordered_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sıralanacak kartlardan biri bulunamadı.")
    by_id = {row.id: row for row in rows}
    for index, card_id in enumerate(ordered_ids):
        by_id[card_id].sort_order = index * 10
    await db.flush()
    return await list_admin(db)


async def delete(db: AsyncSession, card_id: int) -> list[str]:
    card = await _get_or_404(db, card_id)
    card.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    card.is_active = False
    await db.flush()
    return [tile.get("image_url", "") for tile in _custom_tiles(card) if tile.get("image_url")]
