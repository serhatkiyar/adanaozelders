"""Mağaza vitrin sayfalarının iş kuralları ve dinamik ürün seçimi."""

from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import re
import unicodedata
import uuid
from decimal import Decimal
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, not_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models import (
    Order,
    OrderItem,
    Product,
    ProductAttributeAssignment,
    ProductAttributeDefinition,
    ProductAttributeValue,
    ProductCategory,
    ProductSet,
    ProductSetRevision,
    StoreLandingPage,
    StoreLandingPageBlock,
    StoreLandingPagePublication,
    StoreLandingPageRedirect,
    StoreLandingPageRevision,
    StorePageDailyMetric,
)
from models.store import ProductStatus
from schemas.store_merchandising import (
    AttributeDefinitionOut,
    AttributeDefinitionWrite,
    AttributeValueOut,
    AttributeValueWrite,
    LandingPageBlockOut,
    LandingPageCreate,
    LandingPageDuplicateIn,
    LandingPageOut,
    LandingPagePublicationOut,
    LandingPagePublicationUpdate,
    LandingPagePublishIn,
    LandingPageRevisionOut,
    LandingPageRevisionWrite,
    LandingPageSummaryOut,
    ProductSetOut,
    ProductSetRevisionOut,
    ProductSetWrite,
    StorePageEventIn,
    StorePageMetricOut,
)
from services import store_service


RESERVED_STORE_SLUGS = {
    "urun", "satici", "sepet", "favoriler", "odeme", "liste", "siparisler",
}
_LINK_RE = re.compile(r"^(?:/[^\s]*|https://[^\s]+)$")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _plan_publication_window(
    publications: list[StoreLandingPagePublication],
    starts_at: datetime.datetime,
    requested_end: datetime.datetime | None,
) -> tuple[datetime.datetime | None, list[StoreLandingPagePublication]]:
    """Yeni sürüm için kesintisiz yayın planı üretir.

    Daha önce başlayan açık yayın yeni sürüm başladığı anda kapanır. Sonraki
    planlı yayın korunur; yeni sürümün bitişi belirtilmemişse o yayının
    başlangıcında otomatik biter. Açıkça seçilmiş bir aralık sonraki yayına
    taşıyorsa kullanıcıya hangi planın engel olduğu söylenir.
    """
    previous = [
        publication
        for publication in publications
        if publication.starts_at < starts_at
        and (publication.ends_at is None or publication.ends_at > starts_at)
    ]
    upcoming = sorted(
        (publication for publication in publications if publication.starts_at >= starts_at),
        key=lambda publication: publication.starts_at,
    )
    next_publication = upcoming[0] if upcoming else None
    if next_publication is None:
        return requested_end, previous

    if next_publication.starts_at == starts_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Aynı başlangıç saatinde planlanmış başka bir sürüm var. Önce o planı kaldırın veya farklı saat seçin.",
        )
    if requested_end is None:
        return next_publication.starts_at, previous
    if requested_end > next_publication.starts_at:
        local_start = next_publication.starts_at.astimezone(
            datetime.timezone(datetime.timedelta(hours=3))
        )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Seçtiğiniz aralık {local_start:%d.%m.%Y %H:%M} tarihinde başlayacak planlı yayınla çakışıyor.",
        )
    return requested_end, previous


def _slugify(value: str) -> str:
    translated = value.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU"))
    normalized = unicodedata.normalize("NFKD", translated).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")


async def _unique_slug(db: AsyncSession, model, raw: str, *, exclude_id: int | None = None) -> str:
    base = _slugify(raw)
    if not base:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçerli bir adres adı girin.")
    if model is StoreLandingPage and base in RESERVED_STORE_SLUGS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu adres mağaza tarafından kullanılıyor.")
    candidate = base
    counter = 2
    while True:
        conditions = [model.slug == candidate, model.deleted_at.is_(None)]
        if exclude_id is not None:
            conditions.append(model.id != exclude_id)
        exists = (await db.execute(select(model.id).where(*conditions))).scalar_one_or_none()
        if exists is None:
            return candidate
        candidate = f"{base}-{counter}"
        counter += 1


def _validate_link(value: str | None) -> None:
    if value and not _LINK_RE.match(value):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Bağlantı / ile başlayan site içi adres veya https adresi olmalı.",
        )


def _validate_image_url(value: str | None) -> None:
    """Yayın görsellerini yalnız mağazanın public obje önekleriyle sınırlar."""
    if not value:
        return
    try:
        parsed = urlsplit(value)
        configured = urlsplit(
            settings.S3_PUBLIC_ENDPOINT_URL or settings.AWS_ENDPOINT_URL
        )
        if configured.hostname:
            same_origin = (
                parsed.scheme.lower(),
                parsed.hostname,
                parsed.port,
            ) == (
                configured.scheme.lower(),
                configured.hostname,
                configured.port,
            )
            base_path = configured.path.rstrip("/")
            marker = f"{base_path}/{settings.AWS_BUCKET_NAME}/"
            key = parsed.path.removeprefix(marker) if parsed.path.startswith(marker) else None
        else:
            expected_host = (
                f"{settings.AWS_BUCKET_NAME}.s3."
                f"{settings.AWS_REGION_NAME}.amazonaws.com"
            )
            same_origin = (
                parsed.scheme.lower() == "https"
                and parsed.hostname == expected_host
                and parsed.port is None
            )
            key = parsed.path.lstrip("/")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            same_origin = False
    except ValueError:
        same_origin = False
        key = None
    if key is None or not key.startswith(
        (
            "store-hero/",
            "store-showcase/",
            # Eski yükleyicinin public avatars kökü altında ürettiği kayıtlar.
            "avatars/store-hero/",
            "avatars/store-showcase/",
        )
    ):
        same_origin = False
    if not same_origin:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Görsel önce mağaza medya kütüphanesine yüklenmeli.",
        )


def _validate_block(block) -> None:
    _validate_link(block.link_url)
    cfg = block.config
    if block.block_type == "PRODUCT_RAIL" and block.product_set_revision_id is None:
        raise HTTPException(422, "Ürün vitrini için akıllı ürün grubu seçin.")
    if block.block_type != "PRODUCT_RAIL" and block.product_set_revision_id is not None:
        raise HTTPException(422, "Akıllı ürün grubu yalnız ürün vitrini bloğunda kullanılabilir.")
    if block.block_type in {"HERO_CAROUSEL", "IMAGE_CARD_GRID"}:
        key = "slides" if block.block_type == "HERO_CAROUSEL" else "cards"
        items = cfg.get(key)
        if not isinstance(items, list) or not 1 <= len(items) <= 8:
            raise HTTPException(422, f"{key} alanında 1-8 görsel bulunmalı.")
        for item in items:
            if not isinstance(item, dict) or not item.get("image_url"):
                raise HTTPException(422, "Her kart için görsel yükleyin.")
            _validate_image_url(item.get("image_url"))
            _validate_image_url(item.get("mobile_image_url"))
            if not item.get("alt_text") and not item.get("decorative"):
                raise HTTPException(422, "Her görsele açıklama yazın veya dekoratif işaretleyin.")
            _validate_link(item.get("link_url"))
    elif block.block_type == "BANNER":
        if not cfg.get("image_url"):
            raise HTTPException(422, "Banner görseli zorunludur.")
        _validate_image_url(cfg.get("image_url"))
        _validate_image_url(cfg.get("mobile_image_url"))
        _validate_link(cfg.get("link_url"))
    elif block.block_type == "CATEGORY_GRID":
        ids = cfg.get("category_ids")
        if not isinstance(ids, list) or not ids:
            raise HTTPException(422, "Kategori bloğunda en az bir kategori seçin.")
    elif block.block_type == "RICH_TEXT":
        content = str(cfg.get("content") or "")
        if "<" in content or ">" in content:
            raise HTTPException(422, "Metin bloğunda HTML kullanılamaz.")


# ── Yönetilen özellikler ────────────────────────────────────────────────────────


async def list_attributes(db: AsyncSession, *, include_inactive: bool) -> list[AttributeDefinitionOut]:
    conditions = [ProductAttributeDefinition.deleted_at.is_(None)]
    if not include_inactive:
        conditions.append(ProductAttributeDefinition.is_active.is_(True))
    definitions = list((await db.execute(
        select(ProductAttributeDefinition)
        .options(selectinload(ProductAttributeDefinition.values))
        .where(*conditions)
        .order_by(ProductAttributeDefinition.sort_order, ProductAttributeDefinition.name)
    )).scalars().unique().all())
    result: list[AttributeDefinitionOut] = []
    for definition in definitions:
        values = [v for v in definition.values if v.deleted_at is None and (include_inactive or v.is_active)]
        result.append(AttributeDefinitionOut(
            id=definition.id, name=definition.name, slug=definition.slug,
            sort_order=definition.sort_order, is_active=definition.is_active,
            values=[AttributeValueOut.model_validate(v) for v in values],
        ))
    return result


async def create_attribute(db: AsyncSession, payload: AttributeDefinitionWrite) -> ProductAttributeDefinition:
    definition = ProductAttributeDefinition(
        name=payload.name.strip(),
        slug=await _unique_slug(db, ProductAttributeDefinition, payload.name),
        sort_order=payload.sort_order,
        is_active=payload.is_active,
    )
    db.add(definition)
    await db.flush()
    return definition


async def update_attribute(db: AsyncSession, definition_id: int, payload: AttributeDefinitionWrite) -> ProductAttributeDefinition:
    definition = await db.get(ProductAttributeDefinition, definition_id)
    if definition is None or definition.deleted_at is not None:
        raise HTTPException(404, "Özellik bulunamadı.")
    definition.name = payload.name.strip()
    definition.slug = await _unique_slug(db, ProductAttributeDefinition, payload.name, exclude_id=definition.id)
    definition.sort_order = payload.sort_order
    definition.is_active = payload.is_active
    return definition


async def create_attribute_value(db: AsyncSession, definition_id: int, payload: AttributeValueWrite) -> ProductAttributeValue:
    definition = await db.get(ProductAttributeDefinition, definition_id)
    if definition is None or definition.deleted_at is not None:
        raise HTTPException(404, "Özellik bulunamadı.")
    base = _slugify(payload.label)
    existing = (await db.execute(select(ProductAttributeValue.id).where(
        ProductAttributeValue.definition_id == definition_id,
        ProductAttributeValue.slug == base,
        ProductAttributeValue.deleted_at.is_(None),
    ))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "Bu özellik değeri zaten var.")
    value = ProductAttributeValue(
        definition_id=definition_id, label=payload.label.strip(), slug=base,
        sort_order=payload.sort_order, is_active=payload.is_active,
    )
    db.add(value)
    await db.flush()
    return value


async def set_product_attributes(db: AsyncSession, product_id: int, value_ids: list[int]) -> None:
    product = await db.get(Product, product_id)
    if product is None or product.deleted_at is not None:
        raise HTTPException(404, "Ürün bulunamadı.")
    values = list((await db.execute(select(ProductAttributeValue).where(
        ProductAttributeValue.id.in_(value_ids or [-1]),
        ProductAttributeValue.deleted_at.is_(None),
        ProductAttributeValue.is_active.is_(True),
    ))).scalars().all())
    if len(values) != len(value_ids):
        raise HTTPException(422, "Seçilen özellik değerlerinden biri geçersiz.")
    current = list((await db.execute(select(ProductAttributeAssignment).where(
        ProductAttributeAssignment.product_id == product_id,
        ProductAttributeAssignment.deleted_at.is_(None),
    ))).scalars().all())
    desired = set(value_ids)
    by_value = {row.value_id: row for row in current}
    for row in current:
        if row.value_id not in desired:
            row.deleted_at = _now()
    for value_id in desired - set(by_value):
        db.add(ProductAttributeAssignment(product_id=product_id, value_id=value_id))


# ── Akıllı ürün grupları ─────────────────────────────────────────────────────────


async def _descendant_ids(db: AsyncSession, roots: list[int]) -> list[int]:
    if not roots:
        return []
    base = select(ProductCategory.id).where(
        ProductCategory.id.in_(roots), ProductCategory.deleted_at.is_(None)
    ).cte("merch_category_tree", recursive=True)
    tree = base.union_all(select(ProductCategory.id).where(
        ProductCategory.parent_id == base.c.id,
        ProductCategory.deleted_at.is_(None),
    ))
    return list(dict.fromkeys((await db.execute(select(tree.c.id))).scalars().all()))


async def _rule_expression(db: AsyncSession, rule: dict):
    field = rule["field"]
    operator = rule.get("operator")
    if field == "CATEGORY":
        values = rule["values"]
        ids = await _descendant_ids(db, values) if rule.get("include_descendants", True) else values
        expression = Product.category_id.in_(ids)
    elif field == "ATTRIBUTE":
        expression = select(ProductAttributeAssignment.id).where(
            ProductAttributeAssignment.product_id == Product.id,
            ProductAttributeAssignment.value_id.in_(rule["values"]),
            ProductAttributeAssignment.deleted_at.is_(None),
        ).exists()
    elif field == "KIND":
        expression = Product.kind.in_(rule["values"])
    elif field == "AVAILABLE":
        available = or_(Product.kind == "DIGITAL", Product.stock > 0, Product.supplier_backed.is_(True))
        return available if rule.get("value", True) else not_(available)
    elif field == "PRICE":
        parts = []
        if rule.get("minimum") is not None:
            parts.append(Product.price >= rule["minimum"])
        if rule.get("maximum") is not None:
            parts.append(Product.price <= rule["maximum"])
        return and_(*parts)
    else:
        raise HTTPException(422, "Bilinmeyen ürün grubu kuralı.")
    return not_(expression) if operator == "NOT_IN" else expression


async def evaluate_product_set(db: AsyncSession, revision: ProductSetRevision) -> tuple[list[Product], int, list[str]]:
    universal = [
        Product.deleted_at.is_(None),
        Product.status == ProductStatus.ACTIVE.value,
        or_(Product.kind == "DIGITAL", Product.stock > 0, Product.supplier_backed.is_(True)),
    ]
    expressions = [await _rule_expression(db, rule) for rule in list(revision.rules or [])]
    if expressions:
        universal.append(and_(*expressions) if revision.match_mode == "ALL" else or_(*expressions))
    excluded = [int(v) for v in list(revision.excluded_product_ids or [])]
    if excluded:
        universal.append(Product.id.notin_(excluded))

    popularity = (
        select(OrderItem.product_id, func.coalesce(func.sum(OrderItem.quantity), 0).label("sold"))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.payment_status == "PAID", Order.deleted_at.is_(None))
        .group_by(OrderItem.product_id)
        .subquery()
    )
    stmt = select(Product).outerjoin(popularity, popularity.c.product_id == Product.id).where(*universal)
    if revision.sort_mode == "PRICE_ASC":
        stmt = stmt.order_by(Product.price.asc(), Product.id.asc())
    elif revision.sort_mode == "PRICE_DESC":
        stmt = stmt.order_by(Product.price.desc(), Product.id.asc())
    elif revision.sort_mode == "RATING":
        stmt = stmt.order_by(
            case((Product.rating_count > 0, Product.rating_sum / Product.rating_count), else_=0).desc(),
            Product.rating_count.desc(), Product.id.desc(),
        )
    elif revision.sort_mode == "POPULAR":
        stmt = stmt.order_by(func.coalesce(popularity.c.sold, 0).desc(), Product.id.desc())
    else:
        stmt = stmt.order_by(Product.created_at.desc(), Product.id.desc())
    count = int((await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one())
    automatic = list((await db.execute(stmt.limit(revision.max_items + len(revision.pinned_product_ids or [])))).scalars().all())

    pins = [int(v) for v in list(revision.pinned_product_ids or []) if int(v) not in excluded]
    pinned_rows = list((await db.execute(select(Product).where(
        Product.id.in_(pins or [-1]),
        Product.deleted_at.is_(None), Product.status == ProductStatus.ACTIVE.value,
        or_(Product.kind == "DIGITAL", Product.stock > 0, Product.supplier_backed.is_(True)),
    ))).scalars().all())
    by_id = {p.id: p for p in pinned_rows}
    ordered = [by_id[pid] for pid in pins if pid in by_id]
    seen = {p.id for p in ordered}
    ordered.extend(p for p in automatic if p.id not in seen)
    warnings = []
    missing_pins = [pid for pid in pins if pid not in by_id]
    if missing_pins:
        warnings.append(f"{len(missing_pins)} sabit ürün şu anda satılabilir olmadığı için gizlendi.")
    return ordered[: revision.max_items], count, warnings


async def _product_outputs(db: AsyncSession, products: list[Product]):
    if not products:
        return []
    prior = await store_service._compute_global_mean(db)
    supplier = await store_service._tedarikci_stogu(db, products)
    return [store_service._to_search_out(
        product, prior, settings.BAYESIAN_CONFIDENCE, supplier_qty=supplier.get(product.id)
    ) for product in products]


async def _product_set_out(db: AsyncSession, product_set: ProductSet, revision: ProductSetRevision) -> ProductSetOut:
    products, count, warnings = await evaluate_product_set(db, revision)
    published_revision_id = (await db.execute(
        select(ProductSetRevision.id).where(
            ProductSetRevision.product_set_id == product_set.id,
            ProductSetRevision.deleted_at.is_(None),
            ProductSetRevision.status == "PUBLISHED",
        ).order_by(ProductSetRevision.version.desc()).limit(1)
    )).scalar_one_or_none()
    return ProductSetOut(
        id=product_set.id, name=product_set.name, description=product_set.description,
        is_active=product_set.is_active,
        revision=ProductSetRevisionOut.model_validate(revision),
        published_revision_id=published_revision_id,
        matched_count=count,
        preview_products=await _product_outputs(db, products), warnings=warnings,
    )


async def list_product_sets(db: AsyncSession) -> list[ProductSetOut]:
    sets = list((await db.execute(select(ProductSet).where(
        ProductSet.deleted_at.is_(None)
    ).order_by(ProductSet.updated_at.desc()))).scalars().all())
    result = []
    for product_set in sets:
        revision = (await db.execute(select(ProductSetRevision).where(
            ProductSetRevision.product_set_id == product_set.id,
            ProductSetRevision.deleted_at.is_(None),
        ).order_by(ProductSetRevision.version.desc()).limit(1))).scalar_one()
        result.append(await _product_set_out(db, product_set, revision))
    return result


async def create_product_set(db: AsyncSession, payload: ProductSetWrite, admin_id: int) -> ProductSetOut:
    product_set = ProductSet(name=payload.name.strip(), description=payload.description, is_active=payload.is_active)
    db.add(product_set)
    await db.flush()
    revision = ProductSetRevision(
        product_set_id=product_set.id, version=1, status="DRAFT", created_by_admin_id=admin_id,
        **payload.revision.model_dump(mode="json"),
    )
    db.add(revision)
    await db.flush()
    return await _product_set_out(db, product_set, revision)


async def revise_product_set(db: AsyncSession, product_set_id: int, payload: ProductSetWrite, admin_id: int) -> ProductSetOut:
    product_set = await db.get(ProductSet, product_set_id)
    if product_set is None or product_set.deleted_at is not None:
        raise HTTPException(404, "Akıllı ürün grubu bulunamadı.")
    draft = (await db.execute(select(ProductSetRevision).where(
        ProductSetRevision.product_set_id == product_set_id,
        ProductSetRevision.deleted_at.is_(None),
        ProductSetRevision.status == "DRAFT",
    ).order_by(ProductSetRevision.version.desc()).limit(1).with_for_update())).scalar_one_or_none()
    latest = (await db.execute(select(func.max(ProductSetRevision.version)).where(
        ProductSetRevision.product_set_id == product_set_id,
        ProductSetRevision.deleted_at.is_(None),
    ))).scalar_one() or 0
    product_set.name = payload.name.strip()
    product_set.description = payload.description
    product_set.is_active = payload.is_active
    if draft is None:
        revision = ProductSetRevision(
            product_set_id=product_set_id, version=latest + 1, status="DRAFT",
            created_by_admin_id=admin_id, **payload.revision.model_dump(mode="json"),
        )
        db.add(revision)
    else:
        revision = draft
        for field, value in payload.revision.model_dump(mode="json").items():
            setattr(revision, field, value)
        revision.created_by_admin_id = admin_id
    await db.flush()
    return await _product_set_out(db, product_set, revision)


async def publish_product_set(
    db: AsyncSession, product_set_id: int, admin_id: int
) -> ProductSetOut:
    product_set = (await db.execute(select(ProductSet).where(
        ProductSet.id == product_set_id,
        ProductSet.deleted_at.is_(None),
    ).with_for_update())).scalar_one_or_none()
    if product_set is None:
        raise HTTPException(404, "Koleksiyon bulunamadı.")
    revision = (await db.execute(select(ProductSetRevision).where(
        ProductSetRevision.product_set_id == product_set_id,
        ProductSetRevision.deleted_at.is_(None),
    ).order_by(ProductSetRevision.version.desc()).limit(1).with_for_update())).scalar_one()
    if revision.status == "DRAFT":
        revision.status = "PUBLISHED"
        revision.published_at = _now()
        revision.created_by_admin_id = admin_id
    await db.flush()
    return await _product_set_out(db, product_set, revision)


# ── Vitrin sayfaları ─────────────────────────────────────────────────────────────


async def _write_blocks(db: AsyncSession, revision_id: int, blocks) -> None:
    recent_count = sum(1 for block in blocks if block.block_type == "RECENTLY_VIEWED" and block.is_active)
    if recent_count > 1:
        raise HTTPException(422, "Bir sayfada yalnız bir Son görüntülenenler bloğu olabilir.")
    keys: set[str] = set()
    for index, block in enumerate(blocks):
        _validate_block(block)
        key = block.block_key or str(uuid.uuid4())
        if key in keys:
            raise HTTPException(422, "Blok anahtarları tekrar edemez.")
        keys.add(key)
        db.add(StoreLandingPageBlock(
            revision_id=revision_id, block_key=key, block_type=block.block_type,
            title=block.title, description=block.description, link_label=block.link_label,
            link_url=block.link_url, config=block.config,
            product_set_id=block.product_set_id,
            product_set_revision_id=block.product_set_revision_id,
            is_active=block.is_active, sort_order=index * 10,
        ))


async def _sync_draft_blocks(db: AsyncSession, revision_id: int, blocks) -> None:
    """Mutable taslağın bloklarını kimlikleri koruyarak yerinde günceller."""
    recent_count = sum(
        1 for block in blocks
        if block.block_type == "RECENTLY_VIEWED" and block.is_active
    )
    if recent_count > 1:
        raise HTTPException(422, "Bir sayfada yalnız bir Son görüntülenenler bloğu olabilir.")
    existing = list((await db.execute(select(StoreLandingPageBlock).where(
        StoreLandingPageBlock.revision_id == revision_id,
    ).with_for_update())).scalars().all())
    by_key = {block.block_key: block for block in existing}
    seen: set[str] = set()
    now = _now()
    for index, payload in enumerate(blocks):
        _validate_block(payload)
        key = payload.block_key or str(uuid.uuid4())
        if key in seen:
            raise HTTPException(422, "Blok anahtarları tekrar edemez.")
        seen.add(key)
        block = by_key.get(key)
        values = {
            "block_type": payload.block_type,
            "title": payload.title,
            "description": payload.description,
            "link_label": payload.link_label,
            "link_url": payload.link_url,
            "config": payload.config,
            "product_set_id": payload.product_set_id,
            "product_set_revision_id": payload.product_set_revision_id,
            "is_active": payload.is_active,
            "sort_order": index * 10,
        }
        if block is None:
            db.add(StoreLandingPageBlock(
                revision_id=revision_id,
                block_key=key,
                **values,
            ))
        else:
            for field, value in values.items():
                setattr(block, field, value)
            block.deleted_at = None
    for block in existing:
        if block.block_key not in seen and block.deleted_at is None:
            block.deleted_at = now


async def create_page(db: AsyncSession, payload: LandingPageCreate, admin_id: int) -> StoreLandingPage:
    _validate_image_url(payload.revision.og_image_url)
    if payload.page_type == "HOME":
        existing_home = (await db.execute(select(StoreLandingPage.id).where(
            StoreLandingPage.page_type == "HOME",
            StoreLandingPage.deleted_at.is_(None),
        ))).scalar_one_or_none()
        if existing_home is not None:
            raise HTTPException(409, "Mağaza ana sayfası zaten mevcut.")
    page = StoreLandingPage(
        internal_name=payload.internal_name.strip(),
        slug=await _unique_slug(db, StoreLandingPage, payload.slug),
        page_type=payload.page_type,
    )
    db.add(page)
    await db.flush()
    revision = StoreLandingPageRevision(
        page_id=page.id, version=1, status="DRAFT", created_by_admin_id=admin_id,
        title=payload.revision.title, seo_title=payload.revision.seo_title,
        seo_description=payload.revision.seo_description,
        og_image_url=payload.revision.og_image_url,
    )
    db.add(revision)
    await db.flush()
    await _write_blocks(db, revision.id, payload.revision.blocks)
    return page


async def save_page_draft(
    db: AsyncSession, page_id: int, payload: LandingPageRevisionWrite, admin_id: int
) -> StoreLandingPageRevision:
    _validate_image_url(payload.og_image_url)
    page = (await db.execute(select(StoreLandingPage).where(
        StoreLandingPage.id == page_id,
        StoreLandingPage.deleted_at.is_(None),
    ).with_for_update())).scalar_one_or_none()
    if page is None or page.deleted_at is not None:
        raise HTTPException(404, "Vitrin sayfası bulunamadı.")
    draft = (await db.execute(select(StoreLandingPageRevision).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
        StoreLandingPageRevision.status == "DRAFT",
    ).order_by(StoreLandingPageRevision.version.desc()).limit(1).with_for_update())).scalar_one_or_none()
    latest = (await db.execute(select(func.max(StoreLandingPageRevision.version)).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
    ))).scalar_one() or 0
    if draft is None:
        revision = StoreLandingPageRevision(
            page_id=page_id, version=latest + 1, status="DRAFT", created_by_admin_id=admin_id,
            title=payload.title, seo_title=payload.seo_title,
            seo_description=payload.seo_description, og_image_url=payload.og_image_url,
        )
        db.add(revision)
        await db.flush()
        await _write_blocks(db, revision.id, payload.blocks)
    else:
        revision = draft
        revision.title = payload.title
        revision.seo_title = payload.seo_title
        revision.seo_description = payload.seo_description
        revision.og_image_url = payload.og_image_url
        revision.created_by_admin_id = admin_id
        await _sync_draft_blocks(db, revision.id, payload.blocks)
        await db.flush()
    return revision


async def publish_page(
    db: AsyncSession, page_id: int, revision_id: int, payload: LandingPagePublishIn, admin_id: int
) -> StoreLandingPagePublication:
    page_locked = (await db.execute(
        select(StoreLandingPage.id).where(
            StoreLandingPage.id == page_id,
            StoreLandingPage.deleted_at.is_(None),
        ).with_for_update()
    )).scalar_one_or_none()
    if page_locked is None:
        raise HTTPException(404, "Vitrin sayfası bulunamadı.")
    revision = await db.get(StoreLandingPageRevision, revision_id)
    if revision is None or revision.deleted_at is not None or revision.page_id != page_id:
        raise HTTPException(404, "Sayfa sürümü bulunamadı.")
    blocks = list((await db.execute(select(StoreLandingPageBlock).where(
        StoreLandingPageBlock.revision_id == revision_id,
        StoreLandingPageBlock.deleted_at.is_(None), StoreLandingPageBlock.is_active.is_(True),
    ))).scalars().all())
    if not blocks:
        raise HTTPException(422, "Yayınlamak için en az bir aktif blok gerekli.")
    publications = list((await db.execute(
        select(StoreLandingPagePublication).where(
            StoreLandingPagePublication.page_id == page_id,
            StoreLandingPagePublication.deleted_at.is_(None),
        ).order_by(StoreLandingPagePublication.starts_at).with_for_update()
    )).scalars().all())
    effective_end, publications_to_close = _plan_publication_window(
        publications, payload.starts_at, payload.ends_at
    )
    for active_publication in publications_to_close:
        active_publication.ends_at = payload.starts_at
    if publications_to_close:
        await db.flush()
    now = _now()
    for block in blocks:
        if block.product_set_id:
            set_revision = (await db.execute(select(ProductSetRevision).where(
                ProductSetRevision.product_set_id == block.product_set_id,
                ProductSetRevision.deleted_at.is_(None),
                ProductSetRevision.status == "PUBLISHED",
            ).order_by(ProductSetRevision.version.desc()).limit(1))).scalar_one_or_none()
            if set_revision is None:
                raise HTTPException(
                    422,
                    "Bir ürün vitrininin koleksiyonu henüz yayınlanmamış. Önce koleksiyonu yayınlayın.",
                )
        elif block.product_set_revision_id:
            set_revision = await db.get(ProductSetRevision, block.product_set_revision_id)
            if set_revision is None or set_revision.deleted_at is not None:
                raise HTTPException(422, "Bir ürün vitrininin ürün grubu bulunamadı.")
            if set_revision.status == "DRAFT":
                set_revision.status = "PUBLISHED"
                set_revision.published_at = now
    revision.status = "PUBLISHED"
    revision.published_at = now
    publication = StoreLandingPagePublication(
        page_id=page_id, revision_id=revision_id, starts_at=payload.starts_at,
        ends_at=effective_end, created_by_admin_id=admin_id,
    )
    db.add(publication)
    await db.flush()
    return publication


async def rename_page(db: AsyncSession, page: StoreLandingPage, *, internal_name=None, slug=None, is_archived=None) -> None:
    if internal_name is not None:
        page.internal_name = internal_name.strip()
    if slug is not None:
        new_slug = await _unique_slug(db, StoreLandingPage, slug, exclude_id=page.id)
        if new_slug != page.slug:
            db.add(StoreLandingPageRedirect(old_slug=page.slug, page_id=page.id))
            page.slug = new_slug
    if is_archived is not None:
        page.is_archived = is_archived


async def _publication_for_page(db: AsyncSession, page_id: int, *, preview_revision_id: int | None = None):
    now = _now()
    if preview_revision_id is not None:
        revision = (await db.execute(select(StoreLandingPageRevision).options(
            selectinload(StoreLandingPageRevision.blocks)
        ).where(
            StoreLandingPageRevision.id == preview_revision_id,
            StoreLandingPageRevision.page_id == page_id,
            StoreLandingPageRevision.deleted_at.is_(None),
        ))).scalar_one_or_none()
        return revision, "DRAFT", None, None
    current = (await db.execute(select(StoreLandingPagePublication).where(
        StoreLandingPagePublication.page_id == page_id,
        StoreLandingPagePublication.deleted_at.is_(None),
        StoreLandingPagePublication.starts_at <= now,
        or_(StoreLandingPagePublication.ends_at.is_(None), StoreLandingPagePublication.ends_at > now),
    ).order_by(StoreLandingPagePublication.starts_at.desc()).limit(1))).scalar_one_or_none()
    state = "LIVE"
    publication = current
    if publication is None:
        future = (await db.execute(select(StoreLandingPagePublication).where(
            StoreLandingPagePublication.page_id == page_id,
            StoreLandingPagePublication.deleted_at.is_(None),
            StoreLandingPagePublication.starts_at > now,
        ).order_by(StoreLandingPagePublication.starts_at).limit(1))).scalar_one_or_none()
        past = (await db.execute(select(StoreLandingPagePublication).where(
            StoreLandingPagePublication.page_id == page_id,
            StoreLandingPagePublication.deleted_at.is_(None),
            StoreLandingPagePublication.starts_at <= now,
        ).order_by(StoreLandingPagePublication.starts_at.desc()).limit(1))).scalar_one_or_none()
        publication = past or future
        state = "ENDED" if past else ("UPCOMING" if future else "DRAFT")
    if publication is None:
        return None, state, None, None
    revision = (await db.execute(select(StoreLandingPageRevision).options(
        selectinload(StoreLandingPageRevision.blocks)
    ).where(StoreLandingPageRevision.id == publication.revision_id))).scalar_one()
    return revision, state, publication.starts_at, publication.ends_at


#: Hedef (link) bekleyen blok tipleri. Metin/kategori/ürün blokları kendi
#: yönlendirmesini üretir; onlarda hedefsizlik hata değildir.
_HEDEFLI_BLOKLAR = {"HERO_CAROUSEL": "slides", "IMAGE_CARD_GRID": "cards"}


def _bos_hedef(deger: object) -> bool:
    return not (isinstance(deger, str) and deger.strip())


def block_link_warnings(
    *, block_type: str, link_label: str | None, link_url: str | None, config: dict
) -> list[str]:
    """Bir bloğun 'hiçbir yere gitmiyor' kusurlarını yöneticiye anlatır.

    B-2 (ölçüldü 24 Ağu 2026): canlı ana sayfada dört görsel kartın da hedefi
    boştu; mağazada link gibi görünüp tıklanmıyorlardı ve panel bunu hiç
    söylemiyordu. Ayrıca `link_label` yazılıp `link_url` boş bırakıldığında
    yazılan metin mağazada HİÇ basılmıyor (StoreLandingBlocks Heading, yalnız
    `link_url` doluysa render eder) — yani sessiz veri kaybı.
    """
    uyarilar: list[str] = []
    blok_hedefi_var = not _bos_hedef(link_url)

    if link_label and link_label.strip() and not blok_hedefi_var:
        uyarilar.append(
            f"“{link_label.strip()}” bağlantı metni yazılmış ama hedef adres boş; "
            "bu metin mağazada hiç görünmüyor."
        )

    if block_type == "BANNER":
        if config.get("image_url") and not blok_hedefi_var:
            uyarilar.append("Görsel hiçbir yere gitmiyor: hedef adres boş.")
        return uyarilar

    anahtar = _HEDEFLI_BLOKLAR.get(block_type)
    if not anahtar or blok_hedefi_var:
        return uyarilar

    ogeler = config.get(anahtar) or []
    if not isinstance(ogeler, list):
        return uyarilar
    hedefsiz = sum(
        1
        for oge in ogeler
        if isinstance(oge, dict) and oge.get("image_url") and _bos_hedef(oge.get("link_url"))
    )
    if hedefsiz:
        ad = "slayt" if anahtar == "slides" else "görsel kart"
        # Sayı ŞART: "bazı kartlar" cümlesi düzeltilebilir bir uyarı değildir.
        uyarilar.append(
            f"{hedefsiz} {ad} hiçbir yere gitmiyor: hedef adres boş."
        )
    return uyarilar


async def _revision_out(db: AsyncSession, revision: StoreLandingPageRevision) -> LandingPageRevisionOut:
    category_outputs = await store_service.list_categories(db)
    category_map = {category.id: category for category in category_outputs}
    blocks: list[LandingPageBlockOut] = []
    for block in sorted(
        (b for b in revision.blocks if b.deleted_at is None and b.is_active),
        key=lambda b: (b.sort_order, b.id),
    ):
        products = []
        warnings: list[str] = []
        set_revision = None
        if block.product_set_id:
            conditions = [
                ProductSetRevision.product_set_id == block.product_set_id,
                ProductSetRevision.deleted_at.is_(None),
            ]
            if revision.status != "DRAFT":
                conditions.append(ProductSetRevision.status == "PUBLISHED")
            set_revision = (await db.execute(select(ProductSetRevision).where(
                *conditions
            ).order_by(ProductSetRevision.version.desc()).limit(1))).scalar_one_or_none()
        elif block.product_set_revision_id:
            set_revision = await db.get(ProductSetRevision, block.product_set_revision_id)
        if set_revision:
            # DİKKAT: burada `warnings = ...` ATAMASI yapılmaz — ürün seti
            # uyarısı, bağlantı uyarısının üzerine yazardı.
            rows, _count, set_warnings = await evaluate_product_set(db, set_revision)
            warnings.extend(set_warnings)
            products = await _product_outputs(db, rows)
        warnings.extend(
            block_link_warnings(
                block_type=block.block_type,
                link_label=block.link_label,
                link_url=block.link_url,
                config=block.config or {},
            )
        )
        categories = [category_map[cid] for cid in block.config.get("category_ids", []) if cid in category_map]
        blocks.append(LandingPageBlockOut(
            id=block.id, block_key=block.block_key, block_type=block.block_type,
            title=block.title, description=block.description, link_label=block.link_label,
            link_url=block.link_url, config=block.config,
            product_set_id=block.product_set_id,
            product_set_revision_id=block.product_set_revision_id,
            is_active=block.is_active, sort_order=block.sort_order,
            products=products, categories=categories, warnings=warnings,
        ))
    return LandingPageRevisionOut(
        id=revision.id, page_id=revision.page_id, version=revision.version,
        status=revision.status, title=revision.title, seo_title=revision.seo_title,
        seo_description=revision.seo_description, og_image_url=revision.og_image_url,
        published_at=revision.published_at, blocks=blocks,
    )


async def get_page(db: AsyncSession, slug: str, *, preview_revision_id: int | None = None) -> LandingPageOut:
    page = (await db.execute(select(StoreLandingPage).where(
        StoreLandingPage.slug == slug, StoreLandingPage.deleted_at.is_(None)
    ))).scalar_one_or_none()
    if page is None:
        redirect = (await db.execute(select(StoreLandingPageRedirect).where(
            StoreLandingPageRedirect.old_slug == slug,
            StoreLandingPageRedirect.deleted_at.is_(None),
        ))).scalar_one_or_none()
        if redirect:
            target = await db.get(StoreLandingPage, redirect.page_id)
            raise HTTPException(
                308,
                detail={"redirect_slug": target.slug},
                headers={"Location": f"/api/v1/store/pages/{target.slug}"},
            )
        raise HTTPException(404, "Vitrin sayfası bulunamadı.")
    revision, state, starts_at, ends_at = await _publication_for_page(
        db, page.id, preview_revision_id=preview_revision_id
    )
    if page.is_archived and preview_revision_id is None:
        state = "ARCHIVED"
    if revision is None or (state in {"DRAFT", "UPCOMING", "ARCHIVED"} and preview_revision_id is None):
        raise HTTPException(404, "Vitrin sayfası henüz yayında değil.")
    canonical = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/magaza/{page.slug}"
    return LandingPageOut(
        id=page.id, internal_name=page.internal_name, slug=page.slug,
        page_type=page.page_type, is_archived=page.is_archived, state=state,
        starts_at=starts_at, ends_at=ends_at, canonical_url=canonical,
        revision=await _revision_out(db, revision),
    )


async def get_home(
    db: AsyncSession, *, preview_revision_id: int | None = None
) -> LandingPageOut:
    page = (await db.execute(select(StoreLandingPage).where(
        StoreLandingPage.page_type == "HOME",
        StoreLandingPage.deleted_at.is_(None),
    ))).scalar_one_or_none()
    if page is None:
        raise HTTPException(404, "Mağaza ana sayfası bulunamadı.")
    revision, state, starts_at, ends_at = await _publication_for_page(
        db, page.id, preview_revision_id=preview_revision_id
    )
    if revision is None or (
        state in {"DRAFT", "UPCOMING", "ARCHIVED"}
        and preview_revision_id is None
    ):
        raise HTTPException(404, "Mağaza ana sayfası henüz yayında değil.")
    return LandingPageOut(
        id=page.id,
        internal_name=page.internal_name,
        slug=page.slug,
        page_type=page.page_type,
        is_archived=False,
        state=state,
        starts_at=starts_at,
        ends_at=ends_at,
        canonical_url=f"{settings.FRONTEND_BASE_URL.rstrip('/')}/magaza",
        revision=await _revision_out(db, revision),
    )


async def list_pages(db: AsyncSession) -> list[LandingPageSummaryOut]:
    pages = list((await db.execute(select(StoreLandingPage).where(
        StoreLandingPage.deleted_at.is_(None)
    ).order_by(StoreLandingPage.updated_at.desc()))).scalars().all())
    result = []
    for page in pages:
        revision = (await db.execute(select(StoreLandingPageRevision).where(
            StoreLandingPageRevision.page_id == page.id,
            StoreLandingPageRevision.deleted_at.is_(None),
        ).order_by(StoreLandingPageRevision.version.desc()).limit(1))).scalar_one_or_none()
        if revision is None:
            continue
        _effective, state, starts, ends = await _publication_for_page(db, page.id)
        if page.is_archived:
            state = "ARCHIVED"
        result.append(LandingPageSummaryOut(
            id=page.id, internal_name=page.internal_name, slug=page.slug,
            page_type=page.page_type, is_archived=page.is_archived, state=state,
            latest_revision_id=revision.id, latest_version=revision.version,
            starts_at=starts, ends_at=ends,
            has_unpublished_changes=revision.status == "DRAFT",
        ))
    return result


async def duplicate_page(
    db: AsyncSession,
    page_id: int,
    payload: LandingPageDuplicateIn,
    admin_id: int,
) -> StoreLandingPage:
    source = (await db.execute(select(StoreLandingPage).where(
        StoreLandingPage.id == page_id,
        StoreLandingPage.deleted_at.is_(None),
    ).with_for_update())).scalar_one_or_none()
    if source is None:
        raise HTTPException(404, "Kampanya sayfası bulunamadı.")
    if source.page_type == "HOME":
        raise HTTPException(409, "Mağaza ana sayfası kopyalanamaz.")
    revision = (await db.execute(select(StoreLandingPageRevision).options(
        selectinload(StoreLandingPageRevision.blocks)
    ).where(
        StoreLandingPageRevision.page_id == page_id,
        StoreLandingPageRevision.deleted_at.is_(None),
    ).order_by(StoreLandingPageRevision.version.desc()).limit(1))).scalar_one()
    target = StoreLandingPage(
        internal_name=payload.internal_name.strip(),
        slug=await _unique_slug(db, StoreLandingPage, payload.slug),
        page_type=source.page_type,
    )
    db.add(target)
    await db.flush()
    target_revision = StoreLandingPageRevision(
        page_id=target.id,
        version=1,
        status="DRAFT",
        title=revision.title,
        seo_title=revision.seo_title,
        seo_description=revision.seo_description,
        og_image_url=revision.og_image_url,
        created_by_admin_id=admin_id,
    )
    db.add(target_revision)
    await db.flush()
    for index, block in enumerate(
        sorted(
            (item for item in revision.blocks if item.deleted_at is None),
            key=lambda item: (item.sort_order, item.id),
        )
    ):
        db.add(StoreLandingPageBlock(
            revision_id=target_revision.id,
            block_key=str(uuid.uuid4()),
            block_type=block.block_type,
            title=block.title,
            description=block.description,
            link_label=block.link_label,
            link_url=block.link_url,
            config=block.config,
            product_set_id=block.product_set_id,
            product_set_revision_id=block.product_set_revision_id,
            is_active=block.is_active,
            sort_order=index * 10,
        ))
    await db.flush()
    return target


def _publication_state(publication: StoreLandingPagePublication) -> str:
    now = _now()
    if publication.starts_at > now:
        return "UPCOMING"
    if publication.ends_at is None or publication.ends_at > now:
        return "LIVE"
    return "ENDED"


async def list_publications(
    db: AsyncSession, page_id: int
) -> list[LandingPagePublicationOut]:
    rows = list((await db.execute(select(StoreLandingPagePublication).where(
        StoreLandingPagePublication.page_id == page_id,
        StoreLandingPagePublication.deleted_at.is_(None),
    ).order_by(StoreLandingPagePublication.starts_at.desc()))).scalars().all())
    return [LandingPagePublicationOut(
        id=row.id,
        page_id=row.page_id,
        revision_id=row.revision_id,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        state=_publication_state(row),
    ) for row in rows]


async def _restore_window_before(
    publications: list[StoreLandingPagePublication],
    removed: StoreLandingPagePublication,
) -> None:
    previous = sorted(
        (
            row for row in publications
            if row.id != removed.id and row.starts_at < removed.starts_at
        ),
        key=lambda row: row.starts_at,
    )
    if not previous:
        return
    candidate = previous[-1]
    if candidate.ends_at != removed.starts_at:
        return
    following = sorted(
        (
            row for row in publications
            if row.id != removed.id and row.starts_at > candidate.starts_at
        ),
        key=lambda row: row.starts_at,
    )
    candidate.ends_at = following[0].starts_at if following else None


async def reschedule_publication(
    db: AsyncSession,
    page_id: int,
    publication_id: int,
    payload: LandingPagePublicationUpdate,
) -> StoreLandingPagePublication:
    await db.execute(select(StoreLandingPage.id).where(
        StoreLandingPage.id == page_id,
        StoreLandingPage.deleted_at.is_(None),
    ).with_for_update())
    publications = list((await db.execute(select(StoreLandingPagePublication).where(
        StoreLandingPagePublication.page_id == page_id,
        StoreLandingPagePublication.deleted_at.is_(None),
    ).order_by(StoreLandingPagePublication.starts_at).with_for_update())).scalars().all())
    target = next((row for row in publications if row.id == publication_id), None)
    if target is None:
        raise HTTPException(404, "Planlı yayın bulunamadı.")
    if target.starts_at <= _now():
        raise HTTPException(409, "Başlamış bir yayının zamanı değiştirilemez.")
    await _restore_window_before(publications, target)
    others = [row for row in publications if row.id != target.id]
    effective_end, to_close = _plan_publication_window(
        others, payload.starts_at, payload.ends_at
    )
    for row in to_close:
        row.ends_at = payload.starts_at
    target.starts_at = payload.starts_at
    target.ends_at = effective_end
    await db.flush()
    return target


async def cancel_publication(
    db: AsyncSession, page_id: int, publication_id: int
) -> None:
    await db.execute(select(StoreLandingPage.id).where(
        StoreLandingPage.id == page_id,
        StoreLandingPage.deleted_at.is_(None),
    ).with_for_update())
    publications = list((await db.execute(select(StoreLandingPagePublication).where(
        StoreLandingPagePublication.page_id == page_id,
        StoreLandingPagePublication.deleted_at.is_(None),
    ).order_by(StoreLandingPagePublication.starts_at).with_for_update())).scalars().all())
    target = next((row for row in publications if row.id == publication_id), None)
    if target is None:
        raise HTTPException(404, "Planlı yayın bulunamadı.")
    if target.starts_at <= _now():
        raise HTTPException(409, "Başlamış bir yayın iptal edilemez.")
    await _restore_window_before(publications, target)
    target.deleted_at = _now()
    await db.flush()


# ── Ölçüm ve katkı token'ı ───────────────────────────────────────────────────────


def _sign_attribution(revision_id: int, block_key: str, product_id: int | None) -> str:
    payload = {
        "rev": revision_id, "block": block_key, "product": product_id,
        "exp": int((_now() + datetime.timedelta(hours=24)).timestamp()),
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    signature = hmac.new(settings.JWT_SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def decode_attribution_token(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        body, supplied = token.rsplit(".", 1)
        expected = hmac.new(settings.JWT_SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, supplied):
            return None
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        payload = json.loads(raw)
        if int(payload["exp"]) < int(_now().timestamp()):
            return None
        return payload
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


async def record_event(db: AsyncSession, revision_id: int, payload: StorePageEventIn) -> str | None:
    revision = await db.get(StoreLandingPageRevision, revision_id)
    if revision is None or revision.deleted_at is not None or revision.status != "PUBLISHED":
        raise HTTPException(404, "Yayın sürümü bulunamadı.")
    page = await db.get(StoreLandingPage, revision.page_id)
    if page is None or page.deleted_at is not None or page.is_archived:
        raise HTTPException(404, "Yayın sürümü bulunamadı.")
    effective, state, _starts_at, _ends_at = await _publication_for_page(db, page.id)
    if effective is None or state != "LIVE" or effective.id != revision_id:
        raise HTTPException(404, "Yayın sürümü şu anda etkin değil.")
    block_key = payload.block_key or ""
    block: StoreLandingPageBlock | None = None
    if payload.event_type != "PAGE_VIEW":
        block = (await db.execute(select(StoreLandingPageBlock).where(
            StoreLandingPageBlock.revision_id == revision_id,
            StoreLandingPageBlock.block_key == block_key,
            StoreLandingPageBlock.deleted_at.is_(None),
            StoreLandingPageBlock.is_active.is_(True),
        ))).scalar_one_or_none()
        if block is None:
            raise HTTPException(422, "Blok yayın sürümüne ait değil.")
    if payload.event_type == "PRODUCT_CLICK":
        if block is None or (
            block.product_set_id is None and block.product_set_revision_id is None
        ):
            raise HTTPException(422, "Ürün tıklaması bir ürün vitrini bloğuna ait olmalı.")
        if block.product_set_id:
            set_revision = (await db.execute(select(ProductSetRevision).where(
                ProductSetRevision.product_set_id == block.product_set_id,
                ProductSetRevision.deleted_at.is_(None),
                ProductSetRevision.status == "PUBLISHED",
            ).order_by(ProductSetRevision.version.desc()).limit(1))).scalar_one_or_none()
        else:
            set_revision = await db.get(ProductSetRevision, block.product_set_revision_id)
        if set_revision is None or set_revision.deleted_at is not None:
            raise HTTPException(422, "Ürün vitrininin ürün grubu bulunamadı.")
        products, _count, _warnings = await evaluate_product_set(db, set_revision)
        if payload.product_id not in {product.id for product in products}:
            raise HTTPException(422, "Ürün bu vitrin bloğunda yer almıyor.")
    product_id = payload.product_id or 0
    stmt = pg_insert(StorePageDailyMetric).values(
        metric_date=_now().date(), page_revision_id=revision_id,
        block_key=block_key, product_id=product_id,
        event_type=payload.event_type, event_count=1,
    ).on_conflict_do_update(
        constraint="uq_store_page_daily_metric_bucket",
        set_={"event_count": StorePageDailyMetric.event_count + 1, "updated_at": _now()},
    )
    await db.execute(stmt)
    if payload.event_type in {"BLOCK_CLICK", "PRODUCT_CLICK"}:
        return _sign_attribution(revision_id, block_key, payload.product_id)
    return None


async def metrics(db: AsyncSession) -> list[StorePageMetricOut]:
    rows = (await db.execute(
        select(
            StoreLandingPage.id,
            StoreLandingPageRevision.id,
            func.coalesce(func.sum(case((StorePageDailyMetric.event_type == "PAGE_VIEW", StorePageDailyMetric.event_count), else_=0)), 0),
            func.coalesce(func.sum(case((StorePageDailyMetric.event_type == "BLOCK_CLICK", StorePageDailyMetric.event_count), else_=0)), 0),
            func.coalesce(func.sum(case((StorePageDailyMetric.event_type == "PRODUCT_CLICK", StorePageDailyMetric.event_count), else_=0)), 0),
        )
        .join(StoreLandingPageRevision, StoreLandingPageRevision.page_id == StoreLandingPage.id)
        .outerjoin(StorePageDailyMetric, StorePageDailyMetric.page_revision_id == StoreLandingPageRevision.id)
        .where(StoreLandingPage.deleted_at.is_(None), StoreLandingPageRevision.deleted_at.is_(None))
        .group_by(StoreLandingPage.id, StoreLandingPageRevision.id)
    )).all()
    result = []
    for page_id, revision_id, views, block_clicks, product_clicks in rows:
        paid_orders, revenue = (await db.execute(select(
            func.count(Order.id), func.coalesce(func.sum(Order.total), 0)
        ).where(
            Order.source_page_revision_id == revision_id,
            Order.payment_status == "PAID", Order.deleted_at.is_(None),
        ))).one()
        result.append(StorePageMetricOut(
            page_id=page_id, page_revision_id=revision_id,
            page_views=int(views), block_clicks=int(block_clicks),
            product_clicks=int(product_clicks), paid_orders=int(paid_orders),
            attributed_revenue=str(Decimal(str(revenue)).quantize(Decimal("0.01"))),
        ))
    return result
