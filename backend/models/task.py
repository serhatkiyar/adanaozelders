from __future__ import annotations

import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

# Öncelik tamsayı olarak tutulur (Todoist deseni): 1=P1 (acil/kırmızı) … 4=P4 (varsayılan).
PRIORITY_MIN = 1
PRIORITY_MAX = 4
PRIORITY_DEFAULT = 4


# Görev ↔ etiket çoka-çok bağ tablosu.
task_label_links = Table(
    "task_label_links",
    Base.metadata,
    Column(
        "task_id",
        ForeignKey("tasks.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "label_id",
        ForeignKey("task_labels.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class TaskList(Base, TimestampMixin, SoftDeleteMixin):
    """Görev listesi / proje. Sahiplik (user_id, role_id) çiftiyle belirlenir.
    ``is_inbox`` doluysa kullanıcının silinemeyen varsayılan 'Gelen Kutusu'dur."""

    __tablename__ = "task_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # UI rengi (hex; örn '#6366f1') ya da preset etiketi.
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_inbox: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    tasks: Mapped[list["Task"]] = relationship(
        back_populates="task_list", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_task_lists_owner", "user_id", "role_id"),
    )


class TaskLabel(Base, TimestampMixin, SoftDeleteMixin):
    """Projeler-arası etiket (@etiket). Sahiplik (user_id, role_id) çiftiyle."""

    __tablename__ = "task_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    __table_args__ = (
        Index("ix_task_labels_owner", "user_id", "role_id"),
    )


class Task(Base, TimestampMixin, SoftDeleteMixin):
    """Tek görev. Sahiplik listesinden (TaskList) türetilir. İsteğe bağlı olarak
    bir derse (booking) bağlanabilir ve tekrarlayan (recurrence) olabilir."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("task_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 1=P1 … 4=P4 (varsayılan). bkz. PRIORITY_* sabitleri.
    priority: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("4")
    )
    due_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Tekrar kuralı (örn 'daily', 'weekly', 'monthly', 'weekdays'); yoksa null.
    recurrence: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Doluysa görev tamamlanmıştır; null ise aktiftir.
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Son tarih hatırlatma bildirimi gönderildi mi (arka plan döngüsü için).
    # due_at değişince / tekrar yuvarlanınca sıfırlanır.
    reminder_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Opsiyonel ders bağı; ders silinirse görev kalır (SET NULL).
    booking_id: Mapped[int | None] = mapped_column(
        ForeignKey("bookings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    task_list: Mapped["TaskList"] = relationship(back_populates="tasks")
    subtasks: Mapped[list["Subtask"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", lazy="selectin"
    )
    labels: Mapped[list["TaskLabel"]] = relationship(
        secondary=task_label_links, lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint(
            "priority BETWEEN 1 AND 4", name="ck_tasks_priority_range"
        ),
        Index("ix_tasks_list_due", "list_id", "due_at"),
    )


class Subtask(Base, TimestampMixin, SoftDeleteMixin):
    """Bir göreve ait alt görev (kontrol listesi maddesi)."""

    __tablename__ = "subtasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    is_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    task: Mapped["Task"] = relationship(back_populates="subtasks")
