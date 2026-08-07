from __future__ import annotations

import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint, Range, TSTZRANGE
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

# Kayıt durumları ExamRegistration ile aynı sözlüğü paylaşır (RegistrationStatus).
from models.library_exam import RegistrationStatus  # noqa: F401  (re-export kolaylığı)


class StudyReservation(Base, TimestampMixin, SoftDeleteMixin):
    """Bir öğrencinin kütüphane çalışma alanında saatlik koltuk rezervasyonu.

    Belirli koltuk DEĞİL, kontenjan bazlı: [starts_at, ends_at) penceresinde boş
    kapasite varsa rezerve edilir. Ücret = saatlik ücret × süre. Escrow + QR akışı
    deneme oturumlarıyla (ExamRegistration) aynıdır: öğrenci öder (HELD) → oturum günü
    QR okutur → operatör doğrular (ATTENDED, RELEASED). No-show iadesi yoktur.
    """

    __tablename__ = "study_reservations"

    id: Mapped[int] = mapped_column(primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )

    starts_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ends_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Ders tarafındaki `bookings.time_slot` ile birebir aynı desen: aralık
    # üretilmiş (generated) kolonda tutulur ki GiST exclusion kısıtı ve aralık
    # index'i ifade edilebilsin. İfadeyi kısıtın içine gömmek yerine kolon
    # yapmak, aynı aralığı okuyan sorguların da index'ten yararlanmasını sağlar.
    time_slot: Mapped[Range[datetime.datetime]] = mapped_column(
        TSTZRANGE,
        Computed("tstzrange(starts_at, ends_at, '[)')", persisted=True),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'PENDING_PAYMENT'")
    )
    # Ödeme bekleyen rezervasyonun koltuk TUTMA süresi — ExamRegistration ile
    # aynı sözleşme (bkz. services/library_capacity.py).
    hold_expires_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Escrow / ödeme (ExamRegistration ile aynı gömülü alanlar)
    hourly_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
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
    # İade niyeti (intent) — REFUNDING claim'inde damgalanır (bkz. services/escrow.py).
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    # QR giriş doğrulama
    qr_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # QR okutulamazsa operatörün elle gireceği kısa, insan-dostu kod (ör. '8F3K9Q').
    short_code: Mapped[str | None] = mapped_column(String(12), nullable=True, index=True)
    attended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attended_by_operator_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_operators.id", ondelete="SET NULL"), nullable=True
    )

    library: Mapped["Library"] = relationship()
    client: Mapped["Client"] = relationship()

    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_study_res_window"),
        Index("ix_study_res_window", "library_id", "starts_at", "ends_at"),
        Index("ix_study_res_status", "status"),
        # Aynı öğrenci, aynı kütüphanede çakışan İKİ ödenmiş rezervasyon tutamaz
        # — ders tarafındaki `ex_bookings_no_overlap` deseninin birebir kardeşi.
        #
        # ⚠️ Bu kısıt KÜTÜPHANE KAPASİTESİNİ zorlamaz ve zorlayamaz: exclusion
        # "hiçbir iki satır çakışmasın" der, yani ancak kapasite=1'i ifade
        # ederdi. N koltuklu bir salonda sayı tabanlı kontenjan serileştirme
        # (advisory kilit + sayım) ister — bkz. services/library_capacity.py.
        # İkisi birbirinin yerine geçmez; ikisi de gerekir.
        ExcludeConstraint(
            ("client_id", "="),
            ("library_id", "="),
            ("time_slot", "&&"),
            using="gist",
            where=text("status IN ('PAID', 'ATTENDED') AND deleted_at IS NULL"),
            name="ex_study_res_client_no_overlap",
        ),
        # Bilet kodu tekilliği — ExamRegistration ile aynı gerekçe (P2-40).
        Index(
            "uq_study_res_qr_token",
            "qr_token",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_study_res_short_code",
            "short_code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Conservation invariant'ı DB'de: tutar daima komisyon + kütüphane kazancı.
        CheckConstraint(
            "amount = commission_amount + library_earning",
            name="ck_study_res_conservation",
        ),
        CheckConstraint(
            "commission_rate >= 0 AND commission_rate <= 1",
            name="ck_study_res_commission_rate_range",
        ),
    )
