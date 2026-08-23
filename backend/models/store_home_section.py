"""Admin tarafından sıralanan mağaza ana sayfa içerik blokları."""

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class StoreHomeSection(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_home_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(180), nullable=False, server_default=text("''"))
    section_type: Mapped[str] = mapped_column(String(20), nullable=False)
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_label: Mapped[str] = mapped_column(
        String(60), nullable=False, server_default=text("'Tümünü gör'")
    )
    image_tiles: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        Index("ix_store_home_sections_active_sort", "is_active", "sort_order", "deleted_at"),
        CheckConstraint("sort_order >= 0", name="ck_store_home_sections_sort_nonnegative"),
        CheckConstraint(
            "section_type IN ('PRODUCT_RAIL', 'IMAGE_GRID', 'RECENTLY_VIEWED')",
            name="ck_store_home_sections_type",
        ),
        CheckConstraint(
            "jsonb_typeof(image_tiles) = 'array' AND jsonb_array_length(image_tiles) <= 4",
            name="ck_store_home_sections_image_tiles_array",
        ),
        CheckConstraint(
            "section_type <> 'IMAGE_GRID' OR jsonb_array_length(image_tiles) BETWEEN 1 AND 4",
            name="ck_store_home_sections_image_count",
        ),
        CheckConstraint(
            "section_type <> 'PRODUCT_RAIL' OR jsonb_array_length(image_tiles) = 0",
            name="ck_store_home_sections_product_no_images",
        ),
        CheckConstraint(
            "section_type <> 'RECENTLY_VIEWED' OR jsonb_array_length(image_tiles) = 0",
            name="ck_store_home_sections_recent_no_images",
        ),
        Index(
            "uq_store_home_sections_recently_viewed",
            "section_type",
            unique=True,
            postgresql_where=text(
                "section_type = 'RECENTLY_VIEWED' AND deleted_at IS NULL"
            ),
        ),
    )


class StoreHomeSectionItem(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_home_section_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(
        ForeignKey("store_home_sections.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        Index("ix_store_home_section_items_section_sort", "section_id", "sort_order", "deleted_at"),
        Index(
            "uq_store_home_section_items_active_product",
            "section_id",
            "product_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("sort_order >= 0", name="ck_store_home_section_items_sort_nonnegative"),
    )
