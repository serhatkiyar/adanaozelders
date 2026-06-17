from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.admin import Admin
from models.role import RoleType
from models.tutor import Tutor, TutorStatus
from models.booking import Booking
from schemas.admin import AdminStats, AdminUserOut, AdminBookingOut, AuditLogOut
from schemas.tutor import TutorOut
from schemas.booking import BookingCancel
from typing import Literal
from pydantic import BaseModel, Field, field_validator

class DisputeToggle(BaseModel):
    is_disputed: bool
    admin_notes: str | None = None


class PasswordResetIn(BaseModel):
    role: Literal["tutor", "client"]
    user_id: int
    # Verilmezse rastgele geçici şifre üretilir; verilirse en az 8 karakter.
    new_password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strip_empty(cls, v: str | None) -> str | None:
        return v or None


class PasswordResetOut(BaseModel):
    temporary_password: str

from models.report import ReportStatus
from schemas.report import ReportCountOut, ReportOut, ReportResolve
from schemas.education import AdminEducationOut, EducationOut, EducationVerifyIn
from services import (
    admin_service,
    audit_service,
    education_service,
    report_service,
    tutor_service,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(RoleType.ADMIN))],
)

# Router-level dependency yetkilendirmeyi sağlar; bu, audit için aktör admini verir.
_current_admin = require_roles(RoleType.ADMIN)


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
async def approve_tutor(
    tutor_id: int,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    tutor = await _get_tutor_or_404(db, tutor_id)
    result = await tutor_service.approve(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.approve", target_type="tutor", target_id=tutor_id
    )
    return result


@router.post("/tutors/{tutor_id}/reject", response_model=TutorOut)
async def reject_tutor(
    tutor_id: int,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    tutor = await _get_tutor_or_404(db, tutor_id)
    result = await tutor_service.reject(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.reject", target_type="tutor", target_id=tutor_id
    )
    return result


@router.get("/educations/pending", response_model=list[AdminEducationOut])
async def list_pending_educations(db: AsyncSession = Depends(get_db)):
    """Teyit bekleyen (PENDING) diploma belgeleri — sahip eğitmen adıyla."""
    rows = await education_service.admin_list_pending(db)
    out: list[AdminEducationOut] = []
    for edu, tutor in rows:
        item = AdminEducationOut.model_validate(edu)
        item.tutor_name = tutor.full_name
        out.append(item)
    return out


@router.post("/educations/{education_id}/verify", response_model=EducationOut)
async def verify_education(
    education_id: int,
    payload: EducationVerifyIn,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin bir diploma belgesini doğrular/reddeder (e-Devlet barkodunu resmî
    sayfada teyit ettikten sonra)."""
    edu = await education_service.admin_set_verification(
        db, education_id, admin, action=payload.action, note=payload.note
    )
    await audit_service.record(
        db,
        actor=admin,
        action=f"education.{payload.action}",
        target_type="tutor_education",
        target_id=education_id,
    )
    return edu


@router.post("/tutors/{tutor_id}/suspend", response_model=TutorOut)
async def suspend_tutor(
    tutor_id: int,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    # Yayındaki (APPROVED) bir ilanı yayından kaldırır (-> SUSPENDED).
    tutor = await _get_tutor_or_404(db, tutor_id)
    result = await tutor_service.suspend(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.suspend", target_type="tutor", target_id=tutor_id
    )
    return result


@router.post("/tutors/{tutor_id}/activate", response_model=TutorOut)
async def activate_tutor(
    tutor_id: int,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    # Pasif (SUSPENDED) bir ilanı yeniden yayına alır (-> APPROVED).
    tutor = await _get_tutor_or_404(db, tutor_id)
    result = await tutor_service.activate(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.activate", target_type="tutor", target_id=tutor_id
    )
    return result


@router.delete("/tutors/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tutor(
    tutor_id: int,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    tutor = await _get_tutor_or_404(db, tutor_id)
    await admin_service.delete_tutor(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.delete", target_type="tutor", target_id=tutor_id
    )


async def _get_booking_or_404(db: AsyncSession, booking_id: int) -> Booking:
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return booking


@router.get("/bookings", response_model=list[AdminBookingOut])
async def list_bookings(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.list_bookings(db, limit=limit, offset=offset)


@router.post("/bookings/{booking_id}/cancel", response_model=AdminBookingOut)
async def cancel_booking(
    booking_id: int,
    payload: BookingCancel,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    booking = await admin_service.cancel_booking(db, booking, reason=payload.reason)
    await audit_service.record(
        db,
        actor=admin,
        action="booking.cancel",
        target_type="booking",
        target_id=booking_id,
        details=payload.reason,
    )
    return (await admin_service.list_bookings(db, limit=1, offset=0, booking_id=booking.id))[0]


@router.post("/bookings/{booking_id}/dispute", response_model=AdminBookingOut)
async def dispute_booking(
    booking_id: int,
    payload: DisputeToggle,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id)
    booking = await admin_service.toggle_dispute(
        db, booking, is_disputed=payload.is_disputed, admin_notes=payload.admin_notes
    )
    await audit_service.record(
        db,
        actor=admin,
        action="booking.dispute" if payload.is_disputed else "booking.dispute_clear",
        target_type="booking",
        target_id=booking_id,
        details=payload.admin_notes,
    )
    return (await admin_service.list_bookings(db, limit=1, offset=0, booking_id=booking.id))[0]


@router.get("/audit-logs", response_model=list[AuditLogOut])
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await audit_service.list_logs(db, limit=limit, offset=offset)


@router.post("/users/reset-password", response_model=PasswordResetOut)
async def reset_user_password(
    payload: PasswordResetIn,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    # E-postasız şifre sıfırlama: temp şifre üretilir/atanır ve admin'e döner.
    # Not: Kullanıcının mevcut (kısa ömürlü) token'ları otomatik iptal edilmez.
    password = await admin_service.reset_user_password(
        db,
        role=payload.role,
        user_id=payload.user_id,
        new_password=payload.new_password,
    )
    await audit_service.record(
        db,
        actor=admin,
        action="user.reset_password",
        target_type=payload.role,
        target_id=payload.user_id,
    )
    return PasswordResetOut(temporary_password=password)


# ── Şikayet moderasyonu ──────────────────────────────────────────────


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await report_service.list_for_admin(
        db, status_filter=status_filter, limit=limit, offset=offset
    )


@router.get("/reports/count", response_model=ReportCountOut)
async def open_report_count(db: AsyncSession = Depends(get_db)):
    return ReportCountOut(open=await report_service.count_open(db))


@router.post("/reports/{report_id}/resolve", response_model=ReportOut)
async def resolve_report(
    report_id: int,
    payload: ReportResolve,
    admin: Admin = Depends(_current_admin),
    db: AsyncSession = Depends(get_db),
):
    report = await report_service.resolve(
        db,
        report_id=report_id,
        admin=admin,
        status_value=payload.status,
        resolution=payload.resolution,
    )
    await audit_service.record(
        db,
        actor=admin,
        action=f"report.{payload.status.value.lower()}",
        target_type="report",
        target_id=report_id,
        details=payload.resolution,
    )
    return report
