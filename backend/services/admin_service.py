from __future__ import annotations

import datetime
import secrets

from fastapi import HTTPException, status
from sqlalchemy import String, asc, cast, desc, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password
from models.admin import Admin
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand, DemandStatus
from models.delivery import DeliveryRun, DeliveryRunStatus
from models.library import Library, LibraryStatus
from models.report import Report, ReportStatus
from models.review import Review
from models.store import Order, OrderReturn, OrderStatus, Product, ProductKind, ProductStatus
from models.tutor import Tutor, TutorEducation, TutorStatus
from schemas.admin import (
    AdminBookingOut,
    AdminDashboardOut,
    AdminStats,
    AdminUserDetailOut,
    AdminUserOut,
)

# Admin yalnızca tutor/client şifresini sıfırlayabilir (admin'ler hariç).
_RESET_MODELS: dict[str, type] = {"tutor": Tutor, "client": Client}


async def reset_user_password(
    db: AsyncSession, *, role: str, user_id: int, new_password: str | None
) -> str:
    """Admin tarafından e-postasız şifre sıfırlama. new_password verilmezse rastgele
    geçici şifre üretir ve döndürür (admin kullanıcıya iletir)."""
    model = _RESET_MODELS.get(role)
    if model is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid role")
    user = await db.get(model, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    password = new_password or secrets.token_urlsafe(9)
    user.hashed_password = hash_password(password)
    await db.flush()
    return password


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


def _count_scalar(model, *conditions, soft_delete: bool = True):
    filters = list(conditions)
    if soft_delete and hasattr(model, "deleted_at"):
        filters.insert(0, model.deleted_at.is_(None))
    return select(func.count()).select_from(model).where(*filters).scalar_subquery()


async def get_dashboard(db: AsyncSession, *, range_name: str) -> AdminDashboardOut:
    days = {"day": 1, "week": 7, "month": 30}[range_name]
    now = datetime.datetime.now(datetime.timezone.utc)
    period_start = now - datetime.timedelta(days=days)
    previous_start = period_start - datetime.timedelta(days=days)

    stmt = select(
        _count_scalar(Client, Client.created_at >= period_start).label("new_clients"),
        _count_scalar(
            Client,
            Client.created_at >= previous_start,
            Client.created_at < period_start,
        ).label("previous_new_clients"),
        _count_scalar(Tutor, Tutor.created_at >= period_start).label("new_tutors"),
        _count_scalar(
            Tutor,
            Tutor.created_at >= previous_start,
            Tutor.created_at < period_start,
        ).label("previous_new_tutors"),
        _count_scalar(Order, Order.created_at >= period_start).label("new_orders"),
        _count_scalar(
            Order,
            Order.created_at >= previous_start,
            Order.created_at < period_start,
        ).label("previous_new_orders"),
        _count_scalar(Tutor, Tutor.status == TutorStatus.PENDING_APPROVAL).label(
            "pending_tutors"
        ),
        _count_scalar(
            TutorEducation, TutorEducation.verification_status == "PENDING"
        ).label("pending_diplomas"),
        _count_scalar(
            Booking,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        ).label("active_bookings"),
        _count_scalar(Demand, Demand.status == DemandStatus.OPEN).label("open_demands"),
        _count_scalar(Booking, Booking.is_disputed.is_(True)).label(
            "disputed_bookings"
        ),
        _count_scalar(Report, Report.status == ReportStatus.OPEN, soft_delete=False).label(
            "open_reports"
        ),
        _count_scalar(
            Order,
            Order.status == OrderStatus.PAID,
            Order.has_physical.is_(True),
        ).label("paid_orders"),
        _count_scalar(
            OrderReturn, OrderReturn.status == "PENDING", soft_delete=False
        ).label("pending_returns"),
        _count_scalar(
            Product,
            Product.kind == ProductKind.PHYSICAL,
            Product.status == ProductStatus.ACTIVE,
            Product.stock <= 5,
        ).label("low_stock_products"),
        _count_scalar(Library, Library.status == LibraryStatus.PENDING).label(
            "pending_libraries"
        ),
        _count_scalar(
            DeliveryRun, DeliveryRun.status == DeliveryRunStatus.ACTIVE
        ).label("active_delivery_runs"),
        _count_scalar(
            AuditLog, AuditLog.created_at >= period_start, soft_delete=False
        ).label("period_audit_logs"),
    )
    row = (await db.execute(stmt)).mappings().one()
    return AdminDashboardOut(
        range=range_name,
        period_start=period_start,
        previous_period_start=previous_start,
        **{key: int(value or 0) for key, value in row.items()},
    )


_ROLE_TABLES = ((Admin, "ADMIN"), (Tutor, "TUTOR"), (Client, "CLIENT"))


def _user_directory_selects(*, role: str | None, q: str | None):
    statements = []
    for model, role_name in _ROLE_TABLES:
        if role is not None and role_name != role:
            continue
        stmt = select(
            model.id.label("id"),
            model.first_name.label("first_name"),
            model.last_name.label("last_name"),
            model.username.label("username"),
            model.full_name.label("full_name"),
            model.email.label("email"),
            cast(literal(role_name), String).label("role"),
            model.is_active.label("is_active"),
            model.created_at.label("created_at"),
        ).where(model.deleted_at.is_(None))
        if q:
            pattern = f"%{q}%"
            stmt = stmt.where(
                or_(
                    model.first_name.ilike(pattern),
                    model.last_name.ilike(pattern),
                    model.username.ilike(pattern),
                    model.email.ilike(pattern),
                    model.full_name.ilike(pattern),
                )
            )
        statements.append(stmt)
    return statements


async def list_users(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AdminUserOut], int]:
    """Ayrı kullanıcı tablolarını SQL UNION ALL ile birleştirip DB'de sayfalar."""
    normalized_q = q.strip() if q and q.strip() else None
    statements = _user_directory_selects(role=role, q=normalized_q)
    directory = (
        statements[0].subquery("admin_user_directory")
        if len(statements) == 1
        else union_all(*statements).subquery("admin_user_directory")
    )

    filters = []
    if is_active is not None:
        filters.append(directory.c.is_active.is_(is_active))

    total_stmt = select(func.count()).select_from(directory).where(*filters)
    total = int((await db.scalar(total_stmt)) or 0)

    sort_columns = {
        "created_at": directory.c.created_at,
        "full_name": directory.c.full_name,
        "email": directory.c.email,
        "role": directory.c.role,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = (
        select(directory)
        .where(*filters)
        .order_by(order_by, desc(directory.c.id))
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).mappings().all()
    return [AdminUserOut(**dict(row)) for row in rows], total


_USER_DETAIL_MODELS = {
    "admin": (Admin, "ADMIN"),
    "tutor": (Tutor, "TUTOR"),
    "client": (Client, "CLIENT"),
}


async def get_user_detail(
    db: AsyncSession, *, role: str, user_id: int
) -> AdminUserDetailOut:
    model, role_name = _USER_DETAIL_MODELS[role]
    user = await db.get(model, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    booking_count = 0
    review_count = 0
    demand_count = 0
    order_count = 0
    tutor_status: str | None = None

    if role == "tutor":
        booking_count = await _count(db, Booking, Booking.tutor_id == user_id)
        review_count = await _count(db, Review, Review.tutor_id == user_id)
        tutor_status = user.status.value
    elif role == "client":
        booking_count = await _count(db, Booking, Booking.client_id == user_id)
        review_count = await _count(db, Review, Review.client_id == user_id)
        demand_count = await _count(db, Demand, Demand.client_id == user_id)
        order_count = await _count(db, Order, Order.client_id == user_id)

    return AdminUserDetailOut(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role=role_name,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_seen_at=user.last_seen_at,
        email_verified=user.email_verified,
        tutor_status=tutor_status,
        booking_count=booking_count,
        review_count=review_count,
        demand_count=demand_count,
        order_count=order_count,
    )


async def delete_tutor(db: AsyncSession, tutor: Tutor) -> None:
    # Soft delete: ilan listelerden ve aramadan düşer, veri korunur.
    tutor.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()


async def list_bookings(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    booking_id: int | None = None,
    q: str | None = None,
    status_filter: BookingStatus | None = None,
    is_disputed: bool | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AdminBookingOut], int]:
    filters = [Booking.deleted_at.is_(None)]
    normalized_q = q.strip() if q and q.strip() else None
    if normalized_q:
        pattern = f"%{normalized_q}%"
        filters.append(
            or_(
                Tutor.full_name.ilike(pattern),
                Tutor.email.ilike(pattern),
                Client.full_name.ilike(pattern),
                Client.email.ilike(pattern),
            )
        )
    if booking_id is not None:
        filters.append(Booking.id == booking_id)
    if status_filter is not None:
        filters.append(Booking.status == status_filter)
    if is_disputed is not None:
        filters.append(Booking.is_disputed.is_(is_disputed))

    stmt = (
        select(Booking, Tutor.full_name.label("tutor_name"), Client.full_name.label("client_name"))
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(*filters)
    )
    total = int(
        (
            await db.scalar(
                select(func.count())
                .select_from(Booking)
                .join(Tutor, Booking.tutor_id == Tutor.id)
                .join(Client, Booking.client_id == Client.id)
                .where(*filters)
            )
        )
        or 0
    )
    sort_columns = {
        "created_at": Booking.created_at,
        "start_at": Booking.start_at,
        "status": Booking.status,
        "price": Booking.price,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = stmt.order_by(order_by, Booking.id.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()
    out: list[AdminBookingOut] = []
    for b, t_name, c_name in rows:
        bo = AdminBookingOut.model_validate(b)
        bo.tutor_name = t_name
        bo.client_name = c_name
        out.append(bo)
    return out, total


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
