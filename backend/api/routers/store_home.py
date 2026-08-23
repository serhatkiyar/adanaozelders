"""Mağaza ana sayfa akışı public okuma ve admin yönetim uçları."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, user_rate_limit
from core import storage
from core.database import get_db
from models.admin import Admin
from schemas.store_home_section import (
    StoreHomeFeedOut,
    StoreHomeImageTileEdit,
    StoreHomeImageTileMeta,
    StoreHomeProductSectionWrite,
    StoreHomeRecentlyViewedUpdate,
    StoreHomeSectionMeta,
    StoreHomeSectionOut,
    StoreHomeSectionReorder,
)
from services import audit_service, store_home_service


router = APIRouter(prefix="/store/home-sections", tags=["store-home"])
admin_router = APIRouter(prefix="/admin/store-home-sections", tags=["admin-store-home"])
_write_rate_limit = user_rate_limit(key="store-home-write", limit=60, window_seconds=3600)
_tile_meta_adapter = TypeAdapter(list[StoreHomeImageTileMeta])
_tile_edit_adapter = TypeAdapter(list[StoreHomeImageTileEdit])
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


async def _read_image(file: UploadFile) -> bytes:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Yalnızca görsel yüklenebilir.")
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


def _parse_tile_meta(value: str) -> list[StoreHomeImageTileMeta]:
    try:
        return _tile_meta_adapter.validate_json(value)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Görsel bağlantıları veya açıklamaları geçersiz.",
        ) from exc


def _parse_tile_edits(value: str) -> list[StoreHomeImageTileEdit]:
    try:
        return _tile_edit_adapter.validate_json(value)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Görsel kaynakları, bağlantıları veya açıklamaları geçersiz.",
        ) from exc


@router.get("", response_model=StoreHomeFeedOut)
async def list_public_sections(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return await store_home_service.list_public(db)


@admin_router.get("", response_model=list[StoreHomeSectionOut])
async def list_admin_sections(
    _admin: Admin = Depends(require_admin_permission("announcements.view")),
    db: AsyncSession = Depends(get_db),
):
    return await store_home_service.list_admin(db)


@admin_router.post(
    "/products", response_model=StoreHomeSectionOut, status_code=status.HTTP_201_CREATED
)
async def create_product_section(
    payload: StoreHomeProductSectionWrite,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    section = await store_home_service.create_product(db, payload)
    await audit_service.record(
        db,
        actor=admin,
        action="store_home.create_product",
        target_type="store_home_section",
        target_id=section.id,
    )
    await db.commit()
    return section


@admin_router.put("/{section_id}/products", response_model=StoreHomeSectionOut)
async def update_product_section(
    section_id: int,
    payload: StoreHomeProductSectionWrite,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    section = await store_home_service.update_product(db, section_id, payload)
    await audit_service.record(
        db,
        actor=admin,
        action="store_home.update_product",
        target_type="store_home_section",
        target_id=section_id,
    )
    await db.commit()
    return section


@admin_router.patch("/{section_id}/recently-viewed", response_model=StoreHomeSectionOut)
async def update_recently_viewed_section(
    section_id: int,
    payload: StoreHomeRecentlyViewedUpdate,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    section = await store_home_service.update_recently_viewed(
        db, section_id, is_active=payload.is_active
    )
    await audit_service.record(
        db,
        actor=admin,
        action="store_home.update_recently_viewed",
        target_type="store_home_section",
        target_id=section_id,
    )
    await db.commit()
    return section


@admin_router.post(
    "/images", response_model=StoreHomeSectionOut, status_code=status.HTTP_201_CREATED
)
async def create_image_section(
    images: list[UploadFile] = File(...),
    tiles_json: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    link_url: str = Form(""),
    link_label: str = Form("Tümünü gör"),
    is_active: bool = Form(False),
    sort_order: int = Form(0),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    payload = StoreHomeSectionMeta(
        title=title,
        description=description,
        link_url=link_url or None,
        link_label=link_label,
        is_active=is_active,
        sort_order=sort_order,
    )
    section = await store_home_service.create_images(
        db,
        payload,
        image_bytes=[await _read_image(image) for image in images],
        tile_meta=_parse_tile_meta(tiles_json),
    )
    try:
        await audit_service.record(
            db,
            actor=admin,
            action="store_home.create_images",
            target_type="store_home_section",
            target_id=section.id,
        )
    except Exception:
        await db.rollback()
        for tile in section.image_tiles:
            await storage.delete_file(tile.image_url)
        raise
    await db.commit()
    return section


@admin_router.put("/{section_id}/images", response_model=StoreHomeSectionOut)
async def update_image_section(
    section_id: int,
    images: list[UploadFile] | None = File(None),
    tiles_json: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    link_url: str = Form(""),
    link_label: str = Form("Tümünü gör"),
    is_active: bool = Form(False),
    sort_order: int = Form(0),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    payload = StoreHomeSectionMeta(
        title=title,
        description=description,
        link_url=link_url or None,
        link_label=link_label,
        is_active=is_active,
        sort_order=sort_order,
    )
    uploads = images or []
    section, old_urls, new_urls = await store_home_service.update_images(
        db,
        section_id,
        payload,
        image_bytes=[await _read_image(image) for image in uploads],
        tile_edits=_parse_tile_edits(tiles_json),
    )
    try:
        await audit_service.record(
            db,
            actor=admin,
            action="store_home.update_images",
            target_type="store_home_section",
            target_id=section_id,
        )
    except Exception:
        await db.rollback()
        for url in new_urls:
            await storage.delete_file(url)
        raise
    await db.commit()
    for url in old_urls:
        await storage.delete_file(url)
    return section


@admin_router.patch("/reorder", response_model=list[StoreHomeSectionOut])
async def reorder_sections(
    payload: StoreHomeSectionReorder,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    sections = await store_home_service.reorder(db, payload.ordered_ids)
    await audit_service.record(
        db,
        actor=admin,
        action="store_home.reorder",
        target_type="store_home_section",
    )
    await db.commit()
    return sections


@admin_router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    section_id: int,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    image_urls = await store_home_service.delete(db, section_id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_home.delete",
        target_type="store_home_section",
        target_id=section_id,
    )
    await db.commit()
    for url in image_urls:
        await storage.delete_file(url)
