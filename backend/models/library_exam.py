from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class ExamSessionStatus(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"


class RegistrationStatus(str, enum.Enum):
    """Kayıt + escrow yaşam döngüsü (tek enum).

    PENDING_PAYMENT → öğrenci kaydoldu, ödeme bekleniyor (kontenjan tutmaz).
    PAID            → öğrenci ödedi, tutar emanette (escrow HELD); kontenjan sayılır.
    ATTENDED        → operatör QR okuttu; emanet kütüphaneye serbest (RELEASED).
    CANCELLED       → ödeme öncesi iptal.
    REFUNDED        → (oturum admin tarafından iptal edilirse) iade edildi.
    """

    PENDING_PAYMENT = "PENDING_PAYMENT"
    PAID = "PAID"
    ATTENDED = "ATTENDED"
    CANCELLED = "CANCELLED"
    REFUNDED = "REFUNDED"


# Kontenjana sayılan / "aktif kayıt" durumları.
ACTIVE_REGISTRATION_STATUSES = (
    RegistrationStatus.PAID.value,
    RegistrationStatus.ATTENDED.value,
)


class LibraryExamSession(Base, TimestampMixin, SoftDeleteMixin):
    """Bir kütüphanenin düzenlediği ücretli deneme sınavı oturumu (TYT/AYT/YKS…).

    Etkinlik + biletleme modeli: öğrenci kaydolur, online öder (escrow), oturum günü
    kütüphaneci QR okutarak katılımı doğrular. ``price`` öğrencinin ödediği; komisyon
    sunucuda ``PLATFORM_COMMISSION_RATE`` ile düşülür, kalanı kütüphane kazancı.
    """

    __tablename__ = "library_exam_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exam_type: Mapped[str] = mapped_column(String(20), nullable=False)  # TYT/AYT/YKS…
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    starts_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)

    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )

    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=text("'SCHEDULED'")
    )

    library: Mapped["Library"] = relationship()
    registrations: Mapped[list["ExamRegistration"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("duration_minutes > 0", name="ck_exam_session_duration"),
        CheckConstraint("capacity > 0", name="ck_exam_session_capacity"),
        CheckConstraint("price >= 0", name="ck_exam_session_price"),
        Index("ix_exam_sessions_starts_at", "starts_at"),
    )


class ExamRegistration(Base, TimestampMixin, SoftDeleteMixin):
    """Bir öğrencinin bir deneme oturumuna kaydı + escrow ödemesi + QR bileti.

    Escrow alanları (amount/commission/library_earning) burada gömülüdür (booking
    Payment'tan ayrı, kendine yeterli akış); ``core/payments`` sağlayıcısı yalnız
    charge/refund için kullanılır. ``qr_token`` öğrencinin oturum günü göstereceği
    bilet kodudur (ödeme anında üretilir; operatör ucu kimlik doğrulamalı ve yalnız
    kendi kütüphanesinin oturumunu doğrulayabilir).
    """

    __tablename__ = "exam_registrations"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("library_exam_sessions.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'PENDING_PAYMENT'")
    )

    # Escrow / ödeme
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    commission_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    library_earning: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    commission_rate: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paid_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    released_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refunded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # QR yoklama — öğrencinin gösterdiği bilet kodu (ödeme anında üretilir).
    qr_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    attended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attended_by_operator_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_operators.id", ondelete="SET NULL"), nullable=True
    )

    session: Mapped["LibraryExamSession"] = relationship(back_populates="registrations")
    client: Mapped["Client"] = relationship()

    __table_args__ = (
        Index(
            "uq_exam_reg_session_client_active",
            "session_id",
            "client_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_exam_reg_client", "client_id"),
        Index("ix_exam_reg_status", "status"),
    )
