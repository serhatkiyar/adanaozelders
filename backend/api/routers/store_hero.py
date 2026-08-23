"""Mağaza hero carousel public okuma ve admin yönetim uçları."""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, user_rate_limit
from core import storage
from core.database import get_db
from models.admin import Admin
from schemas.store_hero_slide import (
    StoreHeroSlideCreate,
    StoreHeroSlideOut,
    StoreHeroSlidePublicOut,
    StoreHeroSlideReorder,
    StoreHeroSlideUpdate,
)
from services import audit_service, store_hero_service


router = APIRouter(prefix="/store/hero-slides", tags=["store-hero"])
admin_router = APIRouter(prefix="/admin/store-hero-slides", tags=["admin-store-hero"])

_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_write_rate_limit = user_rate_limit(key="store-hero-write", limit=30, window_seconds=3600)


async def _read_image(file: UploadFile) -> bytes:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
    # MAX+1 ile oku: Python heap'ine sınırsız gövde kopyalamadan sınırı uygula.
    # Üretim proxy'sinde ayrıca 12 MB request-body sınırı bulunmalıdır.
    data = await file.read(_MAX_IMAGE_BYTES + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Görsel 12 MB sınırını aşıyor.")
    try:
        await storage.validate_store_hero_photo(data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return data


@router.get("", response_model=list[StoreHeroSlidePublicOut])
async def list_public_slides(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return await store_hero_service.list_active(db)


@admin_router.get("", response_model=list[StoreHeroSlideOut])
async def list_admin_slides(
    _admin: Admin = Depends(require_admin_permission("announcements.view")),
    db: AsyncSession = Depends(get_db),
):
    return await store_hero_service.list_admin(db)


@admin_router.post("", response_model=StoreHeroSlideOut, status_code=status.HTTP_201_CREATED)
async def create_slide(
    image: UploadFile = File(...),
    mobile_image: UploadFile | None = File(None),
    alt_text: str = Form(""),
    link_url: str | None = Form(None),
    is_active: bool = Form(False),
    starts_at: datetime.datetime | None = Form(None),
    ends_at: datetime.datetime | None = Form(None),
    sort_order: int = Form(0),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    payload = StoreHeroSlideCreate(
        alt_text=alt_text,
        link_url=link_url,
        is_active=is_active,
        starts_at=starts_at,
        ends_at=ends_at,
        sort_order=sort_order,
    )
    slide = await store_hero_service.create(
        db,
        payload,
        image_bytes=await _read_image(image),
        mobile_image_bytes=await _read_image(mobile_image) if mobile_image else None,
    )
    try:
        await audit_service.record(
            db, actor=admin, action="store_hero.create", target_type="store_hero_slide", target_id=slide.id
        )
    except Exception:
        await db.rollback()
        await storage.delete_file(slide.image_url)
        if slide.mobile_image_url:
            await storage.delete_file(slide.mobile_image_url)
        raise
    # Commit sonucu bağlantı kopmasında belirsiz olabilir. Bu nedenle commit
    # hatasında objeyi anında silmeyiz; DB commit olmuşsa canlı URL'yi kırardı.
    await db.commit()
    return slide


@admin_router.patch("/reorder", response_model=list[StoreHeroSlideOut])
async def reorder_slides(
    payload: StoreHeroSlideReorder,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    slides = await store_hero_service.reorder(db, payload.ordered_ids)
    await audit_service.record(
        db, actor=admin, action="store_hero.reorder", target_type="store_hero_slide"
    )
    await db.commit()
    return slides


@admin_router.patch("/{slide_id}", response_model=StoreHeroSlideOut)
async def update_slide(
    slide_id: int,
    payload: StoreHeroSlideUpdate,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    slide = await store_hero_service.update(db, slide_id, payload)
    await audit_service.record(
        db, actor=admin, action="store_hero.update", target_type="store_hero_slide", target_id=slide_id
    )
    await db.commit()
    return slide


@admin_router.post("/{slide_id}/image", response_model=StoreHeroSlideOut)
async def replace_slide_image(
    slide_id: int,
    file: UploadFile = File(...),
    slot: str = Query("desktop", pattern="^(desktop|mobile)$"),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    slide, old_url = await store_hero_service.replace_image(
        db, slide_id, slot=slot, image_bytes=await _read_image(file)
    )
    new_url = slide.mobile_image_url if slot == "mobile" else slide.image_url
    try:
        await audit_service.record(
            db,
            actor=admin,
            action=f"store_hero.replace_{slot}_image",
            target_type="store_hero_slide",
            target_id=slide_id,
        )
    except Exception:
        await db.rollback()
        if new_url:
            await storage.delete_file(new_url)
        raise
    # Commit belirsizliği durumunda new_url'yi silme; yukarıdaki açıklama.
    await db.commit()
    if old_url:
        await storage.delete_file(old_url)
    return slide


@admin_router.delete("/{slide_id}/mobile-image", response_model=StoreHeroSlideOut)
async def clear_mobile_image(
    slide_id: int,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    slide, old_url = await store_hero_service.clear_mobile_image(db, slide_id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_hero.clear_mobile_image",
        target_type="store_hero_slide",
        target_id=slide_id,
    )
    await db.commit()
    if old_url:
        await storage.delete_file(old_url)
    return slide


@admin_router.delete("/{slide_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_slide(
    slide_id: int,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    image_url, mobile_image_url = await store_hero_service.delete(db, slide_id)
    await audit_service.record(
        db, actor=admin, action="store_hero.delete", target_type="store_hero_slide", target_id=slide_id
    )
    await db.commit()
    await storage.delete_file(image_url)
    if mobile_image_url:
        await storage.delete_file(mobile_image_url)
