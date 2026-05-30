from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.client import Client
from models.exam import PracticeExam, PracticeExamSubject
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.exam import PracticeExamCreate


def _compute_net(correct: int, wrong: int, penalty: float) -> Decimal:
    net = correct - wrong / penalty
    return Decimal(str(round(net, 2)))


async def create_exam(
    db: AsyncSession, client: Client, data: PracticeExamCreate
) -> PracticeExam:
    if data.tutor_id is not None:
        tutor = await db.get(Tutor, data.tutor_id)
        if tutor is None or tutor.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Tutor not found")

    penalty = data.wrong_penalty
    # Konu kırılımı varsa totaller ondan toplanır; yoksa tekil sayımlar kullanılır.
    if data.subjects:
        correct = sum(s.correct_count for s in data.subjects)
        wrong = sum(s.wrong_count for s in data.subjects)
        blank = sum(s.blank_count for s in data.subjects)
    else:
        correct, wrong, blank = data.correct_count, data.wrong_count, data.blank_count

    exam = PracticeExam(
        client_id=client.id,
        tutor_id=data.tutor_id,
        title=data.title,
        exam_type=data.exam_type,
        exam_date=data.exam_date,
        correct_count=correct,
        wrong_count=wrong,
        blank_count=blank,
        net_score=_compute_net(correct, wrong, penalty),
    )
    for s in data.subjects:
        exam.subjects.append(
            PracticeExamSubject(
                subject=s.subject,
                correct_count=s.correct_count,
                wrong_count=s.wrong_count,
                blank_count=s.blank_count,
                net_score=_compute_net(s.correct_count, s.wrong_count, penalty),
            )
        )
    db.add(exam)
    await db.flush()
    # subjects ile birlikte taze yükle (response serileştirmesi lazy-load tetiklemesin).
    return await db.scalar(
        select(PracticeExam)
        .options(selectinload(PracticeExam.subjects))
        .where(PracticeExam.id == exam.id)
    )


async def list_exams(
    db: AsyncSession,
    *,
    role_id: int,
    user_id: int,
    limit: int = 20,
    offset: int = 0,
) -> list[PracticeExam]:
    stmt = (
        select(PracticeExam)
        .options(selectinload(PracticeExam.subjects))
        .where(PracticeExam.deleted_at.is_(None))
    )
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        stmt = stmt.where(PracticeExam.client_id == user_id)
    elif role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = stmt.where(PracticeExam.tutor_id == user_id)
    else:
        return []
    stmt = (
        stmt.order_by(
            PracticeExam.exam_date.desc().nullslast(),
            PracticeExam.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())
