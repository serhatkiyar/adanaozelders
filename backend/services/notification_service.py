from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client
from models.notification import Notification
from models.role import ROLE_IDS, RoleType
from core import ws_outbox

_CLIENT_ROLE_ID = ROLE_IDS[RoleType.CLIENT]
_TUTOR_ROLE_ID = ROLE_IDS[RoleType.TUTOR]


async def _resolve_target(
    db: AsyncSession, *, user_id: int, role_id: int
) -> tuple[int, int]:
    """Gölgeye giden bildirimi sahibi eğitmene yeniden adresler.

    Sipariş ve teslimat yolları bildirimi 15+ yerde
    ``user_id=order.client_id, role_id=CLIENT`` olarak yazıyor. Eğitmen mağazadan
    alışveriş yaptığında `client_id` bir GÖLGE satırı gösterir; o kimlikle
    giriş yapılamadığı için bildirim kimseye ulaşmazdı. Çağrı yerlerini
    değiştirmek yerine yeniden adresleme TEK NOKTADA yapılır
    (docs/egitmen-alici-sozlesme.md §4).
    """
    if role_id != _CLIENT_ROLE_ID:
        return user_id, role_id
    tutor_id = await db.scalar(
        select(Client.shadow_of_tutor_id).where(Client.id == user_id)
    )
    if tutor_id is None:
        return user_id, role_id
    return int(tutor_id), _TUTOR_ROLE_ID


async def notify(
    db: AsyncSession,
    *,
    user_id: int,
    role_id: int,
    message: str,
    link: str | None = None,
) -> None:
    user_id, role_id = await _resolve_target(db, user_id=user_id, role_id=role_id)
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
