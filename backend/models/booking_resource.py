from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin


class BookingResource(Base, TimestampMixin):
    __tablename__ = "booking_resources"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    uploader_role: Mapped[str] = mapped_column(String(10), nullable=False)
    uploader_id: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # Harici link ("link") veya MinIO'ya yüklenmiş dosya ("file"). url her ikisinde
    # de erişim adresini tutar; file ise aşağıdaki meta alanlar dolar.
    kind: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'link'")
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    booking: Mapped["Booking"] = relationship(back_populates="resources")
