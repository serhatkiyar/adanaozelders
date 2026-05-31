from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client, ClientEducation
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorEducation
from schemas.education import EducationCreate, EducationUpdate

# role_id -> (education model, owner FK attribute name)
_EDUCATION_MODELS: dict[int, tuple[type, str]] = {
    ROLE_IDS[RoleType.TUTOR]: (TutorEducation, "tutor_id"),
    ROLE_IDS[RoleType.CLIENT]: (ClientEducation, "client_id"),
}


def _model_for(role_id: int) -> tuple[type, str]:
    entry = _EDUCATION_MODELS.get(role_id)
    if entry is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Education is not available for this role"
        )
    return entry


async def list_by(
    db: AsyncSession, *, role_id: int, owner_id: int
) -> list:
    model, fk = _model_for(role_id)
    stmt = (
        select(model)
        .where(getattr(model, fk) == owner_id, model.deleted_at.is_(None))
        .order_by(
            model.end_year.desc().nulls_first(),
            model.start_year.desc().nulls_last(),
            model.id.desc(),
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_own(db: AsyncSession, user: Tutor | Client) -> list:
    return await list_by(db, role_id=user.role_id, owner_id=user.id)


async def _get_owned_or_404(
    db: AsyncSession, user: Tutor | Client, education_id: int
):
    model, fk = _model_for(user.role_id)
    edu = await db.get(model, education_id)
    if (
        edu is None
        or edu.deleted_at is not None
        or getattr(edu, fk) != user.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Education not found")
    return edu


async def create(
    db: AsyncSession, user: Tutor | Client, data: EducationCreate
):
    model, fk = _model_for(user.role_id)
    edu = model(**{fk: user.id}, **data.model_dump())
    db.add(edu)
    await db.flush()
    await db.refresh(edu)
    return edu


async def update(
    db: AsyncSession, user: Tutor | Client, education_id: int, data: EducationUpdate
):
    edu = await _get_owned_or_404(db, user, education_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(edu, field, value)
    await db.flush()
    await db.refresh(edu)
    return edu


async def delete(
    db: AsyncSession, user: Tutor | Client, education_id: int
) -> None:
    edu = await _get_owned_or_404(db, user, education_id)
    edu.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()


async def set_document(
    db: AsyncSession,
    user: Tutor,
    education_id: int,
    *,
    url: str,
    document_name: str,
):
    """Eğitim kaydına diploma/belge URL'sini iliştirir (yalnız eğitmen)."""
    edu = await _get_owned_or_404(db, user, education_id)
    edu.document_url = url
    edu.document_name = document_name
    await db.flush()
    await db.refresh(edu)
    return edu


async def has_document(db: AsyncSession, *, tutor_id: int) -> bool:
    """Eğitmenin en az bir eğitim kaydında belge var mı? (onay kapısı)."""
    stmt = (
        select(TutorEducation.id)
        .where(
            TutorEducation.tutor_id == tutor_id,
            TutorEducation.deleted_at.is_(None),
            TutorEducation.document_url.is_not(None),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None
