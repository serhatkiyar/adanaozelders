"""Mağaza hero görselinin üzerinde gösterilen yönetilebilir ürün kartları."""

from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class StoreShowcaseCard(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_showcase_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(180), nullable=False, server_default=text("''"))
    link_url: Mapped[str] = mapped_column(Text, nullable=False)
    link_label: Mapped[str] = mapped_column(
        String(60), nullable=False, server_default=text("'Keşfet'")
    )
    content_mode: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PRODUCTS'")
    )
    custom_tiles: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        Index("ix_store_showcase_cards_active_sort", "is_active", "sort_order", "deleted_at"),
        CheckConstraint("sort_order >= 0", name="ck_store_showcase_cards_sort_nonnegative"),
        CheckConstraint(
            "content_mode IN ('PRODUCTS', 'CUSTOM')",
            name="ck_store_showcase_cards_content_mode",
        ),
        CheckConstraint(
            "jsonb_typeof(custom_tiles) = 'array' AND jsonb_array_length(custom_tiles) <= 4",
            name="ck_store_showcase_cards_custom_tiles_array",
        ),
        CheckConstraint(
            "content_mode <> 'CUSTOM' OR jsonb_array_length(custom_tiles) BETWEEN 1 AND 4",
            name="ck_store_showcase_cards_custom_tiles_count",
        ),
    )


class StoreShowcaseCardItem(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_showcase_card_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("store_showcase_cards.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        Index("ix_store_showcase_card_items_card_sort", "card_id", "sort_order", "deleted_at"),
        Index(
            "uq_store_showcase_card_items_active_product",
            "card_id",
            "product_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("sort_order >= 0", name="ck_store_showcase_card_items_sort_nonnegative"),
    )
