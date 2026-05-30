from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, require_roles
from core.database import get_db
from models.booking import Booking, BookingStatus
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.booking import (
    BookingCancel,
    BookingCreate,
    BookingLocation,
    BookingOut,
    BookingReschedule,
)
from services import booking_service

router = APIRouter(prefix="/bookings", tags=["bookings"])


async def _get_booking_or_404(db: AsyncSession, booking_id: int) -> Booking:
    booking = await booking_service.get_booking(db, booking_id)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return booking


def _assert_owner_tutor(booking: Booking, tutor: Tutor) -> None:
    if booking.tutor_id != tutor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


def _assert_party(booking: Booking, user: CurrentUser) -> None:
    if user.role_id == ROLE_IDS[RoleType.CLIENT] and booking.client_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.TUTOR] and booking.tutor_id == user.id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


@router.post("", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await booking_service.create_booking(db, client, payload)


@router.get("", response_model=list[BookingOut])
async def list_my_bookings(
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await booking_service.list_bookings(
        db,
        role_id=user.role_id,
        user_id=user.id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_party(booking, user)
    return booking


@router.post("/{booking_id}/accept", response_model=BookingOut)
async def accept_booking(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.accept(db, booking)


@router.post("/{booking_id}/reject", response_model=BookingOut)
async def reject_booking(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.reject(db, booking)


@router.post("/{booking_id}/complete", response_model=BookingOut)
async def complete_booking(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.complete(db, booking)


@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel_booking(
    booking_id: int,
    payload: BookingCancel | None = None,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_party(booking, user)
    return await booking_service.cancel(
        db, booking, cancelled_by=user, reason=payload.reason if payload else None
    )


@router.post("/{booking_id}/reschedule", response_model=BookingOut)
async def reschedule_booking(
    booking_id: int,
    payload: BookingReschedule,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.reschedule(
        db, booking, start_at=payload.start_at, end_at=payload.end_at
    )


@router.post("/{booking_id}/location", response_model=BookingOut)
async def set_booking_location(
    booking_id: int,
    payload: BookingLocation,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    _assert_party(booking, user)
    return await booking_service.set_location(
        db, booking, actor=user, location=payload.location
    )
