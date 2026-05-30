from __future__ import annotations

import datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class PracticeExam(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "practice_exams"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutors.id", ondelete="SET NULL"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    exam_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    exam_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)

    correct_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    wrong_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    blank_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    net_score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    client: Mapped["Client"] = relationship(back_populates="practice_exams")
    tutor: Mapped["Tutor"] = relationship(back_populates="practice_exams")
    subjects: Mapped[list["PracticeExamSubject"]] = relationship(
        back_populates="exam",
        cascade="all, delete-orphan",
        order_by="PracticeExamSubject.id",
    )

    __table_args__ = (
        CheckConstraint(
            "correct_count >= 0 AND wrong_count >= 0 AND blank_count >= 0",
            name="ck_practice_exams_non_negative",
        ),
        Index("ix_practice_exams_client_date", "client_id", "exam_date"),
    )


class PracticeExamSubject(Base, TimestampMixin):
    __tablename__ = "practice_exam_subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(
        ForeignKey("practice_exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    correct_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    wrong_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    blank_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    net_score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    exam: Mapped["PracticeExam"] = relationship(back_populates="subjects")

    __table_args__ = (
        CheckConstraint(
            "correct_count >= 0 AND wrong_count >= 0 AND blank_count >= 0",
            name="ck_practice_exam_subjects_non_negative",
        ),
    )
