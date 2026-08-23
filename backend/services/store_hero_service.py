"""Mağaza hero carousel seçim, yükleme ve yönetim kuralları."""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import storage
from models.store_hero_slide import StoreHeroSlide
from schemas.store_hero_slide import StoreHeroSlideCreate, StoreHeroSlideUpdate


async def list_active(
    db: AsyncSession, *, now: datetime.datetime | None = None
) -> list[StoreHeroSlide]:
    now = now or datetime.datetime.now(datetime.timezone.utc)
    stmt = (
        select(StoreHeroSlide)
        .where(StoreHeroSlide.deleted_at.is_(None))
        .where(StoreHeroSlide.is_active.is_(True))
        .where(or_(StoreHeroSlide.starts_at.is_(None), StoreHeroSlide.starts_at <= now))
        .where(or_(StoreHeroSlide.ends_at.is_(None), StoreHeroSlide.ends_at > now))
        .order_by(StoreHeroSlide.sort_order.asc(), StoreHeroSlide.id.asc())
        .limit(20)
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_admin(db: AsyncSession) -> list[StoreHeroSlide]:
    stmt = (
        select(StoreHeroSlide)
        .where(StoreHeroSlide.deleted_at.is_(None))
        .order_by(StoreHeroSlide.sort_order.asc(), StoreHeroSlide.id.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def _get_or_404(db: AsyncSession, slide_id: int) -> StoreHeroSlide:
    slide = await db.get(StoreHeroSlide, slide_id)
    if slide is None or slide.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vitrin görseli bulunamadı.")
    return slide


def _assert_date_window(
    starts_at: datetime.datetime | None, ends_at: datetime.datetime | None
) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Bitiş tarihi başlangıç tarihinden sonra olmalı.",
        )


async def create(
    db: AsyncSession,
    payload: StoreHeroSlideCreate,
    *,
    image_bytes: bytes,
    mobile_image_bytes: bytes | None = None,
) -> StoreHeroSlide:
    image_url = await storage.upload_store_hero_photo(image_bytes)
    mobile_image_url: str | None = None
    try:
        if mobile_image_bytes is not None:
            mobile_image_url = await storage.upload_store_hero_photo(mobile_image_bytes)
        slide = StoreHeroSlide(
            image_url=image_url,
            mobile_image_url=mobile_image_url,
            **payload.model_dump(),
        )
        db.add(slide)
        await db.flush()
        await db.refresh(slide)
        return slide
    except Exception:
        await db.rollback()
        await storage.delete_file(image_url)
        if mobile_image_url:
            await storage.delete_file(mobile_image_url)
        raise


async def update(
    db: AsyncSession, slide_id: int, payload: StoreHeroSlideUpdate
) -> StoreHeroSlide:
    slide = await _get_or_404(db, slide_id)
    changes = payload.model_dump(exclude_unset=True)
    starts_at = changes.get("starts_at", slide.starts_at)
    ends_at = changes.get("ends_at", slide.ends_at)
    _assert_date_window(starts_at, ends_at)
    for field, value in changes.items():
        setattr(slide, field, value)
    await db.flush()
    await db.refresh(slide)
    return slide


async def replace_image(
    db: AsyncSession,
    slide_id: int,
    *,
    slot: str,
    image_bytes: bytes,
) -> tuple[StoreHeroSlide, str | None]:
    slide = await _get_or_404(db, slide_id)
    new_url = await storage.upload_store_hero_photo(image_bytes)
    field = "mobile_image_url" if slot == "mobile" else "image_url"
    old_url = getattr(slide, field)
    try:
        setattr(slide, field, new_url)
        await db.flush()
        await db.refresh(slide)
    except Exception:
        await db.rollback()
        await storage.delete_file(new_url)
        raise
    return slide, old_url


async def clear_mobile_image(
    db: AsyncSession, slide_id: int
) -> tuple[StoreHeroSlide, str | None]:
    slide = await _get_or_404(db, slide_id)
    old_url = slide.mobile_image_url
    slide.mobile_image_url = None
    await db.flush()
    await db.refresh(slide)
    return slide, old_url


async def reorder(db: AsyncSession, ordered_ids: list[int]) -> list[StoreHeroSlide]:
    stmt = select(StoreHeroSlide).where(
        StoreHeroSlide.id.in_(ordered_ids), StoreHeroSlide.deleted_at.is_(None)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    if len(rows) != len(ordered_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sıralanacak görsellerden biri bulunamadı.")
    by_id = {row.id: row for row in rows}
    for index, slide_id in enumerate(ordered_ids):
        by_id[slide_id].sort_order = index * 10
    await db.flush()
    return await list_admin(db)


async def delete(db: AsyncSession, slide_id: int) -> tuple[str, str | None]:
    slide = await _get_or_404(db, slide_id)
    slide.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    slide.is_active = False
    await db.flush()
    return slide.image_url, slide.mobile_image_url
