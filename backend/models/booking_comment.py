from __future__ import annotations

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin


class BookingComment(Base, TimestampMixin):
    __tablename__ = "booking_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    # index: ders detayı her açılışta bu tabloyu booking_id ile sorgular
    # (Booking.comments lazy="selectin"); indekssiz FK burada tam tarama demekti.
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_role: Mapped[str] = mapped_column(String(10), nullable=False)
    sender_id: Mapped[int] = mapped_column(nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    booking: Mapped["Booking"] = relationship(back_populates="comments")
