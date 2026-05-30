from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.role import RoleType
from models.tutor import Tutor, TutorStatus
from schemas.admin import AdminStats, AdminUserOut
from schemas.tutor import TutorOut
from services import admin_service, tutor_service

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(RoleType.ADMIN))],
)


async def _get_tutor_or_404(db: AsyncSession, tutor_id: int) -> Tutor:
    tutor = await db.get(Tutor, tutor_id)
    if tutor is None or tutor.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tutor not found")
    return tutor


@router.get("/stats", response_model=AdminStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    return await admin_service.get_stats(db)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.list_users(db, limit=limit, offset=offset)


@router.get("/tutors", response_model=list[TutorOut])
async def list_tutors(
    status_filter: TutorStatus | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tutor).where(Tutor.deleted_at.is_(None))
    if status_filter is not None:
        stmt = stmt.where(Tutor.status == status_filter)
    stmt = stmt.order_by(Tutor.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


@router.post("/tutors/{tutor_id}/approve", response_model=TutorOut)
async def approve_tutor(tutor_id: int, db: AsyncSession = Depends(get_db)):
    tutor = await _get_tutor_or_404(db, tutor_id)
    return await tutor_service.approve(db, tutor)


@router.post("/tutors/{tutor_id}/reject", response_model=TutorOut)
async def reject_tutor(tutor_id: int, db: AsyncSession = Depends(get_db)):
    tutor = await _get_tutor_or_404(db, tutor_id)
    return await tutor_service.reject(db, tutor)


@router.post("/tutors/{tutor_id}/suspend", response_model=TutorOut)
async def suspend_tutor(tutor_id: int, db: AsyncSession = Depends(get_db)):
    # Yayındaki (APPROVED) bir ilanı yayından kaldırır (-> SUSPENDED).
    tutor = await _get_tutor_or_404(db, tutor_id)
    return await tutor_service.suspend(db, tutor)


@router.post("/tutors/{tutor_id}/activate", response_model=TutorOut)
async def activate_tutor(tutor_id: int, db: AsyncSession = Depends(get_db)):
    # Pasif (SUSPENDED) bir ilanı yeniden yayına alır (-> APPROVED).
    tutor = await _get_tutor_or_404(db, tutor_id)
    return await tutor_service.activate(db, tutor)


@router.delete("/tutors/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tutor(tutor_id: int, db: AsyncSession = Depends(get_db)):
    tutor = await _get_tutor_or_404(db, tutor_id)
    await admin_service.delete_tutor(db, tutor)
