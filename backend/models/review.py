from __future__ import annotations

import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import ModeratableMixin, SoftDeleteMixin, TimestampMixin


class Review(Base, TimestampMixin, SoftDeleteMixin, ModeratableMixin):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False
    )
    # Değerlendirme booking'e değil (client_id, tutor_id) çiftine aittir: bir
    # öğrenci bir öğretmeni tek kez değerlendirir, sonra aynı kaydı düzenler.
    # booking_id yalnız değerlendirme hakkını veren ilk dersin referansıdır.
    # Genel puan — alt kriterlerden hesaplanmaz, öğrencinin bağımsız puanıdır.
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    # İsteğe bağlı alt kriterler; NULL = puan verilmedi (ortalamaya girmez).
    clarity_rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    motivation_rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    preparation_rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    comment_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Anonimse public/öğretmen yüzeylerine ad, fotoğraf ve kimlik alanları gitmez.
    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # "Düzenlendi" etiketinin kaynağı. updated_at DEĞİL: moderasyon gibi sistem
    # işlemleri updated_at'i değiştirir. Yalnız sahibi puanları veya yorum
    # metnini gerçekten değiştirdiğinde dolar (anonimlik tercihi saymaz).
    edited_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Kullanılmıyor: öğretmen yanıtı özelliği kaldırıldı (23 Eyl 2026). Kolon
    # veri kaybı olmasın diye duruyor; okunmaz, API'de dönmez.
    tutor_reply: Mapped[str | None] = mapped_column(Text, nullable=True)

    booking: Mapped["Booking"] = relationship(back_populates="review")
    client: Mapped["Client"] = relationship(back_populates="reviews")
    tutor: Mapped["Tutor"] = relationship(back_populates="reviews")

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating_range"),
        CheckConstraint(
            "clarity_rating IS NULL OR clarity_rating BETWEEN 1 AND 5",
            name="ck_reviews_clarity_range",
        ),
        CheckConstraint(
            "motivation_rating IS NULL OR motivation_rating BETWEEN 1 AND 5",
            name="ck_reviews_motivation_range",
        ),
        CheckConstraint(
            "preparation_rating IS NULL OR preparation_rating BETWEEN 1 AND 5",
            name="ck_reviews_preparation_range",
        ),
        Index(
            "uq_reviews_booking_active",
            "booking_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Öğrenci–öğretmen başına tek aktif değerlendirme (soft-delete'li
        # kayıt yeni değerlendirmeyi engellemesin diye kısmi).
        Index(
            "uq_reviews_client_tutor_active",
            "client_id",
            "tutor_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_reviews_tutor", "tutor_id"),
        Index("ix_reviews_client", "client_id"),
    )
