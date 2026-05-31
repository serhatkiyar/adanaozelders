from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.notification import Notification
from core import ws_outbox


async def notify(
    db: AsyncSession,
    *,
    user_id: int,
    role_id: int,
    message: str,
    link: str | None = None,
) -> None:
    db.add(
        Notification(
            user_id=user_id, role_id=role_id, message=message, link=link
        )
    )
    await db.flush()

    # Commit sonrası gönderilir (bkz. core/ws_outbox) — böylece alıcı refetch
    # ettiğinde bildirim satırı DB'de hazır olur.
    ws_outbox.enqueue(
        db,
        {"type": "NEW_NOTIFICATION", "data": {"message": message, "link": link}},
        user_id=user_id,
        role_id=role_id,
    )


async def list_for(
    db: AsyncSession, *, user_id: int, role_id: int, limit: int = 20, offset: int = 0
) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id, Notification.role_id == role_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())


async def unread_count(db: AsyncSession, *, user_id: int, role_id: int) -> int:
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.role_id == role_id,
            Notification.is_read.is_(False),
        )
    )
    return int((await db.scalar(stmt)) or 0)


async def mark_read(
    db: AsyncSession, *, notification_id: int, user_id: int, role_id: int
) -> bool:
    notif = await db.get(Notification, notification_id)
    if notif is None or notif.user_id != user_id or notif.role_id != role_id:
        return False
    notif.is_read = True
    await db.flush()
    return True


async def mark_all_read(db: AsyncSession, *, user_id: int, role_id: int) -> None:
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.role_id == role_id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    await db.flush()
