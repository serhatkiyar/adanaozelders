from __future__ import annotations

import datetime
import enum

from sqlalchemy import DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class QAStatus(str, enum.Enum):
    OPEN = "OPEN"
    ANSWERED = "ANSWERED"
    CLOSED = "CLOSED"


class QAThread(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "qa_threads"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    tutor_id: Mapped[int] = mapped_column(
        ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False
    )
    # Soru, tamamlanmış bir derse (booking) bağlıdır; haklar ders bazında kümelenir.
    booking_id: Mapped[int | None] = mapped_column(
        ForeignKey("bookings.id", ondelete="SET NULL"), nullable=True
    )

    subject: Mapped[str | None] = mapped_column(String(150), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[QAStatus] = mapped_column(
        SAEnum(QAStatus, name="qa_status"),
        nullable=False,
        server_default=text("'OPEN'"),
    )
    answered_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    client: Mapped["Client"] = relationship(back_populates="qa_threads")
    tutor: Mapped["Tutor"] = relationship(back_populates="qa_threads")
    messages: Mapped[list["QAMessage"]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="QAMessage.created_at",
    )

    __table_args__ = (
        Index("ix_qa_threads_client_created", "client_id", "created_at"),
        Index("ix_qa_threads_tutor", "tutor_id"),
        Index("ix_qa_threads_booking", "booking_id"),
    )


class QAMessage(Base, TimestampMixin):
    __tablename__ = "qa_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(
        ForeignKey("qa_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_role: Mapped[str] = mapped_column(String(10), nullable=False)  # 'CLIENT'|'TUTOR'
    body: Mapped[str] = mapped_column(Text, nullable=False)

    thread: Mapped["QAThread"] = relationship(back_populates="messages")
