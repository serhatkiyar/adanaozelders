from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class TaskPriority(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class TaskList(Base, TimestampMixin, SoftDeleteMixin):
    """Görev listesi / kategori. Birleşik kullanıcı tablosu olmadığından sahiplik
    (user_id, role_id) çiftiyle belirlenir (bkz. flashcard_decks / notifications)."""

    __tablename__ = "task_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # UI rozet rengi (hex ya da preset etiketi); zorunlu değil.
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    tasks: Mapped[list["Task"]] = relationship(
        back_populates="task_list", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_task_lists_owner", "user_id", "role_id"),
    )


class Task(Base, TimestampMixin, SoftDeleteMixin):
    """Tek görev. Sahiplik listesinden (TaskList) türetilir. İsteğe bağlı olarak
    bir derse (booking) bağlanabilir."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("task_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[TaskPriority] = mapped_column(
        SAEnum(TaskPriority, name="task_priority"),
        nullable=False,
        server_default=text("'MEDIUM'"),
    )
    due_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Doluysa görev tamamlanmıştır; null ise aktiftir.
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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

    __table_args__ = (
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
