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

from core.crypto import EncryptedString
from core.database import Base
from models.mixins import (
    AuthVersionMixin,
    EmailVerificationMixin,
    LastSeenMixin,
    NameMixin,
    PayoutMixin,
    PhoneVerificationMixin,
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
    Base,
    NameMixin,
    TimestampMixin,
    SoftDeleteMixin,
    LastSeenMixin,
    EmailVerificationMixin,
    PhoneVerificationMixin,
    PayoutMixin,
    AuthVersionMixin,
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
    # İlanda "Ders Hakkında" — dersin nasıl işlediği/metodoloji (Superprof tarzı).
    # `bio` eğitmenin kendisini, bu alan dersin akışını/yöntemini anlatır.
    lesson_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Tanıtım videosu (YouTube/Vimeo URL) — profilde gömülü oynatıcıyla gösterilir.
    intro_video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # İlk ders ücretsiz mi? Varsayılan açık; eğitmen kapatabilir. Açıkken öğrenci
    # ilk dersini ücretsiz talep edebilir (price=0, ödeme atlanır).
    first_lesson_free: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    birth_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        SAEnum(Gender, name="gender"), nullable=True
    )

    # Yüzyüze ders için eğitmenin baz konumu ("yakınımdaki eğitmenler" araması).
    location_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    # İlçe (Adana ilçeleri) — yapısal filtre; eğitmen onboarding'de seçer. Serbest
    # metin `location_text`'ten ayrı; aramadaki "İlçe" dropdown'ını besler. Index'li.
    district: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)

    rating_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    rating_sum: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            # tr_normalize: diakritik-duyarsız arama (bkz. migration dd737c387ff5).
            # Sorgu tarafı da aynı fonksiyondan geçer; iki taraf ayrılırsa
            # arama sessizce boş sonuç vermeye başlar.
            "to_tsvector('simple', tr_normalize("
            "coalesce(headline, '') || ' ' || coalesce(bio, '')))",
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

    @property
    def identity_verified(self) -> bool:
        """Ödeme hesabı (alt üye işyeri) onaylıysa kimlik doğrulanmış sayılır
        (iyzico MERNIS/IBAN kontrolünden geçti). Public 'Kimliği Doğrulanmış' rozeti."""
        return self.payout_status == "ACTIVE"

    __table_args__ = (
        Index(
            "uq_tutors_email_active",
            "email",
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
    # DB'de ŞİFRELİ (EncryptedString/Fernet); Python tarafı düz metinle çalışır.
    verification_tckn: Mapped[str | None] = mapped_column(
        EncryptedString(255), nullable=True
    )
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
    """Eğitmenin bildirdiği branş.

    ``subject`` metin kolonu KALIYOR ve bileşik PK'nin parçası olmayı sürdürüyor.
    İki sebep: (a) geriye uyum — arama, `attach_subjects` ve `TutorSearchOut`
    bugünkü gibi metin taşımaya devam eder; (b) taksonomide karşılığı olmayan
    gerçek bir branşı (ör. "Osmanlı Türkçesi Paleografyası") kaybetmemek.
    Kanonik derse bağ ``subject_id`` ile kurulur ve eşleşmeyen kayıtta NULL kalır.
    """

    __tablename__ = "tutor_subjects"

    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), primary_key=True
    )
    subject: Mapped[str] = mapped_column(String(100), primary_key=True)
    #: Kanonik ders bağı. NULL = taksonomiye eşlenememiş serbest metin.
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=True
    )

    __table_args__ = (
        Index("ix_tutor_subjects_subject", "subject"),
        Index("ix_tutor_subjects_subject_id", "subject_id"),
        # Aynı eğitmenin iki farklı serbest metni ("Fen", "Fen Bilgisi") aynı
        # kanonik derse bağlanıp listede çift görünmesin.
        Index(
            "uq_tutor_subjects_canonical",
            "tutor_id",
            "subject_id",
            unique=True,
            postgresql_where=text("subject_id IS NOT NULL"),
        ),
    )


class TutorSubjectLevel(Base):
    """Eğitmenin bir derste verdiği seviyeler (ör. Matematik → ilkokul, ortaokul).

    `tutor_subjects`'e YABANCI ANAHTAR YOK ve bu bilinçli: `_replace_subjects`
    her profil kaydında o eğitmenin tüm branş satırlarını SİLİP yeniden yazıyor.
    Bileşik FK, her kayıtta bu satırları da düşürür ya da yetim bırakırdı.
    Bütünlüğü servis sağlar: ders kaldırılınca seviyeleri de kaldırılır.
    """

    __tablename__ = "tutor_subject_levels"

    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), primary_key=True
    )
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="RESTRICT"), primary_key=True
    )
    level_id: Mapped[int] = mapped_column(
        ForeignKey("levels.id", ondelete="RESTRICT"), primary_key=True
    )


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
