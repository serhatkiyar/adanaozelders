"""Mağaza yönetiminin KALAN servisi: ürün öznitelikleri (taksonomi).

MANUEL VİTRİN KARARI (28 Ağu 2026): landing page / koleksiyon / yayın /
metrik / sağlık katmanı SÖKÜLDÜ — vitrin artık frontend'de kod olarak yaşar
(frontend/src/pages/store/vitrin/). Burada yalnız iki canlı tüketicinin
ihtiyacı durur: ürün formunun öznitelik ataması ve kategori sekmesindeki
taksonomi yönetimi. (Medya yükleme router'da, `core/storage` ile.)

Landing/product-set TABLOLARI bilinçli duruyor (drop migration sonraki
yayında — mevcut karar); onlara dokunan kod kalmadı.
"""

from __future__ import annotations

import datetime
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    Product,
    ProductAttributeAssignment,
    ProductAttributeDefinition,
    ProductAttributeValue,
)
from schemas.store_merchandising import (
    AttributeDefinitionOut,
    AttributeDefinitionWrite,
    AttributeValueOut,
    AttributeValueWrite,
)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _slugify(value: str) -> str:
    translated = value.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU"))
    normalized = unicodedata.normalize("NFKD", translated).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")


async def _unique_slug(db: AsyncSession, model, raw: str, *, exclude_id: int | None = None) -> str:
    base = _slugify(raw)
    if not base:
        raise HTTPException(422, "Geçerli bir adres adı girin.")
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
