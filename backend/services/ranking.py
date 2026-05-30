from __future__ import annotations

from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.tutor import Tutor, TutorStatus


def bayesian_average(
    rating_sum: float, rating_count: int, prior_mean: float, confidence: float
) -> float:
    return (rating_sum + confidence * prior_mean) / (rating_count + confidence)


def bayesian_score_expr(prior_mean: float, confidence: float):
    return (
        (Tutor.rating_sum + confidence * prior_mean)
        / (cast(Tutor.rating_count, Float) + confidence)
    ).label("bayesian_score")


async def compute_global_mean(db: AsyncSession) -> float:
    stmt = select(
        func.coalesce(func.sum(Tutor.rating_sum), 0),
        func.coalesce(func.sum(Tutor.rating_count), 0),
    ).where(Tutor.status == TutorStatus.APPROVED, Tutor.deleted_at.is_(None))
    total_sum, total_count = (await db.execute(stmt)).one()
    if not total_count:
        return settings.BAYESIAN_PRIOR_MEAN
    return float(total_sum) / float(total_count)
