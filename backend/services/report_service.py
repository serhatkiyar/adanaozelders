"""Şikayet (trust & safety) iş mantığı. Çözüm admin tarafından yapılır + audit."""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.report import Report, ReportStatus
from schemas.report import ReportCreate


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def create(db: AsyncSession, *, reporter, data: ReportCreate) -> Report:
    """Yeni şikayet oluşturur. Aynı kullanıcı aynı hedefi açık bir şikayetle
    tekrar bildiremez (spam önleme → 409)."""
    dup = await db.scalar(
        select(Report.id).where(
            Report.reporter_role == reporter.role_id,
            Report.reporter_id == reporter.id,
            Report.target_type == data.target_type,
            Report.target_id == data.target_id,
            Report.status == ReportStatus.OPEN,
        )
    )
    if dup is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu içeriği zaten şikayet ettin; inceleniyor.",
        )
    report = Report(
        reporter_role=reporter.role_id,
        reporter_id=reporter.id,
        target_type=data.target_type,
        target_id=data.target_id,
        reason=data.reason,
        description=data.description,
    )
    db.add(report)
    await db.flush()
    return report


async def list_own(
    db: AsyncSession, *, reporter, limit: int = 50, offset: int = 0
) -> list[Report]:
    stmt = (
        select(Report)
        .where(
            Report.reporter_role == reporter.role_id,
            Report.reporter_id == reporter.id,
        )
        .order_by(Report.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_for_admin(
    db: AsyncSession,
    *,
    status_filter: ReportStatus | None = None,
    target_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Report], int]:
    stmt = select(Report)
    count_stmt = select(func.count()).select_from(Report)
    filters = []
    if status_filter is not None:
        filters.append(Report.status == status_filter)
    if target_type:
        filters.append(Report.target_type == target_type)
    stmt = stmt.where(*filters)
    count_stmt = count_stmt.where(*filters)
    # Açık şikayetler önce (enum sırası), sonra en yeni.
    stmt = (
        stmt.order_by(Report.status.asc(), Report.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list((await db.execute(stmt)).scalars().all())
    total = int((await db.scalar(count_stmt)) or 0)
    return items, total


async def count_open(db: AsyncSession) -> int:
    return int(
        (
            await db.scalar(
                select(func.count())
                .select_from(Report)
                .where(Report.status == ReportStatus.OPEN)
            )
        )
        or 0
    )


async def resolve(
    db: AsyncSession,
    *,
    report_id: int,
    admin,
    status_value: ReportStatus,
    resolution: str | None,
) -> Report:
    report = await db.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Şikayet bulunamadı")
    report.status = status_value
    report.resolution = resolution
    report.resolved_by = admin.id
    report.resolved_at = _now()
    await db.flush()
    return report
