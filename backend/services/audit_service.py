from __future__ import annotations

from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.audit_log import AuditLog


async def record(
    db: AsyncSession,
    *,
    actor,
    action: str,
    target_type: str,
    target_id: int | None = None,
    details: str | None = None,
) -> None:
    """Admin kritik aksiyonunu audit_logs'a yazar."""
    db.add(
        AuditLog(
            actor_id=actor.id,
            actor_role=actor.role_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
        )
    )
    await db.flush()


async def list_logs(
    db: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    actor_id: int | None = None,
    sort: str = "created_at",
    order: str = "desc",
) -> tuple[list[AuditLog], int]:
    filters = []
    normalized_q = q.strip() if q and q.strip() else None
    if normalized_q:
        pattern = f"%{normalized_q}%"
        filters.append(
            or_(
                AuditLog.action.ilike(pattern),
                AuditLog.target_type.ilike(pattern),
                AuditLog.details.ilike(pattern),
            )
        )
    if action:
        filters.append(AuditLog.action == action)
    if target_type:
        filters.append(AuditLog.target_type == target_type)
    if actor_id is not None:
        filters.append(AuditLog.actor_id == actor_id)

    total = int(
        (await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)))
        or 0
    )
    sort_columns = {
        "created_at": AuditLog.created_at,
        "action": AuditLog.action,
        "target_type": AuditLog.target_type,
        "actor_id": AuditLog.actor_id,
    }
    sort_column = sort_columns[sort]
    order_by = asc(sort_column) if order == "asc" else desc(sort_column)
    stmt = (
        select(AuditLog)
        .where(*filters)
        .order_by(order_by, AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list((await db.execute(stmt)).scalars().all())
    return items, total
