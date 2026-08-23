"""Public vitrin sayfaları ile admin mağaza düzenleme uçları."""

from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.deps import require_admin_permission, user_rate_limit
from core import storage
from core.database import get_db
from core.ratelimit import rate_limit
from models import StoreLandingPage, StoreLandingPageRevision, StoreMediaAsset
from models import ProductAttributeAssignment
from models.admin import Admin
from schemas.store_merchandising import (
    AttributeDefinitionOut,
    AttributeDefinitionWrite,
    AttributeValueOut,
    AttributeValueWrite,
    LandingPageCreate,
    LandingPageDuplicateIn,
    LandingPageIdentityUpdate,
    LandingPageOut,
    LandingPagePublicationOut,
    LandingPagePublicationUpdate,
    LandingPagePublishIn,
    LandingPageRevisionOut,
    LandingPageRevisionWrite,
    LandingPageSummaryOut,
    MediaAssetOut,
    ProductAttributeAssignmentWrite,
    ProductSetOut,
    ProductSetWrite,
    StorePageEventIn,
    StorePageEventOut,
    StorePageMetricOut,
)
from services import audit_service, store_merchandising_service as service


public_router = APIRouter(prefix="/store", tags=["store-pages"])
admin_router = APIRouter(prefix="/admin/store-merchandising", tags=["admin-store-pages"])
_write_limit = user_rate_limit(key="store-merchandising-write", limit=120, window_seconds=3600)
_event_limit = rate_limit(key="store-merchandising-event", limit=240, window_seconds=3600)
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


@public_router.get("/attributes", response_model=list[AttributeDefinitionOut])
async def public_attributes(db: AsyncSession = Depends(get_db)):
    return await service.list_attributes(db, include_inactive=False)


@public_router.get("/home", response_model=LandingPageOut)
async def public_home(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return await service.get_home(db)


@public_router.get("/pages/{slug}", response_model=LandingPageOut)
async def public_page(slug: str, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return await service.get_page(db, slug)


@public_router.post(
    "/page-revisions/{revision_id}/events", response_model=StorePageEventOut
)
async def record_page_event(
    revision_id: int,
    payload: StorePageEventIn,
    _limited: None = Depends(_event_limit),
    db: AsyncSession = Depends(get_db),
):
    token = await service.record_event(db, revision_id, payload)
    await db.commit()
    return StorePageEventOut(attribution_token=token)


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
    await audit_service.record(db, actor=admin, action="store_attribute.create", target_type="product_attribute", target_id=definition.id)
    await db.commit()
    rows = await service.list_attributes(db, include_inactive=True)
    return next(row for row in rows if row.id == definition.id)


@admin_router.put("/attributes/{definition_id}", response_model=AttributeDefinitionOut)
async def update_attribute(
    definition_id: int,
    payload: AttributeDefinitionWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    definition = await service.update_attribute(db, definition_id, payload)
    await audit_service.record(db, actor=admin, action="store_attribute.update", target_type="product_attribute", target_id=definition.id)
    await db.commit()
    rows = await service.list_attributes(db, include_inactive=True)
    return next(row for row in rows if row.id == definition.id)


@admin_router.post("/attributes/{definition_id}/values", response_model=AttributeValueOut, status_code=201)
async def create_attribute_value(
    definition_id: int,
    payload: AttributeValueWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    value = await service.create_attribute_value(db, definition_id, payload)
    await audit_service.record(db, actor=admin, action="store_attribute_value.create", target_type="product_attribute_value", target_id=value.id)
    await db.commit()
    await db.refresh(value)
    return value


@admin_router.put("/products/{product_id}/attributes", status_code=204)
async def set_product_attributes(
    product_id: int,
    payload: ProductAttributeAssignmentWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.set_product_attributes(db, product_id, payload.value_ids)
    await audit_service.record(db, actor=admin, action="store_product.attributes", target_type="product", target_id=product_id, after={"value_ids": payload.value_ids})
    await db.commit()


@admin_router.get(
    "/products/{product_id}/attributes",
    response_model=ProductAttributeAssignmentWrite,
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


@admin_router.get("/product-sets", response_model=list[ProductSetOut])
async def list_product_sets(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_product_sets(db)


@admin_router.post("/product-sets", response_model=ProductSetOut, status_code=201)
async def create_product_set(
    payload: ProductSetWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    result = await service.create_product_set(db, payload, admin.id)
    await audit_service.record(db, actor=admin, action="store_product_set.create", target_type="product_set", target_id=result.id)
    await db.commit()
    return result


@admin_router.put("/product-sets/{product_set_id}", response_model=ProductSetOut)
async def revise_product_set(
    product_set_id: int,
    payload: ProductSetWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    result = await service.revise_product_set(db, product_set_id, payload, admin.id)
    await audit_service.record(db, actor=admin, action="store_product_set.revise", target_type="product_set", target_id=product_set_id)
    await db.commit()
    return result


@admin_router.post("/product-sets/{product_set_id}/publish", response_model=ProductSetOut)
async def publish_product_set(
    product_set_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    result = await service.publish_product_set(db, product_set_id, admin.id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_product_set.publish",
        target_type="product_set",
        target_id=product_set_id,
    )
    await db.commit()
    return result


@admin_router.get("/pages", response_model=list[LandingPageSummaryOut])
async def list_pages(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_pages(db)


@admin_router.post("/pages", response_model=LandingPageSummaryOut, status_code=201)
async def create_page(
    payload: LandingPageCreate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    page = await service.create_page(db, payload, admin.id)
    await audit_service.record(db, actor=admin, action="store_page.create", target_type="store_landing_page", target_id=page.id)
    await db.commit()
    return next(row for row in await service.list_pages(db) if row.id == page.id)


@admin_router.patch("/pages/{page_id}", response_model=LandingPageSummaryOut)
async def update_page_identity(
    page_id: int,
    payload: LandingPageIdentityUpdate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    page = await db.get(StoreLandingPage, page_id)
    if page is None or page.deleted_at is not None:
        raise HTTPException(404, "Vitrin sayfası bulunamadı.")
    await service.rename_page(db, page, **payload.model_dump(exclude_unset=True))
    await audit_service.record(db, actor=admin, action="store_page.identity", target_type="store_landing_page", target_id=page.id, after=payload.model_dump(exclude_unset=True))
    await db.commit()
    return next(row for row in await service.list_pages(db) if row.id == page.id)


@admin_router.post("/pages/{page_id}/drafts", response_model=LandingPageRevisionOut, status_code=201)
async def save_page_draft(
    page_id: int,
    payload: LandingPageRevisionWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    revision = await service.save_page_draft(db, page_id, payload, admin.id)
    await audit_service.record(db, actor=admin, action="store_page.draft", target_type="store_landing_page_revision", target_id=revision.id)
    await db.commit()
    revision = (await db.execute(select(StoreLandingPageRevision).options(selectinload(StoreLandingPageRevision.blocks)).where(StoreLandingPageRevision.id == revision.id))).scalar_one()
    return await service._revision_out(db, revision)


@admin_router.put("/pages/{page_id}/draft", response_model=LandingPageRevisionOut)
async def upsert_page_draft(
    page_id: int,
    payload: LandingPageRevisionWrite,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    revision = await service.save_page_draft(db, page_id, payload, admin.id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_page.draft",
        target_type="store_landing_page_revision",
        target_id=revision.id,
    )
    await db.commit()
    revision = (await db.execute(select(StoreLandingPageRevision).options(
        selectinload(StoreLandingPageRevision.blocks)
    ).where(StoreLandingPageRevision.id == revision.id))).scalar_one()
    return await service._revision_out(db, revision)


@admin_router.get("/pages/{page_id}/revisions", response_model=list[LandingPageRevisionOut])
async def list_page_revisions(
    page_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    revisions = list((await db.execute(select(StoreLandingPageRevision).options(
        selectinload(StoreLandingPageRevision.blocks)
    ).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
    ).order_by(StoreLandingPageRevision.version.desc()))).scalars().unique().all())
    return [await service._revision_out(db, revision) for revision in revisions]


@admin_router.post("/pages/{page_id}/revisions/{revision_id}/publish", response_model=LandingPageSummaryOut)
async def publish_page(
    page_id: int,
    revision_id: int,
    payload: LandingPagePublishIn,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.publish_page(db, page_id, revision_id, payload, admin.id)
    await audit_service.record(db, actor=admin, action="store_page.publish", target_type="store_landing_page_revision", target_id=revision_id, after=payload.model_dump(mode="json"))
    await db.commit()
    return next(row for row in await service.list_pages(db) if row.id == page_id)


@admin_router.post("/pages/{page_id}/publish", response_model=LandingPageSummaryOut)
async def publish_latest_page_draft(
    page_id: int,
    payload: LandingPagePublishIn,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    revision_id = (await db.execute(select(StoreLandingPageRevision.id).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
        StoreLandingPageRevision.status == "DRAFT",
    ).order_by(StoreLandingPageRevision.version.desc()).limit(1))).scalar_one_or_none()
    if revision_id is None:
        raise HTTPException(409, "Yayınlanacak kaydedilmiş bir taslak yok.")
    await service.publish_page(db, page_id, revision_id, payload, admin.id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_page.publish",
        target_type="store_landing_page_revision",
        target_id=revision_id,
        after=payload.model_dump(mode="json"),
    )
    await db.commit()
    return next(row for row in await service.list_pages(db) if row.id == page_id)


@admin_router.post("/pages/{page_id}/duplicate", response_model=LandingPageSummaryOut, status_code=201)
async def duplicate_page(
    page_id: int,
    payload: LandingPageDuplicateIn,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    page = await service.duplicate_page(db, page_id, payload, admin.id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_page.duplicate",
        target_type="store_landing_page",
        target_id=page.id,
        after={"source_page_id": page_id},
    )
    await db.commit()
    return next(row for row in await service.list_pages(db) if row.id == page.id)


@admin_router.get(
    "/pages/{page_id}/publications",
    response_model=list[LandingPagePublicationOut],
)
async def list_publications(
    page_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_publications(db, page_id)


@admin_router.patch(
    "/pages/{page_id}/publications/{publication_id}",
    response_model=LandingPagePublicationOut,
)
async def reschedule_publication(
    page_id: int,
    publication_id: int,
    payload: LandingPagePublicationUpdate,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    row = await service.reschedule_publication(db, page_id, publication_id, payload)
    await audit_service.record(
        db,
        actor=admin,
        action="store_page.schedule.update",
        target_type="store_landing_page_publication",
        target_id=publication_id,
        after=payload.model_dump(mode="json"),
    )
    await db.commit()
    return LandingPagePublicationOut(
        id=row.id,
        page_id=row.page_id,
        revision_id=row.revision_id,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        state=service._publication_state(row),
    )


@admin_router.delete(
    "/pages/{page_id}/publications/{publication_id}",
    status_code=204,
)
async def cancel_publication(
    page_id: int,
    publication_id: int,
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    await service.cancel_publication(db, page_id, publication_id)
    await audit_service.record(
        db,
        actor=admin,
        action="store_page.schedule.cancel",
        target_type="store_landing_page_publication",
        target_id=publication_id,
    )
    await db.commit()


@admin_router.get("/pages/{page_id}/preview/{revision_id}", response_model=LandingPageOut)
async def preview_page(
    page_id: int,
    revision_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    page = await db.get(StoreLandingPage, page_id)
    if page is None or page.deleted_at is not None:
        raise HTTPException(404, "Vitrin sayfası bulunamadı.")
    return await service.get_page(db, page.slug, preview_revision_id=revision_id)


@admin_router.get("/pages/{page_id}/preview", response_model=LandingPageOut)
async def preview_latest_draft(
    page_id: int,
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    page = await db.get(StoreLandingPage, page_id)
    if page is None or page.deleted_at is not None:
        raise HTTPException(404, "Mağaza sayfası bulunamadı.")
    revision_id = (await db.execute(select(StoreLandingPageRevision.id).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
    ).order_by(
        (StoreLandingPageRevision.status == "DRAFT").desc(),
        StoreLandingPageRevision.version.desc(),
    ).limit(1))).scalar_one()
    if page.page_type == "HOME":
        return await service.get_home(db, preview_revision_id=revision_id)
    return await service.get_page(db, page.slug, preview_revision_id=revision_id)


@admin_router.get("/metrics", response_model=list[StorePageMetricOut])
async def page_metrics(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return await service.metrics(db)


@admin_router.get("/media", response_model=list[MediaAssetOut])
async def list_media(
    _admin: Admin = Depends(require_admin_permission("products.view")),
    db: AsyncSession = Depends(get_db),
):
    return list((await db.execute(select(StoreMediaAsset).where(
        StoreMediaAsset.deleted_at.is_(None)
    ).order_by(StoreMediaAsset.created_at.desc()).limit(200))).scalars().all())


@admin_router.post("/media", response_model=MediaAssetOut, status_code=201)
async def upload_media(
    image: UploadFile = File(...),
    alt_text: str = Form(""),
    admin: Admin = Depends(require_admin_permission("products.manage")),
    _limited: None = Depends(_write_limit),
    db: AsyncSession = Depends(get_db),
):
    data = await image.read(_MAX_IMAGE_BYTES + 1)
    if not data or len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(400, "Görsel boş veya 12 MB sınırını aşıyor.")
    try:
        await storage.validate_store_hero_photo(data)
        with Image.open(io.BytesIO(data)) as parsed:
            width, height = parsed.size
            mime = Image.MIME.get(parsed.format or "", image.content_type or "image/jpeg")
    except (ValueError, OSError) as exc:
        raise HTTPException(400, "Geçerli bir JPEG, PNG veya WebP görseli yükleyin.") from exc
    image_url = await storage.upload_store_hero_photo(data)
    asset = StoreMediaAsset(
        image_url=image_url, alt_text=alt_text.strip(), mime_type=mime,
        width=width, height=height, file_size=len(data), created_by_admin_id=admin.id,
    )
    db.add(asset)
    try:
        await db.flush()
        await audit_service.record(db, actor=admin, action="store_media.upload", target_type="store_media_asset", target_id=asset.id)
    except Exception:
        await db.rollback()
        await storage.delete_file(image_url)
        raise
    await db.refresh(asset)
    return asset
