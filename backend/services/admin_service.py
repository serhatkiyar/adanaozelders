from __future__ import annotations

import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.review import Review
from models.tutor import Tutor, TutorStatus
from schemas.admin import AdminStats, AdminUserOut, AdminBookingOut


async def _count(db: AsyncSession, model, *conditions) -> int:
    stmt = (
        select(func.count())
        .select_from(model)
        .where(model.deleted_at.is_(None), *conditions)
    )
    return int((await db.scalar(stmt)) or 0)


async def get_stats(db: AsyncSession) -> AdminStats:
    return AdminStats(
        total_clients=await _count(db, Client),
        total_tutors=await _count(db, Tutor),
        total_admins=await _count(db, Admin),
        approved_tutors=await _count(db, Tutor, Tutor.status == TutorStatus.APPROVED),
        pending_tutors=await _count(
            db, Tutor, Tutor.status == TutorStatus.PENDING_APPROVAL
        ),
        total_bookings=await _count(db, Booking),
        active_bookings=await _count(
            db,
            Booking,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        ),
        completed_bookings=await _count(
            db, Booking, Booking.status == BookingStatus.COMPLETED
        ),
        total_reviews=await _count(db, Review),
    )


_ROLE_TABLES = ((Admin, "ADMIN"), (Tutor, "TUTOR"), (Client, "CLIENT"))


async def list_users(
    db: AsyncSession, *, limit: int = 50, offset: int = 0
) -> list[AdminUserOut]:
    # Birleşik kullanıcı tablosu yok; 3 tablo toplanıp created_at'e göre sıralanır.
    users: list[AdminUserOut] = []
    for model, role in _ROLE_TABLES:
        rows = (
            (await db.execute(select(model).where(model.deleted_at.is_(None))))
            .scalars()
            .all()
        )
        for u in rows:
            users.append(
                AdminUserOut(
                    id=u.id,
                    first_name=u.first_name,
                    last_name=u.last_name,
                    username=u.username,
                    full_name=u.full_name,
                    email=u.email,
                    role=role,
                    is_active=u.is_active,
                    created_at=u.created_at,
                )
            )
    users.sort(key=lambda x: x.created_at, reverse=True)
    return users[offset : offset + limit]


async def delete_tutor(db: AsyncSession, tutor: Tutor) -> None:
    # Soft delete: ilan listelerden ve aramadan düşer, veri korunur.
    tutor.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()


async def list_bookings(
    db: AsyncSession, *, limit: int = 50, offset: int = 0, booking_id: int | None = None
) -> list[AdminBookingOut]:
    stmt = (
        select(Booking, Tutor.full_name.label("tutor_name"), Client.full_name.label("client_name"))
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.deleted_at.is_(None))
    )
    if booking_id is not None:
        stmt = stmt.where(Booking.id == booking_id)
        
    stmt = stmt.order_by(Booking.created_at.desc()).limit(limit).offset(offset)
    
    rows = (await db.execute(stmt)).all()
    
    out = []
    for b, t_name, c_name in rows:
        bo = AdminBookingOut.model_validate(b)
        bo.tutor_name = t_name
        bo.client_name = c_name
        out.append(bo)
    return out


async def cancel_booking(db: AsyncSession, booking: Booking, reason: str | None = None) -> Booking:
    booking.status = BookingStatus.CANCELLED
    if reason:
        booking.cancel_reason = f"Admin İptali: {reason}"
    else:
        booking.cancel_reason = "Admin tarafından iptal edildi."
    await db.flush()
    return booking


async def toggle_dispute(db: AsyncSession, booking: Booking, is_disputed: bool, admin_notes: str | None = None) -> Booking:
    booking.is_disputed = is_disputed
    if admin_notes is not None:
        booking.admin_notes = admin_notes
    await db.flush()
    return booking

