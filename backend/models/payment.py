from __future__ import annotations

import datetime
import enum

from sqlalchemy import CheckConstraint, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class PaymentStatus(str, enum.Enum):
    PENDING = "PENDING"      # tutor kabul etti; öğrencinin ödemesi bekleniyor
    HELD = "HELD"            # öğrenci ödedi; tutar emanette (escrow)
    RELEASED = "RELEASED"    # ders tamamlandı; komisyon düşülüp eğitmene aktarıldı
    REFUNDING = "REFUNDING"  # iade niyeti kalıcı (claim); sağlayıcı teyidi bekleniyor
    REFUNDED = "REFUNDED"    # iptal/iade; öğrenciye geri ödendi
    FAILED = "FAILED"        # ödeme denemesi başarısız


class Payment(Base, TimestampMixin, SoftDeleteMixin):
    """Bir rezervasyonun escrow (emanet) ödemesi. Booking ile 1:1.

    Akış: tutor accept → PENDING; öğrenci öder → HELD (emanet); ders COMPLETED →
    RELEASED (eğitmen kazancı); iptal → REFUNDED. ``amount`` öğrencinin ödediği
    toplam; ``commission_amount`` platform payı; ``tutor_earning = amount - komisyon``.
    Tutarlar oluşturulurken booking.price ve PLATFORM_COMMISSION_RATE'ten hesaplanır.
    """

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )

    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    commission_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    tutor_earning: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    commission_rate: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )

    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus, name="payment_status"),
        nullable=False,
        server_default=text("'PENDING'"),
    )

    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    # Sağlayıcı tarafındaki işlem/token kimliği (iade/eşleştirme için).
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
    # İade niyeti (intent) — REFUNDING claim'inde damgalanır; reconciler karantina
    # penceresi ve deneme sınırı bu iki alandan yürür (bkz. services/escrow.py).
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    booking: Mapped["Booking"] = relationship(back_populates="payment")

    __table_args__ = (
        # Booking başına tek aktif ödeme (soft-delete'li kayıtlar hariç).
        Index(
            "uq_payments_booking_active",
            "booking_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_payments_status", "status"),
        # Para raporu dönem filtresi (services/revenue_service.py):
        # "son 30 günde ne kadar komisyon kazandık" sorusu bu kolondan geçer.
        Index(
            "ix_payments_created_at",
            "created_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Conservation invariant'ı DB'de: tutar daima komisyon + kazanç.
        CheckConstraint(
            "amount = commission_amount + tutor_earning",
            name="ck_payments_conservation",
        ),
        CheckConstraint(
            "commission_rate >= 0 AND commission_rate <= 1",
            name="ck_payments_commission_rate_range",
        ),
    )
