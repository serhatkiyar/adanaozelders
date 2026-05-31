from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, user_rate_limit
from core.config import settings
from core.database import get_db
from schemas.report import ReportCreate, ReportOut
from services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])

_report_limit = user_rate_limit(
    key="report_create",
    limit=settings.RATE_LIMIT_REPORT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.post(
    "",
    response_model=ReportOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_report_limit)],
)
async def create_report(
    payload: ReportCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await report_service.create(db, reporter=user, data=payload)


@router.get("/mine", response_model=list[ReportOut])
async def my_reports(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await report_service.list_own(db, reporter=user, limit=limit, offset=offset)
