from __future__ import annotations

import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class TutorTimeOff(Base, TimestampMixin):
    """Eğitmenin izin aralığı (Modül 7).

    Haftalık müsaitlik şablonunun (`TutorAvailability`) istisnasıdır: aralık
    boyunca yeni ders alınmaz, onaylanmaz ve ertelenemez. Soft-delete yoktur;
    izin kaldırılınca satır silinir (iptal edilmiş dersler geri gelmez).
    """

    __tablename__ = "tutor_time_off"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_tutor_time_off_order"),
        # Aynı eğitmenin iki izni çakışamaz; servis kilit altında kontrol eder,
        # bu kısıt son savunma hattıdır.
        ExcludeConstraint(
            ("tutor_id", "="),
            (text("tstzrange(start_at, end_at, '[)')"), "&&"),
            using="gist",
            name="ex_tutor_time_off_no_overlap",
        ),
        Index("ix_tutor_time_off_tutor_start", "tutor_id", "start_at"),
    )
