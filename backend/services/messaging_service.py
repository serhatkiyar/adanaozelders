from __future__ import annotations

import datetime
from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand
from models.demand_response import DemandResponse
from models.messaging import Conversation, Message, MessageReaction
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from core import ws_outbox
from core.moderation import mask_contact_info
from schemas.messaging import (
    ConversationOut,
    MessageOut,
    MessageSearchHit,
    MessageSearchResults,
    MessagesUnreadCounts,
    ReactionOut,
    ReplyPreview,
)

CurrentUser = Admin | Tutor | Client

# Bırakılabilecek emoji seti (kötüye kullanımı sınırlamak için sabit liste).
ALLOWED_EMOJIS = {"👍", "❤️", "😄", "🎉", "😮", "😢", "🙏"}

_REPLY_PREVIEW_MAX = 140


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


def _is_party(conv: Conversation, user: CurrentUser) -> bool:
    is_client = user.role_id == ROLE_IDS[RoleType.CLIENT]
    return (is_client and conv.client_id == user.id) or (
        user.role_id == ROLE_IDS[RoleType.TUTOR] and conv.tutor_id == user.id
    )


def _counterparty(conv: Conversation, user: CurrentUser) -> tuple[int, int]:
    """Karşı tarafın (user_id, role_id) — WS push hedefi için."""
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        return conv.tutor_id, ROLE_IDS[RoleType.TUTOR]
    return conv.client_id, ROLE_IDS[RoleType.CLIENT]


def _preview_body(body: str) -> str:
    return body if len(body) <= _REPLY_PREVIEW_MAX else body[:_REPLY_PREVIEW_MAX] + "…"


async def _reactions_for(
    db: AsyncSession, message_ids: list[int], viewer_role: int, viewer_id: int
) -> dict[int, list[ReactionOut]]:
    """Mesaj id'leri için emoji başına sayım + viewer'ın tepki verip vermediği."""
    if not message_ids:
        return {}
    rows = (
        await db.execute(
            select(
                MessageReaction.message_id,
                MessageReaction.emoji,
                MessageReaction.role_id,
                MessageReaction.user_id,
            ).where(MessageReaction.message_id.in_(message_ids))
        )
    ).all()
    counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    mine: dict[int, set[str]] = defaultdict(set)
    for mid, emoji, rid, uid in rows:
        counts[mid][emoji] += 1
        if rid == viewer_role and uid == viewer_id:
            mine[mid].add(emoji)
    out: dict[int, list[ReactionOut]] = {}
    for mid, by_emoji in counts.items():
        out[mid] = [
            ReactionOut(emoji=e, count=n, reacted=e in mine[mid])
            for e, n in sorted(by_emoji.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
    return out


async def send_message(
    db: AsyncSession,
    *,
    sender: CurrentUser,
    counterparty_id: int,
    body: str,
    reply_to_id: int | None = None,
) -> MessageOut:
    client_id, tutor_id, sender_role = _resolve_pair(sender, counterparty_id)
    # Uygunluk gönderim anında değerlendirilir; biten/iptal rezervasyonda sohbet read-only olur.
    if not await _can_message(db, client_id, tutor_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Mesajlaşmak için aranızda beklemede veya onaylı bir rezervasyon olmalı.",
        )
    conv_id = await _conversation_id(db, client_id, tutor_id)

    # Yanıt hedefi yalnızca aynı sohbetteyse geçerli — değilse sessizce yok say.
    reply_preview: ReplyPreview | None = None
    valid_reply_id: int | None = None
    if reply_to_id is not None:
        target = await db.get(Message, reply_to_id)
        if target is not None and target.conversation_id == conv_id:
            valid_reply_id = target.id
            reply_preview = ReplyPreview(
                id=target.id,
                sender_role=target.sender_role,
                body=_preview_body(target.body),
            )

    message = Message(
        conversation_id=conv_id,
        sender_role=sender_role,
        sender_id=sender.id,
        body=mask_contact_info(body),
        reply_to_id=valid_reply_id,
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)

    counterparty_role = (
        ROLE_IDS[RoleType.TUTOR] if sender_role == "CLIENT" else ROLE_IDS[RoleType.CLIENT]
    )
    # Commit sonrası gönderilir (bkz. core/ws_outbox).
    ws_outbox.enqueue(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
        user_id=counterparty_id,
        role_id=counterparty_role,
    )

    return MessageOut(
        id=message.id,
        conversation_id=conv_id,
        sender_role=message.sender_role,
        sender_id=message.sender_id,
        body=message.body,
        created_at=message.created_at,
        reply_to_id=valid_reply_id,
        reply_preview=reply_preview,
        reactions=[],
    )


# Mesaj aramasında döndürülecek azami eşleşme satırı sayısı.
_SEARCH_HIT_LIMIT = 50


def _escape_like(term: str) -> str:
    """ILIKE deseninde kullanıcı girdisindeki joker karakterleri (% _ \\) kaçır."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _enrich_conversations(
    db: AsyncSession, user: CurrentUser
) -> tuple[bool, list[Conversation]]:
    """User'ın TÜM sohbetlerini yükler ve türetilmiş alanları (karşı taraf,
    son mesaj, okunmamış sayısı, arşiv durumu) doldurur; son mesaja göre sıralar.
    `(is_client, convs)` döner. Hem listeleme hem arama bunu paylaşır."""
    is_client = user.role_id == ROLE_IDS[RoleType.CLIENT]
    if is_client:
        stmt = select(Conversation).where(Conversation.client_id == user.id)
    elif user.role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = select(Conversation).where(Conversation.tutor_id == user.id)
    else:
        return is_client, []
    convs = list((await db.execute(stmt)).scalars().all())
    if not convs:
        return is_client, []

    archived_col = "client_archived_at" if is_client else "tutor_archived_at"

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
        c.archived = getattr(c, archived_col) is not None

    convs.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return is_client, convs


async def list_conversations(
    db: AsyncSession, user: CurrentUser, archived: bool = False
) -> list[Conversation]:
    _is_client, convs = await _enrich_conversations(db, user)
    # Arşiv filtresi: archived=False → arşivlenmemişler; True → yalnız arşivlenenler.
    return [c for c in convs if c.archived == archived]


async def search_messages(
    db: AsyncSession, user: CurrentUser, q: str
) -> MessageSearchResults:
    """İki bölümlü arama: karşı taraf adı eşleşen sohbetler (chats) + gövdesi
    eşleşen her mesaj ayrı satır (messages). Yalnız aktif (arşivlenmemiş)
    sohbetlerde, mesajlar en güncelden eskiye, sınırlı sayıda döndürülür."""
    term = (q or "").strip()
    if not term:
        return MessageSearchResults(chats=[], messages=[])

    _is_client, convs = await _enrich_conversations(db, user)
    active = [c for c in convs if not c.archived]
    if not active:
        return MessageSearchResults(chats=[], messages=[])

    term_low = term.lower()
    chats = [
        ConversationOut.model_validate(c)
        for c in active
        if term_low in (c.counterparty_name or "").lower()
    ]

    by_id = {c.id: c for c in active}
    pattern = f"%{_escape_like(term)}%"
    rows = (
        await db.execute(
            select(
                Message.id,
                Message.conversation_id,
                Message.sender_role,
                Message.body,
                Message.created_at,
            )
            .where(
                Message.conversation_id.in_(list(by_id.keys())),
                Message.body.ilike(pattern, escape="\\"),
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(_SEARCH_HIT_LIMIT)
        )
    ).all()

    messages: list[MessageSearchHit] = []
    for mid, cid, srole, body, created in rows:
        c = by_id.get(cid)
        if c is None:
            continue
        messages.append(
            MessageSearchHit(
                message_id=mid,
                conversation_id=cid,
                counterparty_id=c.counterparty_id,
                counterparty_name=c.counterparty_name,
                counterparty_avatar_url=c.counterparty_avatar_url,
                sender_role=srole,
                body=body,
                created_at=created,
            )
        )
    return MessageSearchResults(chats=chats, messages=messages)


async def set_archived(
    db: AsyncSession, user: CurrentUser, conversation_id: int, archived: bool
) -> None:
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if not _is_party(conv, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your conversation")
    now = datetime.datetime.now(datetime.timezone.utc) if archived else None
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        conv.client_archived_at = now
    else:
        conv.tutor_archived_at = now
    await db.flush()


async def toggle_reaction(
    db: AsyncSession, user: CurrentUser, message_id: int, emoji: str
) -> list[ReactionOut]:
    if emoji not in ALLOWED_EMOJIS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçersiz emoji")
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    conv = await db.get(Conversation, message.conversation_id)
    if conv is None or not _is_party(conv, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your conversation")

    existing = await db.scalar(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.role_id == user.role_id,
            MessageReaction.user_id == user.id,
            MessageReaction.emoji == emoji,
        )
    )
    if existing is not None:
        await db.delete(existing)
    else:
        db.add(
            MessageReaction(
                message_id=message_id,
                role_id=user.role_id,
                user_id=user.id,
                emoji=emoji,
            )
        )
    await db.flush()

    # Karşı tarafa canlı yenileme (mesaj listesini tazeler).
    cp_id, cp_role = _counterparty(conv, user)
    ws_outbox.enqueue(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv.id}},
        user_id=cp_id,
        role_id=cp_role,
    )

    by_msg = await _reactions_for(db, [message_id], user.role_id, user.id)
    return by_msg.get(message_id, [])


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


async def unread_counts(db: AsyncSession, user: CurrentUser) -> MessagesUnreadCounts:
    """Okunmamış mesajları gelen kutusu (arşivlenmemiş) ve arşiv olarak ayrı sayar.
    Böylece "Okunmamış" rozeti tıklayınca açılamayan arşiv mesajlarını saymaz."""
    if user.role_id == ROLE_IDS[RoleType.CLIENT]:
        party_col, read_col, archived_col, other_role = (
            Conversation.client_id,
            Conversation.client_last_read_at,
            Conversation.client_archived_at,
            "TUTOR",
        )
    elif user.role_id == ROLE_IDS[RoleType.TUTOR]:
        party_col, read_col, archived_col, other_role = (
            Conversation.tutor_id,
            Conversation.tutor_last_read_at,
            Conversation.tutor_archived_at,
            "CLIENT",
        )
    else:
        return MessagesUnreadCounts(inbox=0, archived=0)
    archived_expr = archived_col.isnot(None)
    rows = (
        await db.execute(
            select(archived_expr.label("is_archived"), func.count())
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                party_col == user.id,
                Message.sender_role == other_role,
                or_(read_col.is_(None), Message.created_at > read_col),
            )
            .group_by(archived_expr)
        )
    ).all()
    inbox = archived = 0
    for is_archived, count in rows:
        if is_archived:
            archived = int(count)
        else:
            inbox = int(count)
    return MessagesUnreadCounts(inbox=inbox, archived=archived)


async def list_messages(
    db: AsyncSession,
    user: CurrentUser,
    conversation_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[MessageOut]:
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if not _is_party(conv, user):
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
    msgs = list(rows)

    # Yanıt önizlemeleri (tek sorguda).
    reply_ids = {m.reply_to_id for m in msgs if m.reply_to_id is not None}
    reply_map: dict[int, ReplyPreview] = {}
    if reply_ids:
        rrows = (
            await db.execute(
                select(Message.id, Message.sender_role, Message.body).where(
                    Message.id.in_(reply_ids)
                )
            )
        ).all()
        for rid, role, body in rrows:
            reply_map[rid] = ReplyPreview(
                id=rid, sender_role=role, body=_preview_body(body)
            )

    # Reaksiyonlar (tek sorguda).
    reactions_map = await _reactions_for(
        db, [m.id for m in msgs], user.role_id, user.id
    )

    return [
        MessageOut(
            id=m.id,
            conversation_id=m.conversation_id,
            sender_role=m.sender_role,
            sender_id=m.sender_id,
            body=m.body,
            created_at=m.created_at,
            reply_to_id=m.reply_to_id,
            reply_preview=reply_map.get(m.reply_to_id) if m.reply_to_id else None,
            reactions=reactions_map.get(m.id, []),
        )
        for m in msgs
    ]
