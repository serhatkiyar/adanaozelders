from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_roles,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from models.booking import Booking
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.payment import EarningsSummary, PaymentOut, PlatformSummary
from services import payment_service

router = APIRouter(prefix="/payments", tags=["payments"])

_pay_limit = user_rate_limit(
    key="payment_pay",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


async def _booking_or_404(db: AsyncSession, booking_id: int) -> Booking:
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return booking


def _assert_party(booking: Booking, user: CurrentUser) -> None:
    if user.role_id == ROLE_IDS[RoleType.CLIENT] and booking.client_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.TUTOR] and booking.tutor_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.ADMIN]:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


@router.get("/booking/{booking_id}", response_model=PaymentOut | None)
async def get_booking_payment(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _booking_or_404(db, booking_id)
    _assert_party(booking, user)
    return await payment_service.get_for_booking(db, booking_id)


@router.post(
    "/booking/{booking_id}/pay",
    response_model=PaymentOut,
    dependencies=[Depends(_pay_limit)],
)
async def pay_booking(
    booking_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _booking_or_404(db, booking_id)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    payment, redirect_url = await payment_service.pay(db, booking)
    out = PaymentOut.model_validate(payment)
    out.redirect_url = redirect_url
    return out


@router.get("/earnings", response_model=EarningsSummary)
async def my_earnings(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    data = await payment_service.earnings_summary(db, tutor_id=tutor.id)
    return EarningsSummary(**data)


@router.get("/admin/summary", response_model=PlatformSummary)
async def admin_platform_summary(
    _admin: CurrentUser = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    data = await payment_service.platform_summary(db)
    return PlatformSummary(**data)
