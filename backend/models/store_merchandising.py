"""Mağaza taksonomisi, akıllı ürün grupları ve sürümlü vitrin sayfaları."""

from __future__ import annotations

import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint, JSONB, TSTZRANGE
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class ProductAttributeDefinition(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "product_attribute_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    values: Mapped[list["ProductAttributeValue"]] = relationship(
        back_populates="definition", order_by="ProductAttributeValue.sort_order"
    )

    __table_args__ = (
        Index(
            "uq_product_attribute_definitions_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("sort_order >= 0", name="ck_product_attribute_definitions_sort"),
    )


class ProductAttributeValue(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "product_attribute_values"

    id: Mapped[int] = mapped_column(primary_key=True)
    definition_id: Mapped[int] = mapped_column(
        ForeignKey("product_attribute_definitions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    definition: Mapped[ProductAttributeDefinition] = relationship(back_populates="values")

    __table_args__ = (
        Index(
            "uq_product_attribute_values_slug_active",
            "definition_id",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("sort_order >= 0", name="ck_product_attribute_values_sort"),
    )


class ProductAttributeAssignment(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "product_attribute_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value_id: Mapped[int] = mapped_column(
        ForeignKey("product_attribute_values.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index(
            "uq_product_attribute_assignments_active",
            "product_id",
            "value_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class ProductSet(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "product_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    revisions: Mapped[list["ProductSetRevision"]] = relationship(
        back_populates="product_set", order_by="ProductSetRevision.version.desc()"
    )


class ProductSetRevision(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "product_set_revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_set_id: Mapped[int] = mapped_column(
        ForeignKey("product_sets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default=text("'DRAFT'"))
    match_mode: Mapped[str] = mapped_column(String(3), nullable=False, server_default=text("'ALL'"))
    rules: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    pinned_product_ids: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    excluded_product_ids: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    sort_mode: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'NEWEST'"))
    max_items: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("12"))
    published_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    product_set: Mapped[ProductSet] = relationship(back_populates="revisions")

    __table_args__ = (
        UniqueConstraint("product_set_id", "version", name="uq_product_set_revision_version"),
        UniqueConstraint("product_set_id", "id", name="uq_product_set_revision_product_id"),
        CheckConstraint("status IN ('DRAFT', 'PUBLISHED')", name="ck_product_set_revision_status"),
        CheckConstraint("match_mode IN ('ALL', 'ANY')", name="ck_product_set_revision_match"),
        CheckConstraint(
            "sort_mode IN ('MANUAL', 'NEWEST', 'POPULAR', 'RATING', 'PRICE_ASC', 'PRICE_DESC')",
            name="ck_product_set_revision_sort",
        ),
        CheckConstraint("max_items BETWEEN 1 AND 48", name="ck_product_set_revision_limit"),
        CheckConstraint("jsonb_typeof(rules) = 'array'", name="ck_product_set_rules_array"),
        CheckConstraint("jsonb_typeof(pinned_product_ids) = 'array'", name="ck_product_set_pins_array"),
        CheckConstraint("jsonb_typeof(excluded_product_ids) = 'array'", name="ck_product_set_excludes_array"),
    )


class StoreLandingPage(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_landing_pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    internal_name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    page_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'CAMPAIGN'"))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    revisions: Mapped[list["StoreLandingPageRevision"]] = relationship(
        back_populates="page", order_by="StoreLandingPageRevision.version.desc()"
    )

    __table_args__ = (
        Index(
            "uq_store_landing_pages_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint(
            "page_type IN ('HOME', 'CAMPAIGN', 'SEASONAL', 'EXAM', 'BRAND', 'CURATED')",
            name="ck_store_landing_pages_type",
        ),
        Index(
            "uq_store_landing_pages_single_home",
            "page_type",
            unique=True,
            postgresql_where=text("page_type = 'HOME' AND deleted_at IS NULL"),
        ),
    )


class StoreLandingPageRevision(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_landing_page_revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("store_landing_pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default=text("'DRAFT'"))
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    seo_title: Mapped[str] = mapped_column(String(160), nullable=False)
    seo_description: Mapped[str] = mapped_column(String(320), nullable=False, server_default=text("''"))
    og_image_url: Mapped[str | None] = mapped_column(Text)
    # Puck editörünün kanonik verisi (Faz 2). DOLUYSA bu revizyon "Puck
    # nesli"dir ve blok satırları bu veriden SUNUCUDA türetilmiştir
    # (services/store_merchandising_puck.py); NULL ise eski form nesli.
    # Revizyon başına TEK doğruluk kaynağı — iki format aynı taslakta yaşamaz.
    # none_as_null ŞART: yoksa Python None JSON 'null' olarak yazılır ve
    # ck_..._puck_object check'ine takılır (jsonb_typeof('null') = 'null').
    puck_data: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

    page: Mapped[StoreLandingPage] = relationship(back_populates="revisions")
    blocks: Mapped[list["StoreLandingPageBlock"]] = relationship(
        back_populates="revision", order_by="StoreLandingPageBlock.sort_order"
    )

    __table_args__ = (
        UniqueConstraint("page_id", "version", name="uq_store_landing_page_revision_version"),
        UniqueConstraint("page_id", "id", name="uq_store_landing_page_revision_page_id"),
        CheckConstraint("status IN ('DRAFT', 'PUBLISHED')", name="ck_store_landing_page_revision_status"),
        CheckConstraint(
            "puck_data IS NULL OR jsonb_typeof(puck_data) = 'object'",
            name="ck_store_landing_page_revision_puck_object",
        ),
    )


class StoreLandingPageBlock(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_landing_page_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    revision_id: Mapped[int] = mapped_column(
        ForeignKey("store_landing_page_revisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    block_key: Mapped[str] = mapped_column(String(36), nullable=False)
    block_type: Mapped[str] = mapped_column(String(24), nullable=False)
    title: Mapped[str] = mapped_column(String(140), nullable=False, server_default=text("''"))
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    link_label: Mapped[str] = mapped_column(String(60), nullable=False, server_default=text("''"))
    link_url: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # Kanonik bağ: sayfa, koleksiyonun sabit kimliğine referans verir. Böylece
    # koleksiyonun yeni yayın sürümü onu kullanan bütün canlı sayfalara yansır.
    # `product_set_revision_id` eski yayınların geri okunması için geçiş boyunca
    # korunur; yeni taslaklar `product_set_id` yazar.
    product_set_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_sets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    product_set_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_set_revisions.id", ondelete="RESTRICT"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    revision: Mapped[StoreLandingPageRevision] = relationship(back_populates="blocks")

    __table_args__ = (
        UniqueConstraint("revision_id", "block_key", name="uq_store_landing_page_block_key"),
        ForeignKeyConstraint(
            ["product_set_id", "product_set_revision_id"],
            ["product_set_revisions.product_set_id", "product_set_revisions.id"],
            ondelete="RESTRICT",
            name="fk_store_landing_page_block_product_revision",
        ),
        CheckConstraint("sort_order >= 0", name="ck_store_landing_page_block_sort"),
        CheckConstraint(
            "block_type IN ('HERO_CAROUSEL', 'IMAGE_CARD_GRID', 'CATEGORY_GRID', "
            "'PRODUCT_RAIL', 'BANNER', 'RICH_TEXT', 'RECENTLY_VIEWED', 'CARD_ROW')",
            name="ck_store_landing_page_block_type",
        ),
        CheckConstraint("jsonb_typeof(config) = 'object'", name="ck_store_landing_page_block_config"),
    )


class StoreLandingPagePublication(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_landing_page_publications"

    id: Mapped[int] = mapped_column(primary_key=True)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("store_landing_pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_id: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    publication_window: Mapped[object] = mapped_column(
        TSTZRANGE,
        Computed(
            "tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)')",
            persisted=True,
        ),
        nullable=False,
    )
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["page_id", "revision_id"],
            ["store_landing_page_revisions.page_id", "store_landing_page_revisions.id"],
            ondelete="RESTRICT",
            name="fk_store_page_publication_revision_page",
        ),
        Index("ix_store_landing_page_publications_window", "page_id", "starts_at", "ends_at"),
        CheckConstraint("ends_at IS NULL OR ends_at > starts_at", name="ck_store_landing_page_publication_window"),
        ExcludeConstraint(
            ("page_id", "="),
            ("publication_window", "&&"),
            using="gist",
            where=text("deleted_at IS NULL"),
            name="ex_store_landing_page_publication_window",
        ),
    )


class StoreLandingPageRedirect(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_landing_page_redirects"

    id: Mapped[int] = mapped_column(primary_key=True)
    old_slug: Mapped[str] = mapped_column(String(140), nullable=False)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("store_landing_pages.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        Index(
            "uq_store_landing_page_redirects_slug_active",
            "old_slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class StoreMediaAsset(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_media_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    alt_text: Mapped[str] = mapped_column(String(180), nullable=False, server_default=text("''"))
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("width > 0 AND height > 0", name="ck_store_media_asset_dimensions"),
        CheckConstraint("file_size > 0", name="ck_store_media_asset_size"),
    )


class StorePageDailyMetric(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_page_daily_metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    metric_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    page_revision_id: Mapped[int] = mapped_column(
        ForeignKey("store_landing_page_revisions.id", ondelete="CASCADE"), nullable=False
    )
    block_key: Mapped[str] = mapped_column(String(36), nullable=False, server_default=text("''"))
    # 0 = ürün-özgül olmayan sayfa/blok olayı. Günlük UPSERT anahtarında NULL
    # benzersiz sayılmadığı için bilinçli sentinel kullanılır; ticari FK değildir.
    product_id: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        UniqueConstraint(
            "metric_date", "page_revision_id", "block_key", "product_id", "event_type",
            name="uq_store_page_daily_metric_bucket",
        ),
        CheckConstraint(
            "event_type IN ('PAGE_VIEW', 'BLOCK_CLICK', 'PRODUCT_CLICK')",
            name="ck_store_page_daily_metric_type",
        ),
        CheckConstraint("event_count >= 0", name="ck_store_page_daily_metric_count"),
    )
