from __future__ import annotations

import datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

# Tekrar periyodu: günlük (her gün) ya da haftalık (haftada N kez).
PERIOD_DAILY = "daily"
PERIOD_WEEKLY = "weekly"
PERIODS = (PERIOD_DAILY, PERIOD_WEEKLY)


class Habit(Base, TimestampMixin, SoftDeleteMixin):
    """Takip edilen bir alışkanlık. Birleşik kullanıcı tablosu olmadığından
    sahiplik (user_id, role_id) çiftiyle belirlenir (bkz. flashcard/notification
    deseni). Günlük (her gün) veya haftalık (haftada N gün) hedeflenebilir."""

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # UI rengi (hex; örn '#6366f1') ve isteğe bağlı emoji simgesi.
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # 'daily' = her gün hedef; 'weekly' = hafta içinde hedef.
    period: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'daily'")
    )
    # Periyot başına hedef: günlük=o gün kaç kez, haftalık=haftada kaç kez.
    target_per_period: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("1")
    )
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    entries: Mapped[list["HabitEntry"]] = relationship(
        back_populates="habit", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "period IN ('daily', 'weekly')", name="ck_habits_period"
        ),
        CheckConstraint(
            "target_per_period BETWEEN 1 AND 50",
            name="ck_habits_target_range",
        ),
        Index("ix_habits_owner", "user_id", "role_id"),
    )


class HabitEntry(Base, TimestampMixin):
    """Tek bir günün kayıt (check-in) satırı. Bir gün için en fazla bir satır
    (habit_id, entry_date benzersiz). Soft-delete YOK: işaret kaldırılınca satır
    fiziksel silinir — sayaç sıfıra inince de öyle (toggle/akümülatör log'u)."""

    __tablename__ = "habit_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(
        ForeignKey("habits.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Kullanıcının yerel günü (YYYY-MM-DD). İstemci kendi yerel gününü gönderir;
    # böylece TZ kayması olmadan "bugün" doğru hesaplanır.
    entry_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    # O gün kaç kez yapıldı (target_per_period > 1 için ilerleme).
    count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("1")
    )

    habit: Mapped["Habit"] = relationship(back_populates="entries")

    __table_args__ = (
        UniqueConstraint("habit_id", "entry_date", name="uq_habit_entry_day"),
        Index("ix_habit_entries_habit_date", "habit_id", "entry_date"),
    )
