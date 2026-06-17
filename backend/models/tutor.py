from __future__ import annotations

import datetime
import enum

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed

from core.database import Base
from models.mixins import (
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    SoftDeleteMixin,
    TimestampMixin,
)


class TutorStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


class Gender(str, enum.Enum):
    MALE = "MALE"
    FEMALE = "FEMALE"
    UNSPECIFIED = "UNSPECIFIED"


class Tutor(
    Base, NameMixin, TimestampMixin, SoftDeleteMixin, LastSeenMixin, EmailVerificationMixin
):
    __tablename__ = "tutors"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )

    status: Mapped[TutorStatus] = mapped_column(
        SAEnum(TutorStatus, name="tutor_status"),
        nullable=False,
        server_default=text("'DRAFT'"),
    )
    headline: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    hourly_rate: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    teaching_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    about: Mapped[str | None] = mapped_column(Text, nullable=True)

    birth_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        SAEnum(Gender, name="gender"), nullable=True
    )

    # Yüzyüze ders için eğitmenin baz konumu ("yakınımdaki eğitmenler" araması).
    location_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)

    rating_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    rating_sum: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', coalesce(headline, '') || ' ' || coalesce(bio, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    role: Mapped["Role"] = relationship()
    educations: Mapped[list["TutorEducation"]] = relationship(
        back_populates="tutor", cascade="all, delete-orphan"
    )
    bookings: Mapped[list["Booking"]] = relationship(back_populates="tutor")
    qa_threads: Mapped[list["QAThread"]] = relationship(back_populates="tutor")
    practice_exams: Mapped[list["PracticeExam"]] = relationship(back_populates="tutor")
    reviews: Mapped[list["Review"]] = relationship(back_populates="tutor")
    subject_links: Mapped[list["TutorSubject"]] = relationship(
        cascade="all, delete-orphan"
    )
    availability_links: Mapped[list["TutorAvailability"]] = relationship(
        cascade="all, delete-orphan",
        order_by="TutorAvailability.weekday, TutorAvailability.start_minute",
    )

    __table_args__ = (
        Index(
            "uq_tutors_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_tutors_username_active",
            "username",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_tutors_search_vector", "search_vector", postgresql_using="gin"),
        # Ad-soyad fuzzy araması için fonksiyonel trgm index init_db migration'ında oluşturulur
        # (first_name || ' ' || last_name); SQLAlchemy DDL'inde ifade-bazlı opclass kırılgan.
        Index("ix_tutors_status", "status"),
    )


class TutorEducation(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "tutor_educations"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_name: Mapped[str] = mapped_column(String(200), nullable=False)
    degree: Mapped[str | None] = mapped_column(String(100), nullable=True)
    field_of_study: Mapped[str | None] = mapped_column(String(150), nullable=True)
    start_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Diploma/belge kanıtı (PDF/görsel). Eğitmen onaya gönderirken en az bir
    # eğitimde bu zorunludur (bkz. tutor_service.submit_for_approval).
    document_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    document_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── Diploma doğrulama (admin + e-Devlet barkod) ──
    # Belge türü: DIPLOMA | DENKLIK | OGRENCI_BELGESI (yurt dışı denklik / öğrenci belgesi).
    document_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # e-Devlet "Belge Doğrulama" barkod/doğrulama kodu (admin resmî sayfada teyit eder).
    verification_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Belge sahibinin TCKN'si — e-Devlet doğrulamasında barkodun yanında 2. faktör.
    # Yalnız admin görür (e-Devlet teyidi); public'e ASLA dönmez. KVKK: amaçla sınırlı.
    # TODO(kimlik temeli): iyzico kimlik adımıyla tutor seviyesine taşı + şifreli sakla.
    verification_tckn: Mapped[str | None] = mapped_column(String(11), nullable=True)
    # NONE (belge yok) | PENDING (teyit bekliyor) | VERIFIED | REJECTED.
    verification_status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default="NONE"
    )
    verified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Teyit eden admin id'si (admins ayrı tablo → FK yok, salt iz).
    verified_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Reddedildiyse admin notu (eğitmene gösterilir).
    verification_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    tutor: Mapped["Tutor"] = relationship(back_populates="educations")


class TutorSubject(Base):
    __tablename__ = "tutor_subjects"

    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), primary_key=True
    )
    subject: Mapped[str] = mapped_column(String(100), primary_key=True)

    __table_args__ = (Index("ix_tutor_subjects_subject", "subject"),)


class TutorAvailability(Base):
    __tablename__ = "tutor_availability"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 0=Pazartesi … 6=Pazar (Python date.weekday()). Dakika: gece yarısından itibaren.
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    start_minute: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    end_minute: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "weekday >= 0 AND weekday <= 6", name="ck_tutor_avail_weekday"
        ),
        CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute",
            name="ck_tutor_avail_range",
        ),
    )
