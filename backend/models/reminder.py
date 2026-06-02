from __future__ import annotations

import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import TimestampMixin

# Hatırlatma tipleri ve durumları (PG enum yerine String + CheckConstraint —
# booking.status / habit.period deseni; create_all/stamp migration stratejisiyle uyumlu).
REMINDER_TYPES = ("relative", "absolute")
REMINDER_STATUSES = ("pending", "sent", "failed")


class TaskReminder(Base, TimestampMixin):
    """Bir göreve bağlı hatırlatma (Todoist tarzı). ``relative`` ise son tarihe
    göre ``offset_minutes`` kayar (örn -15 = 15 dk önce); ``absolute`` ise
    kullanıcının seçtiği ``remind_at`` anıdır. ``trigger_at`` her zaman hesaplanmış
    **UTC** çalıştırma anıdır (worker bunu yoklar). Sahiplik görevden türetilir;
    görev silinince hatırlatmalar da silinir (CASCADE). Soft-delete yok —
    görev güncellemesinde tüm hatırlatmalar yeniden yazılır (full replace)."""

    __tablename__ = "task_reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 'relative' | 'absolute'
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    # relative için: son tarihe göre dakika ofseti (negatif = önce). absolute'te NULL.
    offset_minutes: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # absolute için: kullanıcının seçtiği mutlak an (UTC). relative'te NULL.
    remind_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Hesaplanmış çalıştırma anı (UTC) — worker bunu yoklar.
    trigger_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    # 'pending' | 'sent' | 'failed'
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'pending'")
    )
    # İstemcinin yerel zaman dilimi (IANA, örn 'Europe/Istanbul') — bilgi amaçlı /
    # ileride sunucu tarafı yeniden hesap için. Hesap mutlak instant üzerinden yapılır.
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)

    task: Mapped["Task"] = relationship(back_populates="reminders")  # noqa: F821

    __table_args__ = (
        CheckConstraint(
            "type IN ('relative', 'absolute')", name="ck_reminder_type"
        ),
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed')", name="ck_reminder_status"
        ),
        Index("ix_task_reminders_due", "status", "trigger_at"),
    )
