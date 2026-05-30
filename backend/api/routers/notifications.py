from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user
from core.database import get_db
from schemas.notification import NotificationOut
from services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await notification_service.list_for(
        db, user_id=user.id, role_id=user.role_id, limit=limit, offset=offset
    )


@router.get("/unread-count")
async def unread_count(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    count = await notification_service.unread_count(
        db, user_id=user.id, role_id=user.role_id
    )
    return {"count": count}


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    notification_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    ok = await notification_service.mark_read(
        db, notification_id=notification_id, user_id=user.id, role_id=user.role_id
    )
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await notification_service.mark_all_read(
        db, user_id=user.id, role_id=user.role_id
    )
