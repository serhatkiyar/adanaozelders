from __future__ import annotations

import datetime

from sqlalchemy import Boolean, Date
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import (
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    PhoneVerificationMixin,
    SoftDeleteMixin,
    TimestampMixin,
)
from models.tutor import Gender


class Client(
    Base,
    NameMixin,
    TimestampMixin,
    SoftDeleteMixin,
    LastSeenMixin,
    EmailVerificationMixin,
    PhoneVerificationMixin,
):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    about: Mapped[str | None] = mapped_column(Text, nullable=True)

    birth_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        SAEnum(Gender, name="gender"), nullable=True
    )

    role: Mapped["Role"] = relationship()
    educations: Mapped[list["ClientEducation"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )
    bookings: Mapped[list["Booking"]] = relationship(back_populates="client")
    qa_threads: Mapped[list["QAThread"]] = relationship(back_populates="client")
    practice_exams: Mapped[list["PracticeExam"]] = relationship(back_populates="client")
    demands: Mapped[list["Demand"]] = relationship(back_populates="client")
    reviews: Mapped[list["Review"]] = relationship(back_populates="client")
    addresses: Mapped[list["ClientAddress"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_clients_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_clients_username_active",
            "username",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Admin kullanıcı listesi (created_at DESC LIMIT n).
        Index(
            "ix_clients_created_desc",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class ClientEducation(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "client_educations"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_name: Mapped[str] = mapped_column(String(200), nullable=False)
    degree: Mapped[str | None] = mapped_column(String(100), nullable=True)
    field_of_study: Mapped[str | None] = mapped_column(String(150), nullable=True)
    start_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    client: Mapped["Client"] = relationship(back_populates="educations")


class ClientAddress(Base, TimestampMixin, SoftDeleteMixin):
    """Öğrencinin kayıtlı (yeniden kullanılabilir) buluşma adresi.

    Yüzyüze rezervasyonda her seferinde adres yazmamak için; harita konumu
    (lat/lng) ile birlikte serbest metin detayları saklanır.
    """

    __tablename__ = "client_addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    # Alıcı adı + telefon (kargo firması deseni: adres başkası adına olabilir).
    # NULL → sipariş anında hesap sahibinin adı/telefonu kullanılır.
    recipient_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address_line: Mapped[str] = mapped_column(Text, nullable=False)
    # Yapısal il/ilçe (Cıncık Teslimat bölge kontrolü fallback'i; pin otorite).
    # Eski adreslerde NULL — müşteri adresi ilk düzenlediğinde dolar.
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    door_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    apt_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    directions: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    client: Mapped["Client"] = relationship(back_populates="addresses")
