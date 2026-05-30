from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.tutor import Gender, Tutor, TutorAvailability, TutorStatus, TutorSubject
from schemas.education import EducationOut
from schemas.tutor import AvailabilityOut, TutorSearchOut, TutorSort
from services import education_service
from services.ranking import bayesian_average, bayesian_score_expr, compute_global_mean


def _years_ago(years: int) -> datetime.date:
    today = datetime.date.today()
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 Şubat
        return today.replace(year=today.year - years, day=28)


def _to_search_out(
    tutor: Tutor,
    prior_mean: float,
    confidence: float,
    *,
    educations: list | None = None,
    subjects: list[str] | None = None,
    availability: list | None = None,
) -> TutorSearchOut:
    return TutorSearchOut(
        id=tutor.id,
        full_name=tutor.full_name,
        avatar_url=tutor.avatar_url,
        headline=tutor.headline,
        bio=tutor.bio,
        hourly_rate=tutor.hourly_rate,
        teaching_mode=tutor.teaching_mode,
        gender=tutor.gender,
        birth_date=tutor.birth_date,
        last_seen_at=tutor.last_seen_at,
        rating_count=tutor.rating_count,
        rating_average=(
            tutor.rating_sum / tutor.rating_count if tutor.rating_count else None
        ),
        bayesian_score=bayesian_average(
            tutor.rating_sum, tutor.rating_count, prior_mean, confidence
        ),
        subjects=subjects or [],
        availability=[
            AvailabilityOut.model_validate(a) for a in (availability or [])
        ],
        educations=[EducationOut.model_validate(e) for e in (educations or [])],
    )


async def search_tutors(
    db: AsyncSession,
    *,
    q: str | None = None,
    min_rate: Decimal | None = None,
    max_rate: Decimal | None = None,
    modes: list[str] | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    sort: TutorSort | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[TutorSearchOut]:
    prior_mean = await compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    score = bayesian_score_expr(prior_mean, confidence)

    stmt = (
        select(Tutor)
        .options(selectinload(Tutor.subject_links))
        .where(
            Tutor.status == TutorStatus.APPROVED,
            Tutor.is_active.is_(True),
            Tutor.deleted_at.is_(None),
        )
    )

    if subjects:
        stmt = stmt.where(
            Tutor.id.in_(
                select(TutorSubject.tutor_id).where(
                    TutorSubject.subject.in_(subjects)
                )
            )
        )

    relevance = None
    if q:
        tsquery = func.websearch_to_tsquery("simple", q)
        stmt = stmt.where(
            or_(
                Tutor.search_vector.op("@@")(tsquery),
                Tutor.full_name.op("%")(q),
            )
        )
        relevance = func.ts_rank(Tutor.search_vector, tsquery) + func.similarity(
            Tutor.full_name, q
        )

    if min_rate is not None:
        stmt = stmt.where(Tutor.hourly_rate >= min_rate)
    if max_rate is not None:
        stmt = stmt.where(Tutor.hourly_rate <= max_rate)

    if modes:
        # "Uzaktan" istenirse ONLINE+BOTH, "Yüzyüze" istenirse IN_PERSON+BOTH eşleşir.
        acceptable: set[str] = set()
        for m in modes:
            acceptable.add(m)
            acceptable.add("BOTH")
        stmt = stmt.where(Tutor.teaching_mode.in_(acceptable))

    if gender is not None:
        stmt = stmt.where(Tutor.gender == gender)
    # Yaş, birth_date aralığına çevrilir (age kolonu saklanmaz → güncel + indekslenebilir).
    if min_age is not None:
        stmt = stmt.where(Tutor.birth_date <= _years_ago(min_age))
    if max_age is not None:
        stmt = stmt.where(Tutor.birth_date > _years_ago(max_age + 1))

    if sort == TutorSort.PRICE_ASC:
        stmt = stmt.order_by(Tutor.hourly_rate.asc().nulls_last(), score.desc())
    elif sort == TutorSort.PRICE_DESC:
        stmt = stmt.order_by(Tutor.hourly_rate.desc().nulls_last(), score.desc())
    elif sort == TutorSort.RATING_DESC:
        stmt = stmt.order_by(score.desc(), Tutor.created_at.desc())
    elif relevance is not None:
        stmt = stmt.order_by(score.desc(), relevance.desc())
    else:
        stmt = stmt.order_by(score.desc(), Tutor.created_at.desc())

    stmt = stmt.limit(limit).offset(offset)

    tutors = (await db.execute(stmt)).scalars().all()
    return [
        _to_search_out(
            tutor,
            prior_mean,
            confidence,
            subjects=[link.subject for link in tutor.subject_links],
        )
        for tutor in tutors
    ]


async def get_tutor_public(db: AsyncSession, tutor_id: int) -> TutorSearchOut:
    tutor = await db.get(Tutor, tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or tutor.status != TutorStatus.APPROVED
        or not tutor.is_active
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tutor not found")
    prior_mean = await compute_global_mean(db)
    educations = await education_service.list_by(
        db, role_id=tutor.role_id, owner_id=tutor.id
    )
    subj_rows = await db.execute(
        select(TutorSubject.subject)
        .where(TutorSubject.tutor_id == tutor.id)
        .order_by(TutorSubject.subject)
    )
    avail_rows = (
        await db.execute(
            select(TutorAvailability)
            .where(TutorAvailability.tutor_id == tutor.id)
            .order_by(TutorAvailability.weekday, TutorAvailability.start_minute)
        )
    ).scalars().all()
    return _to_search_out(
        tutor,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        educations=educations,
        subjects=[r[0] for r in subj_rows.all()],
        availability=list(avail_rows),
    )
