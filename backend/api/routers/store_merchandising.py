"""Mağaza yönetiminin KALAN uçları: ürün öznitelikleri + medya kütüphanesi.

MANUEL VİTRİN KARARI (28 Ağu 2026): landing page / koleksiyon / yayın /
metrik uçları SÖKÜLDÜ — vitrin frontend'de kod olarak yaşar. Kalanlar:
  • public `GET /store/attributes` (ürün filtreleri),
  • admin öznitelik CRUD'u + ürüne öznitelik atama (`products.*`),
  • admin medya listeleme/yükleme (`content.*` — blog kapak görselleri).
"""

from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, user_rate_limit
from core import storage
from core.database import get_db
from models import ProductAttributeAssignment, StoreMediaAsset
from models.admin import Admin
from schemas.store_merchandising import (
    AttributeDefinitionOut,
    AttributeDefinitionWrite,
    AttributeValueOut,
    AttributeValueWrite,
    MediaAssetOut,
    ProductAttributeAssignmentWrite,
)
from services import audit_service, store_merchandising_service as service

public_router = APIRouter(prefix="/store", tags=["store-pages"])
admin_router = APIRouter(prefix="/admin/store-merchandising", tags=["admin-store-pages"])
_write_limit = user_rate_limit(key="store-merchandising-write", limit=120, window_seconds=3600)
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


@public_router.get("/attributes", response_model=list[AttributeDefinitionOut])
async def public_attributes(db: AsyncSession = Depends(get_db)):
    return await service.list_attributes(db, include_inactive=False)


@admin_router.get("/attributes", response_model=list[AttributeDefinitionOut])
async def admin_attributes(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_attributes(db, include_inactive=True)


@admin_router.post("/attributes", response_model=AttributeDefinitionOut, status_code=201)
async def create_attribute(
    payload: AttributeDefinitionWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    definition = await service.create_attribute(db, payload)
    await audit_service.record(db, actor=admin, action="store_attribute.create", target_type="attribute", target_id=definition.id)
    await db.commit()
    return AttributeDefinitionOut(
        id=definition.id, name=definition.name, slug=definition.slug,
        sort_order=definition.sort_order, is_active=definition.is_active, values=[],
    )


@admin_router.put("/attributes/{definition_id}", response_model=AttributeDefinitionOut)
async def update_attribute(
    definition_id: int,
    payload: AttributeDefinitionWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    definition = await service.update_attribute(db, definition_id, payload)
    await audit_service.record(db, actor=admin, action="store_attribute.update", target_type="attribute", target_id=definition_id)
    await db.commit()
    return AttributeDefinitionOut(
        id=definition.id, name=definition.name, slug=definition.slug,
        sort_order=definition.sort_order, is_active=definition.is_active, values=[],
    )


@admin_router.post("/attributes/{definition_id}/values", response_model=AttributeValueOut, status_code=201)
async def create_attribute_value(
    definition_id: int,
    payload: AttributeValueWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    value = await service.create_attribute_value(db, definition_id, payload)
    await audit_service.record(db, actor=admin, action="store_attribute.value.create", target_type="attribute_value", target_id=value.id)
    await db.commit()
    return AttributeValueOut.model_validate(value)


@admin_router.put("/products/{product_id}/attributes", status_code=204)
async def set_product_attributes(
    product_id: int,
    payload: ProductAttributeAssignmentWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.set_product_attributes(db, product_id, payload.value_ids)
    await audit_service.record(db, actor=admin, action="product.attributes.set", target_type="product", target_id=product_id)
    await db.commit()


@admin_router.get(
    "/products/{product_id}/attributes", response_model=ProductAttributeAssignmentWrite
)
async def get_product_attributes(
    product_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    value_ids = list((await db.execute(select(ProductAttributeAssignment.value_id).where(
        ProductAttributeAssignment.product_id == product_id,
        ProductAttributeAssignment.deleted_at.is_(None),
    ))).scalars().all())
    return ProductAttributeAssignmentWrite(value_ids=value_ids)


@admin_router.get("/media", response_model=list[MediaAssetOut])
async def list_media(
    _admin: Admin = Depends(require_admin_permission("content.view")),
    db: AsyncSession = Depends(get_db),
):
    return list((await db.execute(select(StoreMediaAsset).where(
        StoreMediaAsset.deleted_at.is_(None)
    ).order_by(StoreMediaAsset.created_at.desc()).limit(200))).scalars().all())


@admin_router.post("/media", response_model=MediaAssetOut, status_code=201)
async def upload_media(
    image: UploadFile = File(...),
    alt_text: str = Form(""),
    admin: Admin = Depends(require_admin_permission("content.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    data = await image.read(_MAX_IMAGE_BYTES + 1)
    if not data or len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "Görsel boş veya 12 MB sınırını aşıyor.")
    try:
        await storage.validate_store_hero_photo(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    url = await storage.upload_store_hero_photo(data)
    try:
        with Image.open(io.BytesIO(data)) as parsed:
            width, height = parsed.size
        asset = StoreMediaAsset(
            image_url=url, alt_text=alt_text.strip()[:180], mime_type="image/webp",
            width=width, height=height, file_size=len(data),
            created_by_admin_id=admin.id,
        )
        db.add(asset)
        await db.flush()
        await audit_service.record(db, actor=admin, action="store_media.upload", target_type="store_media", target_id=asset.id)
    except Exception:
        # Commit ÖNCESİ net başarısızlık: yüklenen dosya telafiyle silinir.
        await storage.delete_file(url)
        raise
    # Commit belirsizliğinde (ağ kopması vb.) dosya SİLİNMEZ — satır yazılmış
    # olabilir; yetim dosya yetim satırdan ucuzdur.
    await db.commit()
    return asset
