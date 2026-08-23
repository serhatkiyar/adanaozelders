"""Mağaza vitrin kartları public okuma ve admin yönetim uçları."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, user_rate_limit
from core import storage
from core.database import get_db
from models.admin import Admin
from schemas.store_showcase_card import (
    StoreShowcaseCardCreate,
    StoreShowcaseCustomCardMeta,
    StoreShowcaseCustomTileEdit,
    StoreShowcaseCustomTileMeta,
    StoreShowcaseCardOut,
    StoreShowcaseCardReorder,
    StoreShowcaseCardUpdate,
    StoreShowcaseFeedOut,
)
from services import audit_service, store_showcase_service


router = APIRouter(prefix="/store/showcase-cards", tags=["store-showcase"])
admin_router = APIRouter(prefix="/admin/store-showcase-cards", tags=["admin-store-showcase"])
_write_rate_limit = user_rate_limit(key="store-showcase-write", limit=60, window_seconds=3600)
_tile_meta_adapter = TypeAdapter(list[StoreShowcaseCustomTileMeta])
_tile_edit_adapter = TypeAdapter(list[StoreShowcaseCustomTileEdit])
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


def _parse_tile_meta(value: str) -> list[StoreShowcaseCustomTileMeta]:
    try:
        return _tile_meta_adapter.validate_json(value)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Görsel bağlantıları veya etiketleri geçersiz.",
        ) from exc


def _parse_tile_edits(value: str) -> list[StoreShowcaseCustomTileEdit]:
    try:
        return _tile_edit_adapter.validate_json(value)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Görsel kaynakları, bağlantıları veya açıklamaları geçersiz.",
        ) from exc


@router.get("", response_model=StoreShowcaseFeedOut)
async def list_public_cards(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return await store_showcase_service.list_public(db)


@admin_router.get("", response_model=list[StoreShowcaseCardOut])
async def list_admin_cards(
    _admin: Admin = Depends(require_admin_permission("announcements.view")),
    db: AsyncSession = Depends(get_db),
):
    return await store_showcase_service.list_admin(db)


@admin_router.post("", response_model=StoreShowcaseCardOut, status_code=status.HTTP_201_CREATED)
async def create_card(
    payload: StoreShowcaseCardCreate,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    card = await store_showcase_service.create(db, payload)
    await audit_service.record(
        db,
        actor=admin,
        action="store_showcase.create",
        target_type="store_showcase_card",
        target_id=card.id,
    )
    await db.commit()
    return card


@admin_router.post(
    "/custom", response_model=StoreShowcaseCardOut, status_code=status.HTTP_201_CREATED
)
async def create_custom_card(
    images: list[UploadFile] = File(...),
    tiles_json: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    link_url: str = Form(...),
    link_label: str = Form("Keşfet"),
    is_active: bool = Form(False),
    sort_order: int = Form(0),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    payload = StoreShowcaseCustomCardMeta(
        title=title,
        description=description,
        link_url=link_url,
        link_label=link_label,
        is_active=is_active,
        sort_order=sort_order,
    )
    card = await store_showcase_service.create_custom(
        db,
        payload,
        image_bytes=[await _read_image(image) for image in images],
        tile_meta=_parse_tile_meta(tiles_json),
    )
    try:
        await audit_service.record(
            db,
            actor=admin,
            action="store_showcase.create_custom",
            target_type="store_showcase_card",
            target_id=card.id,
        )
    except Exception:
        await db.rollback()
        for tile in card.custom_tiles:
            await storage.delete_file(tile.image_url)
        raise
    await db.commit()
    return card


@admin_router.patch("/reorder", response_model=list[StoreShowcaseCardOut])
async def reorder_cards(
    payload: StoreShowcaseCardReorder,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    cards = await store_showcase_service.reorder(db, payload.ordered_ids)
    await audit_service.record(
        db, actor=admin, action="store_showcase.reorder", target_type="store_showcase_card"
    )
    await db.commit()
    return cards


@admin_router.patch("/{card_id}", response_model=StoreShowcaseCardOut)
async def update_card(
    card_id: int,
    payload: StoreShowcaseCardUpdate,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    card = await store_showcase_service.update(db, card_id, payload)
    await audit_service.record(
        db,
        actor=admin,
        action="store_showcase.update",
        target_type="store_showcase_card",
        target_id=card_id,
    )
    await db.commit()
    return card


@admin_router.put("/{card_id}/custom", response_model=StoreShowcaseCardOut)
async def update_custom_card(
    card_id: int,
    images: list[UploadFile] | None = File(None),
    tiles_json: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    link_url: str = Form(...),
    link_label: str = Form("Keşfet"),
    is_active: bool = Form(False),
    sort_order: int = Form(0),
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    payload = StoreShowcaseCustomCardMeta(
        title=title,
        description=description,
        link_url=link_url,
        link_label=link_label,
        is_active=is_active,
        sort_order=sort_order,
    )
    uploads = images or []
    card, old_urls, new_urls = await store_showcase_service.update_custom(
        db,
        card_id,
        payload,
        image_bytes=[await _read_image(image) for image in uploads],
        tile_edits=_parse_tile_edits(tiles_json),
    )
    try:
        await audit_service.record(
            db,
            actor=admin,
            action="store_showcase.update_custom",
            target_type="store_showcase_card",
            target_id=card_id,
        )
    except Exception:
        await db.rollback()
        for url in new_urls:
            await storage.delete_file(url)
        raise
    await db.commit()
    for url in old_urls:
        await storage.delete_file(url)
    return card


@admin_router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    card_id: int,
    admin: Admin = Depends(require_admin_permission("announcements.manage")),
    _limited: None = Depends(_write_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    image_urls = await store_showcase_service.delete(db, card_id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_showcase.delete",
        target_type="store_showcase_card",
        target_id=card_id,
    )
    await db.commit()
    for url in image_urls:
        await storage.delete_file(url)
