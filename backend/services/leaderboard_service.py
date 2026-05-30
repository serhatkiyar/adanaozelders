from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.booking import Booking, BookingStatus
from models.client import Client
from models.exam import PracticeExam
from models.tutor import Tutor, TutorStatus

_LIMIT = 10


async def _entries(db: AsyncSession, stmt) -> list[dict]:
    return [
        {"id": r[0], "name": r[1], "value": float(r[2])}
        for r in (await db.execute(stmt)).all()
    ]


async def get_leaderboard(db: AsyncSession) -> dict:
    completed_lessons = func.count(Booking.id)

    tutors_by_lessons = await _entries(
        db,
        select(Tutor.id, Tutor.full_name, completed_lessons)
        .join(Booking, Booking.tutor_id == Tutor.id)
        .where(
            Booking.status == BookingStatus.COMPLETED,
            Booking.deleted_at.is_(None),
            Tutor.deleted_at.is_(None),
        )
        .group_by(Tutor.id)
        .order_by(completed_lessons.desc())
        .limit(_LIMIT),
    )

    rating_avg = (Tutor.rating_sum * 1.0 / Tutor.rating_count).label("avg")
    tutors_by_rating = await _entries(
        db,
        select(Tutor.id, Tutor.full_name, rating_avg)
        .where(
            Tutor.rating_count > 0,
            Tutor.deleted_at.is_(None),
            Tutor.status == TutorStatus.APPROVED,
        )
        .order_by(rating_avg.desc(), Tutor.rating_count.desc())
        .limit(_LIMIT),
    )

    student_lessons = func.count(Booking.id)
    students_by_lessons = await _entries(
        db,
        select(Client.id, Client.full_name, student_lessons)
        .join(Booking, Booking.client_id == Client.id)
        .where(
            Booking.status == BookingStatus.COMPLETED,
            Booking.deleted_at.is_(None),
            Client.deleted_at.is_(None),
        )
        .group_by(Client.id)
        .order_by(student_lessons.desc())
        .limit(_LIMIT),
    )

    best_net = func.max(PracticeExam.net_score)
    students_by_net = await _entries(
        db,
        select(Client.id, Client.full_name, best_net)
        .join(PracticeExam, PracticeExam.client_id == Client.id)
        .where(
            PracticeExam.deleted_at.is_(None),
            PracticeExam.net_score.is_not(None),
            Client.deleted_at.is_(None),
        )
        .group_by(Client.id)
        .order_by(best_net.desc())
        .limit(_LIMIT),
    )

    return {
        "tutors_by_lessons": tutors_by_lessons,
        "tutors_by_rating": tutors_by_rating,
        "students_by_lessons": students_by_lessons,
        "students_by_net": students_by_net,
    }
