from __future__ import annotations

import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, require_roles, require_roles_or_admin_permission, user_rate_limit
from core.config import settings
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.library_operator import LibraryOperator
from models.role import RoleType
from schemas.library_exam import AttendanceResult
from schemas.study import (
    StudyPayResult,
    StudyQuoteOut,
    StudyReservationCreate,
    StudyReservationOut,
)
from services import payment_gates, phone_service, study_reservation_service

router = APIRouter(prefix="/study-reservations", tags=["study-reservations"])

_pay_limit = user_rate_limit(
    key="study_pay",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


def _assert_can_manage(user: CurrentUser, library_id: int) -> None:
    if isinstance(user, Admin):
        return
    if isinstance(user, LibraryOperator) and user.library_id == library_id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu kütüphanede yetkin yok")


# ── Public: fiyat + uygunluk ön bilgisi ──────────────────────────────────────────


@router.get("/quote", response_model=StudyQuoteOut)
async def quote(
    library_id: int = Query(...),
    starts_at: datetime.datetime = Query(...),
    ends_at: datetime.datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    return await study_reservation_service.quote(db, library_id, starts_at, ends_at)


# ── Yönetim (admin / operatör) — /{reservation_id}'den ÖNCE değil; ayrı path ──


@router.get("/manage", response_model=list[StudyReservationOut])
async def list_manage(
    library_id: int = Query(...),
    user: CurrentUser = Depends(require_roles_or_admin_permission("libraries.manage", RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage(user, library_id)
    return await study_reservation_service.list_manage(db, library_id)


@router.post("/{reservation_id}/attend", response_model=AttendanceResult)
async def attend(
    reservation_id: int,
    operator: LibraryOperator = Depends(require_roles(RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """Operatör rezervasyon listesinden seçip girişi doğrular (QR/kod olmadan)."""
    return await study_reservation_service.verify_by_reservation(
        db,
        operator_library_id=operator.library_id,
        operator_id=operator.id,
        reservation_id=reservation_id,
    )


# ── Öğrenci ──────────────────────────────────────────────────────────────────────


@router.get("/mine", response_model=list[StudyReservationOut])
async def my_reservations(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await study_reservation_service.list_mine(db, client)


@router.post("", response_model=StudyReservationOut, status_code=status.HTTP_201_CREATED)
async def reserve(
    payload: StudyReservationCreate = Body(...),
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await study_reservation_service.reserve(
        db,
        client,
        library_id=payload.library_id,
        starts=payload.starts_at,
        ends=payload.ends_at,
    )


@router.post(
    "/{reservation_id}/pay",
    response_model=StudyPayResult,
    dependencies=[Depends(_pay_limit)],
)
async def pay(
    reservation_id: int,
    request: Request,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await payment_gates.assert_branch_open(
        db, payment_gates.PaymentBranch.LIBRARY_MARKETPLACE
    )
    phone_service.require_phone_verified(client)
    reservation, redirect_url = await study_reservation_service.pay(
        db, client, reservation_id,
        client_ip=request.client.host if request.client else None,
    )
    return StudyPayResult(reservation=reservation, redirect_url=redirect_url)


@router.post("/{reservation_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(
    reservation_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await study_reservation_service.cancel(db, client, reservation_id)
