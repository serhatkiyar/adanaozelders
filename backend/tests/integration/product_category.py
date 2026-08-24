"""Entegrasyon ürünleri için suite'e ait gerçek kategori kimliği.

Aktif ürünlerin kategorisiz yazılmasını veritabanı engeller. Test fabrikaları da
bu üretim invariantını delmek yerine, ``conftest`` tarafından suite başında
kurulan ve sonunda kaldırılan kategoriyi kullanır.
"""
from __future__ import annotations

from sqlalchemy import text


TEST_PRODUCT_CATEGORY_SLUG = "integration-test-products"


async def integration_product_category_id(session) -> int:
    category_id = (
        await session.execute(
            text(
                "SELECT id FROM product_categories "
                "WHERE slug = :slug AND deleted_at IS NULL"
            ),
            {"slug": TEST_PRODUCT_CATEGORY_SLUG},
        )
    ).scalar_one_or_none()
    if category_id is None:
        raise AssertionError(
            "Entegrasyon test ürünü kategorisi kurulmamış; "
            "autouse _test_urun_kategorisi fixture'ı çalışmalı."
        )
    return int(category_id)
