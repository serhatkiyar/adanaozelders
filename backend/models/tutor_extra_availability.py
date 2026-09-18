from __future__ import annotations

import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class TutorExtraAvailability(Base, TimestampMixin):
    """Eğitmenin tek seferlik ek müsait aralığı.

    Haftalık şablonu (`TutorAvailability`) değiştirmeden belirli bir tarihte ek
    saat açar; müsaitlik o günün şablon pencereleri ile ek aralıkların
    birleşimidir (`booking_service.gun_araliklari`). İzin her zaman kazanır.
    İzin tablosunun aynası: soft-delete yoktur, kaldırılınca satır silinir ve
    aralıktaki mevcut dersler etkilenmez.
    """

    __tablename__ = "tutor_extra_availability"

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

    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_tutor_extra_order"),
        CheckConstraint(
            "end_at - start_at <= interval '24 hours'", name="ck_tutor_extra_max"
        ),
        # Aynı eğitmenin iki ek aralığı çakışamaz; servis kilit altında kontrol
        # eder, bu kısıt son savunma hattıdır.
        ExcludeConstraint(
            ("tutor_id", "="),
            (text("tstzrange(start_at, end_at, '[)')"), "&&"),
            using="gist",
            name="ex_tutor_extra_no_overlap",
        ),
        Index("ix_tutor_extra_tutor_start", "tutor_id", "start_at"),
    )
