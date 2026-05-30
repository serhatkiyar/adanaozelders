from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, require_roles
from core.database import get_db
from models.client import Client
from models.role import RoleType
from schemas.exam import PracticeExamCreate, PracticeExamOut
from services import exam_service

router = APIRouter(prefix="/practice-exams", tags=["practice-exams"])


@router.post("", response_model=PracticeExamOut, status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: PracticeExamCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await exam_service.create_exam(db, client, payload)


@router.get("", response_model=list[PracticeExamOut])
async def list_exams(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await exam_service.list_exams(
        db, role_id=user.role_id, user_id=user.id, limit=limit, offset=offset
    )
