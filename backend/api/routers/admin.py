from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, require_roles
from core.database import get_db
from models.admin import Admin
from models.role import RoleType
from models.tutor import Tutor, TutorStatus
from models.booking import Booking, BookingStatus
from schemas.admin import (
    AdminBookingOut,
    AdminDashboardOut,
    AdminDemandOut,
    AdminStats,
    AdminUserDetailOut,
    AdminUserOut,
    AuditLogOut,
)
from schemas.admin_access import (
    AdminPermissionOut,
    AdminRoleAssignmentOut,
    AdminRoleAssignmentUpdate,
    AdminRoleCreate,
    AdminRoleOut,
    AdminRoleUpdate,
)
from schemas.tutor import TutorOut
from schemas.booking import BookingCancel
from typing import Literal
from pydantic import BaseModel, Field

class DisputeToggle(BaseModel):
    is_disputed: bool
    admin_notes: str | None = None


class PasswordResetIn(BaseModel):
    role: Literal["tutor", "client"]
    user_id: int
    # Hassas işlem: gerekçe zorunlu (audit'e yazılır — kim, neden).
    reason: str = Field(min_length=3, max_length=300)


class PasswordResetOut(BaseModel):
    """Parola ASLA dönmez — kullanıcıya tek kullanımlık sıfırlama linki
    e-postalanır; admin yalnız maskeli adresi görür (teyit için)."""

    email_masked: str

from models.report import ReportStatus
from schemas.report import ReportCountOut, ReportOut, ReportResolve
from schemas.education import AdminEducationOut, EducationOut, EducationVerifyIn
from schemas.user import NameChangeRequestOut
from models.demand import DemandStatus
from services import (
    admin_service,
    admin_access_service,
    audit_service,
    content_moderation,
    education_service,
    demand_service,
    name_change_service,
    report_service,
    tutor_service,
)


class ContentHideIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class NameChangeReview(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class AdminDemandCancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

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


@router.get(
    "/stats",
    response_model=AdminStats,
    dependencies=[Depends(require_admin_permission("dashboard.view"))],
)
async def get_stats(db: AsyncSession = Depends(get_db)):
    return await admin_service.get_stats(db)


@router.get(
    "/dashboard",
    response_model=AdminDashboardOut,
    dependencies=[Depends(require_admin_permission("dashboard.view"))],
)
async def get_dashboard(
    range_name: Literal["day", "week", "month"] = Query(default="week", alias="range"),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_dashboard(db, range_name=range_name)


@router.get(
    "/access/permissions",
    response_model=list[AdminPermissionOut],
    dependencies=[Depends(require_admin_permission("admin_roles.view"))],
)
async def list_admin_permissions(db: AsyncSession = Depends(get_db)):
    return await admin_access_service.list_permissions(db)


@router.get(
    "/access/roles",
    response_model=list[AdminRoleOut],
    dependencies=[Depends(require_admin_permission("admin_roles.view"))],
)
async def list_admin_roles(db: AsyncSession = Depends(get_db)):
    return await admin_access_service.list_roles(db)


@router.get(
    "/access/assignments",
    response_model=list[AdminRoleAssignmentOut],
    dependencies=[Depends(require_admin_permission("admin_roles.view"))],
)
async def list_admin_role_assignments(db: AsyncSession = Depends(get_db)):
    return await admin_access_service.list_assignments(db)


@router.post("/access/roles", response_model=AdminRoleOut, status_code=status.HTTP_201_CREATED)
async def create_admin_role(
    payload: AdminRoleCreate,
    admin: Admin = Depends(require_admin_permission("admin_roles.manage")),
    db: AsyncSession = Depends(get_db),
):
    role = await admin_access_service.create_role(db, payload)
    await audit_service.record(
        db, actor=admin, action="admin_role.create", target_type="admin_role", target_id=role.id, details=role.code
    )
    return next(item for item in await admin_access_service.list_roles(db) if item.id == role.id)


@router.put("/access/roles/{role_id}", response_model=AdminRoleOut)
async def update_admin_role(
    role_id: int,
    payload: AdminRoleUpdate,
    admin: Admin = Depends(require_admin_permission("admin_roles.manage")),
    db: AsyncSession = Depends(get_db),
):
    role = await admin_access_service.update_role(db, role_id, payload)
    await audit_service.record(
        db, actor=admin, action="admin_role.update", target_type="admin_role", target_id=role.id, details=role.code
    )
    return next(item for item in await admin_access_service.list_roles(db) if item.id == role.id)


@router.put("/access/admins/{admin_id}/role", response_model=AdminRoleAssignmentOut)
async def assign_admin_role(
    admin_id: int,
    payload: AdminRoleAssignmentUpdate,
    admin: Admin = Depends(require_admin_permission("admin_roles.manage")),
    db: AsyncSession = Depends(get_db),
):
    await admin_access_service.assign_role(
        db, admin_id=admin_id, role_id=payload.role_id, assigned_by_admin_id=admin.id
    )
    await audit_service.record(
        db, actor=admin, action="admin_role.assign", target_type="admin", target_id=admin_id, details=f"role_id={payload.role_id}"
    )
    return next(item for item in await admin_access_service.list_assignments(db) if item.admin_id == admin_id)


@router.get(
    "/users",
    response_model=list[AdminUserOut],
    dependencies=[Depends(require_admin_permission("users.view"))],
)
async def list_users(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    role: Literal["ADMIN", "TUTOR", "CLIENT"] | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    sort: Literal["created_at", "full_name", "email", "role"] = Query(
        default="created_at"
    ),
    order: Literal["asc", "desc"] = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_users(
        db,
        limit=limit,
        offset=offset,
        q=q,
        role=role,
        is_active=is_active,
        sort=sort,
        order=order,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get(
    "/users/{role}/{user_id}",
    response_model=AdminUserDetailOut,
    dependencies=[Depends(require_admin_permission("users.view"))],
)
async def get_user_detail(
    role: Literal["admin", "tutor", "client"],
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_user_detail(db, role=role, user_id=user_id)


@router.get(
    "/demands",
    response_model=list[AdminDemandOut],
    dependencies=[Depends(require_admin_permission("demands.view"))],
)
async def list_demands(
    response: Response,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    status_filter: DemandStatus | None = Query(default=None, alias="status"),
    sort: Literal["created_at", "title", "subject", "status", "response_count"] = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
):
    items, total = await demand_service.list_admin_demands(
        db,
        limit=limit,
        offset=offset,
        q=q,
        status_filter=status_filter,
        sort=sort,
        order=order,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.post("/demands/{demand_id}/cancel", response_model=AdminDemandOut)
async def cancel_demand(
    demand_id: int,
    payload: AdminDemandCancelIn,
    admin: Admin = Depends(require_admin_permission("demands.manage")),
    db: AsyncSession = Depends(get_db),
):
    await demand_service.cancel_demand_for_admin(db, demand_id)
    await audit_service.record(
        db,
        actor=admin,
        action="demand.cancel",
        target_type="demand",
        target_id=demand_id,
        details=payload.reason,
    )
    items, _ = await demand_service.list_admin_demands(
        db,
        limit=1,
        offset=0,
        q=None,
        status_filter=None,
        demand_id=demand_id,
        sort="created_at",
        order="desc",
    )
    return items[0]


@router.get(
    "/tutors",
    response_model=list[TutorOut],
    dependencies=[Depends(require_admin_permission("tutors.view"))],
)
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
    db: AsyncSession = Depends(get_db),
):
    tutor = await _get_tutor_or_404(db, tutor_id)
    result = await tutor_service.reject(db, tutor)
    await audit_service.record(
        db, actor=admin, action="tutor.reject", target_type="tutor", target_id=tutor_id
    )
    return result


@router.get(
    "/educations/pending",
    response_model=list[AdminEducationOut],
    dependencies=[Depends(require_admin_permission("tutors.view"))],
)
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
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
    admin: Admin = Depends(require_admin_permission("tutors.manage")),
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


@router.get(
    "/bookings",
    response_model=list[AdminBookingOut],
    dependencies=[Depends(require_admin_permission("bookings.view"))],
)
async def list_bookings(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    is_disputed: bool | None = Query(default=None),
    sort: Literal["created_at", "start_at", "status", "price"] = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
):
    items, total = await admin_service.list_bookings(
        db,
        limit=limit,
        offset=offset,
        q=q,
        status_filter=status_filter,
        is_disputed=is_disputed,
        sort=sort,
        order=order,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.post("/bookings/{booking_id}/cancel", response_model=AdminBookingOut)
async def cancel_booking(
    booking_id: int,
    payload: BookingCancel,
    admin: Admin = Depends(require_admin_permission("bookings.manage")),
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
    items, _ = await admin_service.list_bookings(db, limit=1, offset=0, booking_id=booking.id)
    return items[0]


@router.post("/bookings/{booking_id}/dispute", response_model=AdminBookingOut)
async def dispute_booking(
    booking_id: int,
    payload: DisputeToggle,
    admin: Admin = Depends(require_admin_permission("bookings.manage")),
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
    items, _ = await admin_service.list_bookings(db, limit=1, offset=0, booking_id=booking.id)
    return items[0]


@router.get(
    "/audit-logs",
    response_model=list[AuditLogOut],
    dependencies=[Depends(require_admin_permission("audit.view"))],
)
async def list_audit_logs(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    action: str | None = Query(default=None, max_length=50),
    target_type: str | None = Query(default=None, max_length=30),
    actor_id: int | None = Query(default=None, ge=1),
    request_id: str | None = Query(default=None, max_length=64),
    sort: Literal["created_at", "action", "target_type", "actor_id"] = Query(
        default="created_at"
    ),
    order: Literal["asc", "desc"] = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
):
    items, total = await audit_service.list_logs(
        db,
        limit=limit,
        offset=offset,
        q=q,
        action=action,
        target_type=target_type,
        actor_id=actor_id,
        request_id=request_id,
        sort=sort,
        order=order,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.post("/users/reset-password", response_model=PasswordResetOut)
async def reset_user_password(
    payload: PasswordResetIn,
    admin: Admin = Depends(require_admin_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    # Güvenli akış: parola üretilmez/dönmez; kullanıcıya tek kullanımlık
    # sıfırlama linki e-postalanır + tüm refresh token'ları iptal edilir.
    email_masked = await admin_service.initiate_password_reset(
        db, role=payload.role, user_id=payload.user_id
    )
    await audit_service.record(
        db,
        actor=admin,
        action="user.reset_password",
        target_type=payload.role,
        target_id=payload.user_id,
        reason=payload.reason,
        meta={"email_masked": email_masked, "sessions_revoked": True},
    )
    return PasswordResetOut(email_masked=email_masked)


# ── Şikayet moderasyonu ──────────────────────────────────────────────


@router.get(
    "/reports",
    response_model=list[ReportOut],
    dependencies=[Depends(require_admin_permission("reports.view"))],
)
async def list_reports(
    response: Response,
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    target_type: str | None = Query(default=None, max_length=30),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    items, total = await report_service.list_for_admin(
        db,
        status_filter=status_filter,
        target_type=target_type,
        limit=limit,
        offset=offset,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get(
    "/reports/count",
    response_model=ReportCountOut,
    dependencies=[Depends(require_admin_permission("reports.view"))],
)
async def open_report_count(db: AsyncSession = Depends(get_db)):
    return ReportCountOut(open=await report_service.count_open(db))


@router.post("/reports/{report_id}/resolve", response_model=ReportOut)
async def resolve_report(
    report_id: int,
    payload: ReportResolve,
    admin: Admin = Depends(require_admin_permission("reports.manage")),
    db: AsyncSession = Depends(get_db),
):
    report = await report_service.resolve(
        db,
        report_id=report_id,
        admin=admin,
        status_value=payload.status,
        resolution=payload.resolution,
    )
    if payload.hide_target:
        # Şikayeti kapatmak içeriği yayından kaldırmaz; admin isterse aynı
        # işlemde kaldırır. Gizleme puan ortalamasından da düşer.
        await content_moderation.hide(
            db,
            target_type=report.target_type,
            target_id=report.target_id,
            admin=admin,
            reason=payload.resolution,
        )
        await audit_service.record(
            db,
            actor=admin,
            action="content.hide",
            target_type=report.target_type,
            target_id=report.target_id,
            reason=payload.resolution,
            meta={"report_id": report_id},
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


@router.post("/content/{target_type}/{target_id}/hide", status_code=204)
async def hide_content(
    target_type: str,
    target_id: int,
    payload: ContentHideIn,
    admin: Admin = Depends(require_admin_permission("reports.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Bir yorumu yayından kaldırır (şikayetten bağımsız olarak da kullanılabilir)."""
    await content_moderation.hide(
        db,
        target_type=target_type.upper(),
        target_id=target_id,
        admin=admin,
        reason=payload.reason,
    )
    await audit_service.record(
        db,
        actor=admin,
        action="content.hide",
        target_type=target_type.upper(),
        target_id=target_id,
        reason=payload.reason,
    )


@router.post("/content/{target_type}/{target_id}/unhide", status_code=204)
async def unhide_content(
    target_type: str,
    target_id: int,
    admin: Admin = Depends(require_admin_permission("reports.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Gizleme kararını geri alır; yorum puana yeniden sayılır."""
    await content_moderation.unhide(
        db, target_type=target_type.upper(), target_id=target_id
    )
    await audit_service.record(
        db,
        actor=admin,
        action="content.unhide",
        target_type=target_type.upper(),
        target_id=target_id,
    )


# ── Ad / Kullanıcı Adı Değişiklik Onay Kuyruğu ──


@router.get(
    "/name-change-requests",
    response_model=list[NameChangeRequestOut],
    dependencies=[Depends(require_admin_permission("users.view"))],
)
async def list_name_change_requests(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    return await name_change_service.list_admin(
        db, status_filter=status_filter, limit=limit
    )


@router.post(
    "/name-change-requests/{request_id}/approve",
    response_model=NameChangeRequestOut,
)
async def approve_name_change(
    request_id: int,
    admin: Admin = Depends(require_admin_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    req = await name_change_service.approve(db, request_id, admin_id=admin.id)
    await audit_service.record(
        db,
        actor=admin,
        action="name_change.approve",
        target_type="name_change_request",
        target_id=request_id,
        details=req.kind,
    )
    return req


@router.post(
    "/name-change-requests/{request_id}/reject",
    response_model=NameChangeRequestOut,
)
async def reject_name_change(
    request_id: int,
    payload: NameChangeReview,
    admin: Admin = Depends(require_admin_permission("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    req = await name_change_service.reject(
        db, request_id, admin_id=admin.id, note=payload.note
    )
    await audit_service.record(
        db,
        actor=admin,
        action="name_change.reject",
        target_type="name_change_request",
        target_id=request_id,
        details=payload.note,
    )
    return req
