"""Eğitmen panosu özeti.

Pano eskiden `GET /bookings?limit=100` çekip sayıları tarayıcıda sayıyordu;
100'ü aşan eğitmende "bekleyen / tamamlanan" rakamları eksik çıkıyordu. Sayılar
ve pencereler burada, sunucuda ve İstanbul saatine göre hesaplanır.

Salt okunur: hiçbir durum değiştirmez, para alanı taşımaz (kazanç tek kaynak
olarak `GET /payments/earnings` ucunda kalır).
"""
from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.booking import Booking, BookingStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorAvailability, TutorStatus, TutorSubject
from services import booking_service

TZ = ZoneInfo("Europe/Istanbul")

PENDING_LIMIT = 5
UPCOMING_LIMIT = 3
UPCOMING_DAYS = 3

# İlanın aramada hiç görünmemesine yol açan durumlar (search_service: yalnız
# APPROVED listelenir). Sıra, panoda gösterilecek öncelik sırasıdır.
_STATUS_ISSUES: dict[TutorStatus, str] = {
    TutorStatus.DRAFT: "DRAFT",
    TutorStatus.PENDING_APPROVAL: "PENDING_APPROVAL",
    TutorStatus.REJECTED: "REJECTED",
    TutorStatus.SUSPENDED: "SUSPENDED",
}


def compute_visibility_issues(
    *,
    status: TutorStatus,
    availability_count: int,
    subject_count: int,
    payout_status: str | None,
) -> list[dict[str, str]]:
    """İlanın görünürlüğünü ya da ödeme almayı engelleyen nedenler.

    ``hidden``: öğrenci ilanı aramada göremez.
    ``warning``: ilan görünür ama ders alınamaz ya da ödeme alınamaz.
    """
    issues: list[dict[str, str]] = []
    code = _STATUS_ISSUES.get(status)
    if code is not None:
        issues.append({"code": code, "severity": "hidden"})
    if subject_count == 0:
        issues.append({"code": "NO_SUBJECTS", "severity": "hidden"})
    if availability_count == 0:
        issues.append({"code": "NO_AVAILABILITY", "severity": "warning"})
    if payout_status != "ACTIVE":
        issues.append({"code": "PAYOUT_NOT_ACTIVE", "severity": "warning"})
    return issues


def month_start(now: datetime.datetime) -> datetime.datetime:
    """İstanbul saatine göre içinde bulunulan ayın başı (UTC'ye çevrilmiş)."""
    local = now.astimezone(TZ)
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(datetime.timezone.utc)


async def build_dashboard(
    db: AsyncSession, tutor: Tutor, *, now: datetime.datetime
) -> dict:
    tutor_role = ROLE_IDS[RoleType.TUTOR]
    own = (Booking.tutor_id == tutor.id, Booking.deleted_at.is_(None))

    async def _count(*conds) -> int:
        stmt = select(func.count()).select_from(Booking).where(*own, *conds)
        return int((await db.execute(stmt)).scalar_one())

    async def _rows(*conds, limit: int) -> list[Booking]:
        stmt = (
            booking_service._hydrated_booking_select()
            .where(Booking.tutor_id == tutor.id, *conds)
            .order_by(Booking.start_at.asc())
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return await booking_service._hydrate_booking_rows(
            db, rows, role_id=tutor_role, user_id=tutor.id
        )

    pending_count = await _count(Booking.status == BookingStatus.PENDING)
    pending = await _rows(
        Booking.status == BookingStatus.PENDING,
        Booking.start_at >= now,
        limit=PENDING_LIMIT,
    )

    # Süren ders de "sıradaki"dir: bitmemiş en yakın kabul edilmiş ders.
    next_rows = await _rows(
        Booking.status == BookingStatus.ACCEPTED, Booking.end_at > now, limit=1
    )
    next_lesson = next_rows[0] if next_rows else None

    window_end = now + datetime.timedelta(days=UPCOMING_DAYS)
    upcoming_conds = [
        Booking.status == BookingStatus.ACCEPTED,
        Booking.start_at > now,
        Booking.start_at <= window_end,
    ]
    if next_lesson is not None:
        upcoming_conds.append(Booking.id != next_lesson.id)
    upcoming = await _rows(*upcoming_conds, limit=UPCOMING_LIMIT)
    upcoming_count = await _count(*upcoming_conds)

    completed_this_month = await _count(
        Booking.status == BookingStatus.COMPLETED,
        Booking.end_at >= month_start(now),
    )
    completed_total = await _count(Booking.status == BookingStatus.COMPLETED)

    availability_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(TutorAvailability)
                .where(TutorAvailability.tutor_id == tutor.id)
            )
        ).scalar_one()
    )
    subject_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(TutorSubject)
                .where(TutorSubject.tutor_id == tutor.id)
            )
        ).scalar_one()
    )

    return {
        "pending_count": pending_count,
        "pending": pending,
        "next_lesson": next_lesson,
        "upcoming": upcoming,
        "upcoming_count": upcoming_count,
        "completed_this_month": completed_this_month,
        "completed_total": completed_total,
        "visibility_issues": compute_visibility_issues(
            status=tutor.status,
            availability_count=availability_count,
            subject_count=subject_count,
            payout_status=tutor.payout_status,
        ),
    }
