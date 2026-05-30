from __future__ import annotations

import datetime
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.review import Review
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorAvailability, TutorStatus
from schemas.booking import BookingCreate
from services import notification_service

_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.PENDING: {
        BookingStatus.ACCEPTED,
        BookingStatus.REJECTED,
        BookingStatus.CANCELLED,
    },
    BookingStatus.ACCEPTED: {BookingStatus.COMPLETED, BookingStatus.CANCELLED},
    BookingStatus.REJECTED: set(),
    BookingStatus.CANCELLED: set(),
    BookingStatus.COMPLETED: set(),
}


def _transition(booking: Booking, target: BookingStatus) -> None:
    if target not in _TRANSITIONS[booking.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {target.value}",
        )
    booking.status = target


async def _assert_within_availability(
    db: AsyncSession,
    tutor_id: int,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> None:
    """Eğitmen müsaitlik penceresi tanımladıysa istenen saat bir pencereye sığmalı.
    Tanımlamamışsa kısıt yok (geriye dönük uyumlu). Sabit UTC+3 yerel saat."""
    availability = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)
        )
    ).scalars().all()
    if not availability:
        return
    tz = datetime.timezone(datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS))
    local_start = start_at.astimezone(tz)
    local_end = end_at.astimezone(tz)
    s_min = local_start.hour * 60 + local_start.minute
    e_min = local_end.hour * 60 + local_end.minute
    fits = local_start.date() == local_end.date() and any(
        w.weekday == local_start.weekday()
        and w.start_minute <= s_min
        and e_min <= w.end_minute
        for w in availability
    )
    if not fits:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Selected time is outside the tutor's availability",
        )


async def create_booking(
    db: AsyncSession, client: Client, data: BookingCreate
) -> Booking:
    tutor = await db.get(Tutor, data.tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or not tutor.is_active
        or tutor.status != TutorStatus.APPROVED
    ):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Tutor not found or not available"
        )

    if data.start_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot book a time slot in the past"
        )

    await _assert_within_availability(db, tutor.id, data.start_at, data.end_at)

    # Ders biçimi: eğitmen tek mod sunuyorsa o sabittir; BOTH/None ise istemci seçer.
    requested = data.mode.value if data.mode else None
    if tutor.teaching_mode in ("ONLINE", "IN_PERSON"):
        if requested and requested != tutor.teaching_mode:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "This tutor does not offer the selected lesson mode",
            )
        mode = tutor.teaching_mode
    else:
        mode = requested or "ONLINE"

    booking = Booking(
        client_id=client.id,
        tutor_id=data.tutor_id,
        start_at=data.start_at,
        end_at=data.end_at,
        price=data.price,
        notes=data.notes,
        mode=mode,
        location=data.location,
    )
    db.add(booking)
    await db.flush()  # GiST exclusion violation surfaces here -> IntegrityError -> 409
    await db.refresh(booking)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"{client.full_name} yeni bir ders talebi gönderdi.",
        link="/tutor",
    )
    return booking


async def count_completed(db: AsyncSession, *, role_id: int, user_id: int) -> int:
    column = (
        Booking.tutor_id
        if role_id == ROLE_IDS[RoleType.TUTOR]
        else Booking.client_id
    )
    stmt = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.status == BookingStatus.COMPLETED,
            Booking.deleted_at.is_(None),
            column == user_id,
        )
    )
    return int((await db.scalar(stmt)) or 0)


async def get_booking(db: AsyncSession, booking_id: int) -> Booking | None:
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        return None
    tutor = await db.get(Tutor, booking.tutor_id)
    client = await db.get(Client, booking.client_id)
    booking.tutor_name = tutor.full_name if tutor else None
    booking.client_name = client.full_name if client else None
    review_id = await db.scalar(
        select(Review.id).where(
            Review.booking_id == booking.id, Review.deleted_at.is_(None)
        )
    )
    booking.reviewed = review_id is not None
    return booking


async def list_bookings(
    db: AsyncSession,
    *,
    role_id: int,
    user_id: int,
    status_filter: BookingStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Booking]:
    reviewed_col = (
        select(Review.id)
        .where(Review.booking_id == Booking.id, Review.deleted_at.is_(None))
        .exists()
        .label("reviewed")
    )
    stmt = (
        select(Booking, Tutor.full_name, Client.full_name, reviewed_col)
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.deleted_at.is_(None))
    )
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        stmt = stmt.where(Booking.client_id == user_id)
    elif role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = stmt.where(Booking.tutor_id == user_id)
    else:
        return []
    if status_filter is not None:
        stmt = stmt.where(Booking.status == status_filter)
    stmt = stmt.order_by(Booking.start_at.desc()).limit(limit).offset(offset)

    bookings: list[Booking] = []
    for booking, tutor_name, client_name, reviewed in (await db.execute(stmt)).all():
        booking.tutor_name = tutor_name
        booking.client_name = client_name
        booking.reviewed = reviewed
        bookings.append(booking)
    return bookings


async def accept(db: AsyncSession, booking: Booking) -> Booking:
    _transition(booking, BookingStatus.ACCEPTED)
    # Canlı ders odası yalnızca uzaktan (ONLINE) derslerde üretilir.
    if booking.mode != "IN_PERSON" and not booking.meeting_room:
        booking.meeting_room = f"ceyhan-{booking.id}-{secrets.token_urlsafe(6)}"
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Rezervasyon talebin kabul edildi.",
        link="/student/bookings",
    )
    return booking


async def reject(db: AsyncSession, booking: Booking) -> Booking:
    _transition(booking, BookingStatus.REJECTED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Rezervasyon talebin reddedildi.",
        link="/student/bookings",
    )
    return booking


async def complete(db: AsyncSession, booking: Booking) -> Booking:
    _transition(booking, BookingStatus.COMPLETED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Dersin tamamlandı. Değerlendirme yapabilir ve eğitmene soru sorabilirsin.",
        link="/student/bookings",
    )
    return booking


async def reschedule(
    db: AsyncSession,
    booking: Booking,
    *,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> Booking:
    if booking.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only pending or accepted bookings can be rescheduled",
        )
    if start_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot reschedule to the past"
        )
    await _assert_within_availability(db, booking.tutor_id, start_at, end_at)
    booking.start_at = start_at
    booking.end_at = end_at
    # Yeni saat eğitmenin yeniden onayına sunulur; oda/hatırlatma sıfırlanır.
    booking.status = BookingStatus.PENDING
    booking.meeting_room = None
    booking.reminder_sent = False
    await db.flush()  # GiST çakışması -> 409 (global handler)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Bir rezervasyon yeni bir saate taşındı ve onayını bekliyor.",
        link="/tutor",
    )
    return booking


async def set_location(
    db: AsyncSession, booking: Booking, *, actor: "Client | Tutor", location: str
) -> Booking:
    booking.location = location
    await db.flush()
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        rid, rrole, link = booking.tutor_id, ROLE_IDS[RoleType.TUTOR], "/tutor"
    else:
        rid, rrole, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    await notification_service.notify(
        db,
        user_id=rid,
        role_id=rrole,
        message="Yüzyüze ders için buluşma yeri güncellendi.",
        link=link,
    )
    return booking


async def send_due_reminders(db: AsyncSession) -> int:
    now = datetime.datetime.now(datetime.timezone.utc)
    soon = now + datetime.timedelta(hours=1)
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.deleted_at.is_(None),
                Booking.reminder_sent.is_(False),
                Booking.start_at > now,
                Booking.start_at <= soon,
            )
        )
    ).scalars().all()
    for b in rows:
        await notification_service.notify(
            db,
            user_id=b.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message="Dersin yaklaşıyor — yakında başlıyor.",
            link="/student/bookings",
        )
        await notification_service.notify(
            db,
            user_id=b.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Yaklaşan dersin var — yakında başlıyor.",
            link="/tutor",
        )
        b.reminder_sent = True
    return len(rows)


async def cancel(
    db: AsyncSession,
    booking: Booking,
    *,
    cancelled_by: "Client | Tutor",
    reason: str | None = None,
) -> Booking:
    _transition(booking, BookingStatus.CANCELLED)
    if reason:
        booking.cancel_reason = reason
    await db.flush()

    # Karşı tarafı bilgilendir (iptal eden client ise tutor'a, tutor ise client'a).
    if cancelled_by.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    message = f"{cancelled_by.full_name} bir rezervasyonu iptal etti."
    if reason:
        message += f" Neden: {reason}"
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=message,
        link=link,
    )
    return booking
