from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models.mixins import TimestampMixin


class LessonSeriesStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"


class LessonSeries(Base, TimestampMixin):
    """Eğitmenin haftalık ders teklifi serisi.

    Seri kendisi bir ders değildir: her hafta bir `PENDING` + `offered_by_tutor`
    teklif (`Booking.series_id`) üretir. Para yükümlülüğü yalnız öğrenci o
    teklifi kabul edince doğar (ders başına emanet). 14 günlük pencereye düşen
    haftalar kayıtta, sonrakiler pencere açıldıkça arka plan işiyle
    (`lesson_series_service.generate_due`) teklif olur.

    Zaman İstanbul saatiyle tutulur (`weekday`, `start_minute`, `first_date`).
    Durum PG enum yerine String kolonda (`LessonSeriesStatus`).
    """

    __tablename__ = "lesson_series"

    id: Mapped[int] = mapped_column(primary_key=True)
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="RESTRICT"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False
    )
    #: 0=Pazartesi … 6=Pazar (İstanbul).
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Gece yarısından itibaren dakika (İstanbul).
    start_minute: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    duration_min: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: İlk dersin İstanbul tarihi.
    first_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    weeks: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Eğitmenin girdiği ders başı ücret; NULL ise ilan ücreti. Her üretimde
    #: `min(price, güncel ilan ücreti × süre)` uygulanır.
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'ACTIVE'")
    )
    #: Son denenen haftanın İstanbul tarihi; her hafta yalnız bir kez denenir.
    generated_until: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    ended_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Seriyi bitiren rol id'si; NULL = doğal bitiş (son hafta ya da kabul yok).
    ended_by_role: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    __table_args__ = (
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_lesson_series_weekday"),
        CheckConstraint(
            "start_minute >= 0 AND start_minute <= 1439", name="ck_lesson_series_start"
        ),
        CheckConstraint(
            "duration_min IN (30, 60, 90, 120)", name="ck_lesson_series_duration"
        ),
        CheckConstraint("weeks >= 2 AND weeks <= 12", name="ck_lesson_series_weeks"),
        CheckConstraint(
            "status IN ('ACTIVE', 'ENDED')", name="ck_lesson_series_status"
        ),
        Index("ix_lesson_series_pair", "tutor_id", "client_id"),
        Index(
            "ix_lesson_series_active",
            "status",
            postgresql_where=text("status = 'ACTIVE'"),
        ),
    )
