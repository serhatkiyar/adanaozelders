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


PAYMENT_CHANNEL_ESCROW = "ESCROW"
PAYMENT_CHANNEL_DIRECT = "DIRECT"


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
    # İlk ders ücretsiz talebi mi? Açıksa price=0 ve ödeme adımı atlanır.
    is_free_lesson: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ders biçimi: 'ONLINE' (uzaktan) | 'IN_PERSON' (yüzyüze). Canlı link yalnız ONLINE'da.
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Ücret nereden ödenir — İLK kabulde sabitlenir, sonra değişmez (erteleme
    # dahil). ESCROW: platformda kartla, emanetli. DIRECT: eğitmene doğrudan,
    # platform dışında ("takvim randevusu"; pazaryeri kolu kapalıyken). NULL:
    # henüz kabul edilmedi. Global bayrağa her seferinde bakılsaydı pazaryeri
    # açıldığı gün eski doğrudan ödemeli dersler sessizce ödeme borcuna dönerdi.
    payment_channel: Mapped[str | None] = mapped_column(String(10), nullable=True)
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

    # Öğrenci onayı / sorun bildirimi (Modül 2). Onay ya da onay penceresinin
    # dolması emaneti eğitmene geçirir; sorun bildirimi `is_disputed`'ı açar ve
    # para admin kararına kadar emanette kalır.
    student_confirmed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    issue_reported_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: TUTOR_ABSENT | LESSON_NOT_HELD | OTHER
    issue_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    issue_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Öğrenci derse 12 saatten az kala iptal etti; ödenmiş ücret eğitmene geçti.
    late_cancel: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # İptali kimin yaptığı (Modül 7): rol id'si (ADMIN/TUTOR/CLIENT) ve anı.
    # Analizlerdeki iptal oranı ve kaçırılan ders metrikleri buradan okur;
    # bu kolonlardan önce iptal edilmiş derslerde NULL kalır.
    cancelled_by_role: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Dersi eğitmen teklif etti (Modül 8). PENDING'de bekleyen taraf DEĞİŞİR:
    #: normal talepte eğitmen yanıtlar, teklifte öğrenci kabul edip öder.
    offered_by_tutor: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    #: Haftalık seriden üretilen teklif; seri silinirse bağ düşer.
    series_id: Mapped[int | None] = mapped_column(
        ForeignKey("lesson_series.id", ondelete="SET NULL"), nullable=True
    )
    #: Öğretmen dersi başka zamana aldı ve öğrencinin yanıtı bekleniyor
    #: (24 Eyl 2026, Preply deseni): dersin ESKİ başlangıcı. Öğrenci "uygun"
    #: derse NULL olur; "uygun değil" derse ders iptal edilir ve ücret her
    #: durumda öğrenciye iade edilir. Doluyken öğrencinin iptali geç iptal
    #: sayılmaz.
    tutor_rescheduled_from: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Öğretmenin öğrenciye son "dersi onayla" hatırlatması (günde en fazla bir).
    confirm_reminded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: Canlı dersin sağlayıcısı ('zoom' | 'agora'). İlk giriş biletinde
    #: atomik olarak BİR KEZ atanır, sonra değişmez (iki taraf aynı odaya
    #: düşsün). NULL = henüz atanmadı; eski dersler varsayılana düşer.
    canli_ders_saglayici: Mapped[str | None] = mapped_column(String(10), nullable=True)

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
    payment: Mapped["Payment | None"] = relationship(
        "Payment", back_populates="booking", uselist=False,
        cascade="all, delete-orphan", lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_bookings_time_order"),
        CheckConstraint("qa_used >= 0 AND qa_used <= 3", name="ck_bookings_qa_quota"),
        CheckConstraint(
            "canli_ders_saglayici IS NULL OR canli_ders_saglayici IN ('zoom', 'agora')",
            name="ck_bookings_canli_ders_saglayici",
        ),
        ExcludeConstraint(
            ("tutor_id", "="),
            ("time_slot", "&&"),
            using="gist",
            where=text("status IN ('PENDING', 'ACCEPTED') AND deleted_at IS NULL"),
            name="ex_bookings_no_overlap",
        ),
        Index("ix_bookings_tutor_status", "tutor_id", "status"),
        Index("ix_bookings_client", "client_id"),
        # Sağlayıcı ataması: bu ay o sağlayıcıya atanmış derslerin süre toplamı.
        Index(
            "ix_bookings_canli_ders_saglayici_start",
            "canli_ders_saglayici",
            "start_at",
            postgresql_where=text("canli_ders_saglayici IS NOT NULL"),
        ),
        # Admin ders listesi (created_at DESC LIMIT 50). Bu index olmadan
        # Postgres 60.000 satırın tamamını okuyup eğitmen/öğrenci ile join
        # ediyor, sonra 50 tanesini alıyordu (ölçüm: 250 ms).
        Index(
            "ix_bookings_created_desc",
            text("created_at DESC"),
            text("id DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Liderlik tablosu: tamamlanan ders sayısına göre öğrenci/eğitmen sıralaması.
        Index(
            "ix_bookings_completed_client",
            "client_id",
            postgresql_where=text("status = 'COMPLETED' AND deleted_at IS NULL"),
        ),
        Index(
            "ix_bookings_completed_tutor",
            "tutor_id",
            postgresql_where=text("status = 'COMPLETED' AND deleted_at IS NULL"),
        ),
        Index(
            "ix_bookings_pair_status",
            "client_id",
            "tutor_id",
            "status",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_bookings_series",
            "series_id",
            postgresql_where=text("series_id IS NOT NULL"),
        ),
    )
