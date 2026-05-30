from __future__ import annotations

import datetime
import enum

from sqlalchemy import Boolean, CheckConstraint, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Numeric, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint, Range, TSTZRANGE
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class BookingStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"


class Booking(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="RESTRICT"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False
    )

    status: Mapped[BookingStatus] = mapped_column(
        SAEnum(BookingStatus, name="booking_status"),
        nullable=False,
        server_default=text("'PENDING'"),
    )

    start_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    time_slot: Mapped[Range[datetime.datetime]] = mapped_column(
        TSTZRANGE,
        Computed("tstzrange(start_at, end_at, '[)')", persisted=True),
        nullable=False,
    )

    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ders biçimi: 'ONLINE' (uzaktan) | 'IN_PERSON' (yüzyüze). Canlı link yalnız ONLINE'da.
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Yüzyüze ders için buluşma yeri (serbest metin adres).
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    # Canlı ders odası (Jitsi oda adı; yalnızca uzaktan derste kabul edilince üretilir).
    meeting_room: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Ders öncesi hatırlatma bildirimi gönderildi mi (arka plan görevi için).
    reminder_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    qa_used: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )

    is_disputed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    tutor: Mapped["Tutor"] = relationship(back_populates="bookings")
    client: Mapped["Client"] = relationship(back_populates="bookings")
    review: Mapped["Review | None"] = relationship(
        back_populates="booking", uselist=False
    )
    resources: Mapped[list["BookingResource"]] = relationship(back_populates="booking", cascade="all, delete-orphan")
    comments: Mapped[list["BookingComment"]] = relationship(
        "BookingComment", back_populates="booking", cascade="all, delete-orphan", lazy="selectin"
    )
    private_notes: Mapped[list["BookingPrivateNote"]] = relationship(
        "BookingPrivateNote", back_populates="booking", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_bookings_time_order"),
        CheckConstraint("qa_used >= 0 AND qa_used <= 3", name="ck_bookings_qa_quota"),
        ExcludeConstraint(
            ("tutor_id", "="),
            ("time_slot", "&&"),
            using="gist",
            where=text("status IN ('PENDING', 'ACCEPTED') AND deleted_at IS NULL"),
            name="ex_bookings_no_overlap",
        ),
        Index("ix_bookings_tutor_status", "tutor_id", "status"),
        Index("ix_bookings_client", "client_id"),
        Index(
            "ix_bookings_pair_status",
            "client_id",
            "tutor_id",
            "status",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
