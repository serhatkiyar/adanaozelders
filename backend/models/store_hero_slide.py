"""Mağaza ana sayfasındaki yönetilebilir görsel carousel kayıtları."""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class StoreHeroSlide(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "store_hero_slides"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    mobile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Görsel üzerinde görünmez; ekran okuyucu ve içerik yönetimi içindir.
    alt_text: Mapped[str] = mapped_column(
        String(180), nullable=False, server_default=text("''")
    )
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    starts_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ends_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    __table_args__ = (
        Index(
            "ix_store_hero_slides_active_sort",
            "is_active",
            "sort_order",
            "deleted_at",
        ),
        CheckConstraint("sort_order >= 0", name="ck_store_hero_slides_sort_nonnegative"),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_store_hero_slides_end_after_start",
        ),
    )
