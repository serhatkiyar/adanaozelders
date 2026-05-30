from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.client import Client
from models.role import RoleType
from models.tutor import Tutor
from schemas.education import EducationCreate, EducationOut, EducationUpdate
from services import education_service

router = APIRouter(prefix="/me/educations", tags=["educations"])

_OwnerUser = Tutor | Client


@router.get("", response_model=list[EducationOut])
async def list_my_educations(
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.list_own(db, user)


@router.post("", response_model=EducationOut, status_code=status.HTTP_201_CREATED)
async def add_education(
    payload: EducationCreate,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.create(db, user, payload)


@router.patch("/{education_id}", response_model=EducationOut)
async def edit_education(
    education_id: int,
    payload: EducationUpdate,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await education_service.update(db, user, education_id, payload)


@router.delete("/{education_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_education(
    education_id: int,
    user: _OwnerUser = Depends(require_roles(RoleType.TUTOR, RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await education_service.delete(db, user, education_id)
