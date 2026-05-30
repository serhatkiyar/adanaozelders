from __future__ import annotations

from sqlalchemy import select
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
    db: AsyncSession, *, limit: int = 50, offset: int = 0
) -> list[AuditLog]:
    stmt = (
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())
