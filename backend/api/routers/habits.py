from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user
from core.database import get_db
from schemas.habit import HabitCheckIn, HabitCreate, HabitOut, HabitUpdate
from services import habit_service

router = APIRouter(prefix="/habits", tags=["habits"])


@router.get("", response_model=list[HabitOut])
async def list_habits(
    on: datetime.date | None = Query(
        default=None, description="İstemcinin yerel günü (YYYY-MM-DD)"
    ),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await habit_service.list_habits(db, user, on or datetime.date.today())


@router.post("", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
async def create_habit(
    payload: HabitCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await habit_service.create_habit(db, user, payload)


@router.patch("/{habit_id}", response_model=HabitOut)
async def update_habit(
    habit_id: int,
    payload: HabitUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await habit_service.update_habit(db, user, habit_id, payload)


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_habit(
    habit_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await habit_service.delete_habit(db, user, habit_id)


@router.post("/{habit_id}/check", response_model=HabitOut)
async def check_in(
    habit_id: int,
    payload: HabitCheckIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await habit_service.check_in(
        db,
        user,
        habit_id,
        payload.entry_date,
        payload.delta,
        payload.on or payload.entry_date,
    )
