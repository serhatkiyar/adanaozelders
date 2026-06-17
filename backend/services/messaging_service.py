from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand
from models.demand_response import DemandResponse
from models.messaging import Conversation, Message
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from core import ws_outbox
from core.moderation import mask_contact_info

CurrentUser = Admin | Tutor | Client


async def _can_message(db: AsyncSession, client_id: int, tutor_id: int) -> bool:
    """Aktif/bekleyen rezervasyon VEYA eğitmenin bu öğrencinin bir talebine verdiği
    yanıt mesajlaşmayı açar (talep yanıtı = eğitmen tarafından başlatılan iletişim)."""
    has_booking = exists().where(
        Booking.client_id == client_id,
        Booking.tutor_id == tutor_id,
        Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED]),
        Booking.deleted_at.is_(None),
    )
    has_demand_response = (
        exists()
        .where(
            DemandResponse.tutor_id == tutor_id,
            DemandResponse.demand_id == Demand.id,
            DemandResponse.deleted_at.is_(None),
            Demand.client_id == client_id,
            Demand.deleted_at.is_(None),
        )
    )
    return bool(await db.scalar(select(or_(has_booking, has_demand_response))))


async def _conversation_id(db: AsyncSession, client_id: int, tutor_id: int) -> int:
    conv_id = await db.scalar(
        insert(Conversation)
        .values(client_id=client_id, tutor_id=tutor_id)
        .on_conflict_do_nothing(index_elements=["client_id", "tutor_id"])
        .returning(Conversation.id)
    )
    if conv_id is None:
        conv_id = await db.scalar(
            select(Conversation.id).where(
                Conversation.client_id == client_id,
                Conversation.tutor_id == tutor_id,
            )
        )
    return conv_id


def _resolve_pair(sender: CurrentUser, counterparty_id: int) -> tuple[int, int, str]:
    if sender.role_id == ROLE_IDS[RoleType.CLIENT]:
        return sender.id, counterparty_id, "CLIENT"
    if sender.role_id == ROLE_IDS[RoleType.TUTOR]:
        return counterparty_id, sender.id, "TUTOR"
    raise HTTPException(
        status.HTTP_403_FORBIDDEN, "Messaging not allowed for this role"
    )


async def send_message(
    db: AsyncSession, *, sender: CurrentUser, counterparty_id: int, body: str
) -> Message:
    client_id, tutor_id, sender_role = _resolve_pair(sender, counterparty_id)
    # Uygunluk gönderim anında değerlendirilir; biten/iptal rezervasyonda sohbet read-only olur.
    if not await _can_message(db, client_id, tutor_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Messaging requires an active booking"
        )
    conv_id = await _conversation_id(db, client_id, tutor_id)
    message = Message(
        conversation_id=conv_id,
        sender_role=sender_role,
        sender_id=sender.id,
        body=mask_contact_info(body),
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)

    counterparty_role = ROLE_IDS[RoleType.TUTOR] if sender_role == "CLIENT" else ROLE_IDS[RoleType.CLIENT]
    # Commit sonrası gönderilir (bkz. core/ws_outbox).
    ws_outbox.enqueue(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
        user_id=counterparty_id,
        role_id=counterparty_role,
    )

    return message


async def list_conversations(
    db: AsyncSession, user: CurrentUser
) -> list[Conversation]:
    is_client = user.role_id == ROLE_IDS[RoleType.CLIENT]
    if is_client:
        stmt = select(Conversation).where(Conversation.client_id == user.id)
    elif user.role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = select(Conversation).where(Conversation.tutor_id == user.id)
    else:
        return []
    convs = list((await db.execute(stmt)).scalars().all())
    if not convs:
        return []

    # Karşı taraf: client isem tutor, tutor isem client. İsimleri tek sorguda çek.
    counterparty = Tutor if is_client else Client
    cp_ids = {(c.tutor_id if is_client else c.client_id) for c in convs}
    name_rows = (
        await db.execute(
            select(counterparty.id, counterparty.full_name, counterparty.avatar_url).where(
                counterparty.id.in_(cp_ids)
            )
        )
    ).all()
    names = {row[0]: row[1] for row in name_rows}
    avatars = {row[0]: row[2] for row in name_rows}

    # Her sohbetin son mesajı (Postgres DISTINCT ON).
    conv_ids = [c.id for c in convs]
    last_rows = (
        await db.execute(
            select(Message.conversation_id, Message.body, Message.created_at)
            .where(Message.conversation_id.in_(conv_ids))
            # id tiebreaker: aynı created_at'te (ör. art arda) deterministik son mesaj.
            .order_by(
                Message.conversation_id,
                Message.created_at.desc(),
                Message.id.desc(),
            )
            .distinct(Message.conversation_id)
        )
    ).all()
    last = {row[0]: (row[1], row[2]) for row in last_rows}

    # Okunmamış: karşı taraftan gelen, viewer'ın son okumasından sonraki mesajlar.
    read_col = (
        Conversation.client_last_read_at
        if is_client
        else Conversation.tutor_last_read_at
    )
    other_role = "TUTOR" if is_client else "CLIENT"
    unread_rows = await db.execute(
        select(Message.conversation_id, func.count())
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.conversation_id.in_(conv_ids),
            Message.sender_role == other_role,
            or_(read_col.is_(None), Message.created_at > read_col),
        )
        .group_by(Message.conversation_id)
    )
    unread = {row[0]: row[1] for row in unread_rows.all()}

    for c in convs:
        cp_id = c.tutor_id if is_client else c.client_id
        c.counterparty_id = cp_id
        c.counterparty_name = names.get(cp_id)
        c.counterparty_avatar_url = avatars.get(cp_id)
        lm = last.get(c.id)
        c.last_message = lm[0] if lm else None
        c.last_message_at = lm[1] if lm else None
        c.unread = unread.get(c.id, 0)

    convs.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return convs


async def mark_read(
    db: AsyncSession, user: CurrentUser, conversation_id: int
) -> None:
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    is_client = user.role_id == ROLE_IDS[RoleType.CLIENT]
    is_party = (is_client and conv.client_id == user.id) or (
        user.role_id == ROLE_IDS[RoleType.TUTOR] and conv.tutor_id == user.id
    )
    if not is_party:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your conversation")
    now = datetime.datetime.now(datetime.timezone.utc)
    if is_client:
        conv.client_last_read_at = now
    else:
        conv.tutor_last_read_at = now
    await db.flush()


async def unread_total(db: AsyncSession, user: CurrentUser) -> int:
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        party_col, read_col, other_role = (
            Conversation.client_id,
            Conversation.client_last_read_at,
            "TUTOR",
        )
    elif user.role_id == ROLE_IDS[RoleType.TUTOR]:
        party_col, read_col, other_role = (
            Conversation.tutor_id,
            Conversation.tutor_last_read_at,
            "CLIENT",
        )
    else:
        return 0
    total = await db.scalar(
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            party_col == user.id,
            Message.sender_role == other_role,
            or_(read_col.is_(None), Message.created_at > read_col),
        )
    )
    return int(total or 0)


async def list_messages(
    db: AsyncSession,
    user: CurrentUser,
    conversation_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[Message]:
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    is_party = (
        user.role_id == ROLE_IDS[RoleType.CLIENT] and conv.client_id == user.id
    ) or (user.role_id == ROLE_IDS[RoleType.TUTOR] and conv.tutor_id == user.id)
    if not is_party:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your conversation")
    rows = (
        await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows)
