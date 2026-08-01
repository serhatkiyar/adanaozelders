from __future__ import annotations

import datetime
from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy import exists, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand
from models.demand_response import DemandResponse
from models.library import Library
from models.library_operator import LibraryOperator
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

CurrentUser = Admin | Tutor | Client | LibraryOperator

# Bırakılabilecek emoji seti (kötüye kullanımı sınırlamak için sabit liste).
ALLOWED_EMOJIS = {"👍", "❤️", "😄", "🎉", "😮", "😢", "🙏"}

_REPLY_PREVIEW_MAX = 140

# ── Taraf (party) modeli: CLIENT, TUTOR, LIBRARY ──
# Bir sohbette tam iki taraf vardır. Kütüphane tarafına operatör (role_id=4) erişir;
# party kimliği library_id'dir (tüm operatörler aynı sohbeti görür).
_ROLE_CLIENT = ROLE_IDS[RoleType.CLIENT]
_ROLE_TUTOR = ROLE_IDS[RoleType.TUTOR]
_ROLE_LIBRARY = ROLE_IDS[RoleType.LIBRARY_OPERATOR]

_SLOT_COL = {"CLIENT": "client_id", "TUTOR": "tutor_id", "LIBRARY": "library_id"}
_READ_COL = {
    "CLIENT": "client_last_read_at",
    "TUTOR": "tutor_last_read_at",
    "LIBRARY": "library_last_read_at",
}
_ARCH_COL = {
    "CLIENT": "client_archived_at",
    "TUTOR": "tutor_archived_at",
    "LIBRARY": "library_archived_at",
}
_ROLE_OF_NAME = {"CLIENT": _ROLE_CLIENT, "TUTOR": _ROLE_TUTOR, "LIBRARY": _ROLE_LIBRARY}
_ALL_SLOTS = ("client_id", "tutor_id", "library_id")
_VALID_PARTY_ROLES = {_ROLE_CLIENT, _ROLE_TUTOR, _ROLE_LIBRARY}

# Taraf çifti -> kısmî unique index (on_conflict için).
_CONFLICT = {
    frozenset({"CLIENT", "TUTOR"}): (
        ["client_id", "tutor_id"],
        "client_id IS NOT NULL AND tutor_id IS NOT NULL",
    ),
    frozenset({"CLIENT", "LIBRARY"}): (
        ["client_id", "library_id"],
        "client_id IS NOT NULL AND library_id IS NOT NULL",
    ),
    frozenset({"TUTOR", "LIBRARY"}): (
        ["tutor_id", "library_id"],
        "tutor_id IS NOT NULL AND library_id IS NOT NULL",
    ),
}


def _party_of(user: CurrentUser) -> tuple[str, int]:
    """Kullanıcının sohbet taraf kimliği (role_name, party_id)."""
    if user.role_id == _ROLE_CLIENT:
        return "CLIENT", user.id
    if user.role_id == _ROLE_TUTOR:
        return "TUTOR", user.id
    if user.role_id == _ROLE_LIBRARY:
        return "LIBRARY", user.library_id
    raise HTTPException(
        status.HTTP_403_FORBIDDEN, "Messaging not allowed for this role"
    )


def _slots_for(a: tuple[str, int], b: tuple[str, int]) -> dict[str, int]:
    return {_SLOT_COL[a[0]]: a[1], _SLOT_COL[b[0]]: b[1]}


def _other_party(conv: Conversation, my_role: str) -> tuple[str, int] | None:
    """Sohbetteki diğer tarafın (role_name, party_id)'si."""
    for name, col in _SLOT_COL.items():
        if name == my_role:
            continue
        val = getattr(conv, col)
        if val is not None:
            return name, val
    return None


async def _operator_ids(db: AsyncSession, library_id: int) -> list[int]:
    rows = await db.execute(
        select(LibraryOperator.id).where(
            LibraryOperator.library_id == library_id,
            LibraryOperator.deleted_at.is_(None),
        )
    )
    return [r[0] for r in rows.all()]


async def _notify_party(
    db: AsyncSession, payload: dict, party: tuple[str, int]
) -> None:
    """Bir tarafa WS push. Kütüphane tarafında o kütüphanenin TÜM operatörlerine."""
    name, pid = party
    if name == "LIBRARY":
        for oid in await _operator_ids(db, pid):
            ws_outbox.enqueue(db, payload, user_id=oid, role_id=_ROLE_LIBRARY)
    else:
        ws_outbox.enqueue(db, payload, user_id=pid, role_id=_ROLE_OF_NAME[name])


async def _can_message(
    db: AsyncSession, a: tuple[str, int], b: tuple[str, int]
) -> bool:
    """Çift bazlı ilişki politikası (İP-3 §1) — `a` GÖNDEREN, `b` hedef.

    - CLIENT↔TUTOR: rezervasyon/talep-yanıtı kuralı.
    - CLIENT→LIBRARY: açık (public işletmeye destek talebi; hedefin ACTIVE
      olduğu `_validate_target`'ta doğrulanır). Bu sohbet ilişkiyi doğurur.
    - LIBRARY→CLIENT: yalnız GERÇEK, kütüphane bazlı iş ilişkisi.
    - LIBRARY↔TUTOR: tanımlı bir iş ilişkisi modeli yok → İKİ YÖN de kapalı.
    """
    roles = {a[0], b[0]}
    parties = {a[0]: a[1], b[0]: b[1]}
    if roles == {"CLIENT", "TUTOR"}:
        return await _can_message_client_tutor(db, parties["CLIENT"], parties["TUTOR"])
    if roles == {"CLIENT", "LIBRARY"}:
        if a[0] == "CLIENT":
            return True
        return await _can_message_library_client(
            db, library_id=parties["LIBRARY"], client_id=parties["CLIENT"]
        )
    return False


async def _can_message_library_client(
    db: AsyncSession, *, library_id: int, client_id: int
) -> bool:
    """Operatör → öğrenci yalnız gerçek iş ilişkisiyle yazabilir (İP-3 §1.2-1.4).

    İlişki KÜTÜPHANE bazlıdır (A'daki kayıt B operatörünü yetkilendirmez):
    o kütüphanenin oturumuna aktif deneme kaydı · o kütüphanede aktif çalışma
    rezervasyonu · öğrencinin kendi başlattığı sohbet (sohbetin varlığı yetmez —
    `_conversation_id` sohbeti operatör yazarken de yaratır; öğrencinin GERÇEK
    bir mesajı aranır).
    """
    from models.library_exam import (
        ACTIVE_REGISTRATION_STATUSES,
        ExamRegistration,
        LibraryExamSession,
    )
    from models.study_reservation import StudyReservation

    has_exam_reg = exists().where(
        ExamRegistration.session_id == LibraryExamSession.id,
        LibraryExamSession.library_id == library_id,
        LibraryExamSession.deleted_at.is_(None),
        ExamRegistration.client_id == client_id,
        ExamRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
        ExamRegistration.deleted_at.is_(None),
    )
    has_study_res = exists().where(
        StudyReservation.library_id == library_id,
        StudyReservation.client_id == client_id,
        StudyReservation.status.in_(ACTIVE_REGISTRATION_STATUSES),
        StudyReservation.deleted_at.is_(None),
    )
    client_started = exists().where(
        Conversation.library_id == library_id,
        Conversation.client_id == client_id,
        Message.conversation_id == Conversation.id,
        Message.sender_role == "CLIENT",
    )
    return bool(
        await db.scalar(select(or_(has_exam_reg, has_study_res, client_started)))
    )


async def _assert_sender_library_active(
    db: AsyncSession, sender: LibraryOperator
) -> None:
    """Operatör GÖNDEREN olduğunda kendi kütüphanesi ACTIVE olmalı (İP-3 §1.1).

    Self-servis kayıt (`POST /libraries/register`) anında geçerli token
    ürettiğinden rol tek başına yetki değildir; PENDING/REJECTED/HIDDEN/
    silinmiş ve tanımsız durumların hepsi kapalıdır (allowlist, fail-closed).
    """
    lib = await db.get(Library, sender.library_id)
    if lib is None or lib.deleted_at is not None or lib.status != "ACTIVE":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Kütüphaneniz henüz onaylanmadı; mesajlaşma onaydan sonra kullanılabilir.",
        )


async def _can_message_client_tutor(
    db: AsyncSession, client_id: int, tutor_id: int
) -> bool:
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


async def _conversation_id(
    db: AsyncSession, a: tuple[str, int], b: tuple[str, int]
) -> int:
    slots = _slots_for(a, b)
    elems, where = _CONFLICT[frozenset({a[0], b[0]})]
    conv_id = await db.scalar(
        insert(Conversation)
        .values(**slots)
        .on_conflict_do_nothing(index_elements=elems, index_where=text(where))
        .returning(Conversation.id)
    )
    if conv_id is None:
        conds = [getattr(Conversation, col) == val for col, val in slots.items()]
        conv_id = await db.scalar(select(Conversation.id).where(*conds))
    return conv_id


def _is_party(conv: Conversation, user: CurrentUser) -> bool:
    role_name, pid = _party_of(user)
    return getattr(conv, _SLOT_COL[role_name]) == pid


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


async def _validate_target(
    db: AsyncSession, target_role: str, target_id: int
) -> None:
    """Karşı tarafın geçerli (var + erişilebilir) olduğunu doğrular."""
    if target_role == "LIBRARY":
        lib = await db.get(Library, target_id)
        if lib is None or lib.deleted_at is not None or lib.status != "ACTIVE":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    elif target_role == "TUTOR":
        t = await db.get(Tutor, target_id)
        if t is None or t.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Eğitmen bulunamadı")
    elif target_role == "CLIENT":
        c = await db.get(Client, target_id)
        if c is None or c.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Öğrenci bulunamadı")


async def send_message(
    db: AsyncSession,
    *,
    sender: CurrentUser,
    counterparty_role: str,
    counterparty_id: int,
    body: str,
    reply_to_id: int | None = None,
) -> MessageOut:
    sender_party = _party_of(sender)
    counterparty_role = counterparty_role.upper()
    if counterparty_role not in _SLOT_COL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Geçersiz alıcı türü")
    if counterparty_role == sender_party[0]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Aynı türdeki taraflar mesajlaşamaz"
        )
    target_party = (counterparty_role, counterparty_id)
    if sender_party[0] == "LIBRARY":
        # 1) Gönderen operatörün kütüphanesi ACTIVE olmalı (İP-3 §1.1).
        await _assert_sender_library_active(db, sender)
        # 2) Varlık sızmaz (İP-3 §1.7): var olan ilişkisiz hedef ile hiç olmayan
        #    id AYNI yanıtı alır — hedef doğrulaması `_validate_target`ın 404'üne
        #    değil, ilişki kararıyla birlikte tek tip 403'e bağlanır.
        target_exists = False
        if counterparty_role == "CLIENT":
            target_exists = bool(
                await db.scalar(
                    select(
                        exists().where(
                            Client.id == counterparty_id,
                            Client.deleted_at.is_(None),
                        )
                    )
                )
            )
        if not target_exists or not await _can_message(
            db, sender_party, target_party
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Bu kullanıcıya mesaj gönderme yetkiniz yok.",
            )
    else:
        await _validate_target(db, counterparty_role, counterparty_id)
        # Uygunluk gönderim anında değerlendirilir; CLIENT↔TUTOR'da rezervasyon gerekir.
        if not await _can_message(db, sender_party, target_party):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Mesajlaşmak için aranızda beklemede veya onaylı bir rezervasyon olmalı.",
            )
    conv_id = await _conversation_id(db, sender_party, target_party)

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
        sender_role=sender_party[0],
        sender_id=sender.id,
        body=mask_contact_info(body),
        reply_to_id=valid_reply_id,
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)

    # Commit sonrası gönderilir (bkz. core/ws_outbox). Kütüphane tarafında tüm operatörlere.
    await _notify_party(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
        target_party,
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
        msg_type="text",
        meta_data=None,
    )


async def inject_system_message(
    db: AsyncSession,
    *,
    client_id: int,
    tutor_id: int,
    msg_type: str,
    body: str,
    meta_data: dict | None = None,
) -> int:
    """Sistem tarafından sohbete özel mesaj enjekte eder (ör. ders talebi kartı).
    Erişim denetimi atlanır; yalnız servis katmanından çağrılmalı."""
    conv_id = await _conversation_id(db, ("CLIENT", client_id), ("TUTOR", tutor_id))
    message = Message(
        conversation_id=conv_id,
        sender_role="SYSTEM",
        sender_id=0,
        body=body,
        msg_type=msg_type,
        meta_data=meta_data,
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)
    # Her iki tarafa da canlı bildirim
    ws_outbox.enqueue(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
        user_id=tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
    )
    ws_outbox.enqueue(
        db,
        {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
        user_id=client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
    )
    return conv_id


# Mesaj aramasında döndürülecek azami eşleşme satırı sayısı.
_SEARCH_HIT_LIMIT = 50


def _escape_like(term: str) -> str:
    """ILIKE deseninde kullanıcı girdisindeki joker karakterleri (% _ \\) kaçır."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _enrich_conversations(
    db: AsyncSession, user: CurrentUser
) -> tuple[str, list[Conversation]]:
    """User'ın TÜM sohbetlerini yükler ve türetilmiş alanları (karşı taraf,
    son mesaj, okunmamış sayısı, arşiv durumu) doldurur; son mesaja göre sıralar.
    `(my_role, convs)` döner. Karşı taraf CLIENT/TUTOR/LIBRARY olabilir."""
    if user.role_id not in _VALID_PARTY_ROLES:
        return "", []
    my_role, my_id = _party_of(user)
    stmt = select(Conversation).where(
        getattr(Conversation, _SLOT_COL[my_role]) == my_id
    )
    convs = list((await db.execute(stmt)).scalars().all())
    if not convs:
        return my_role, []

    archived_col = _ARCH_COL[my_role]

    # Karşı tarafları türlerine göre topla (CLIENT/TUTOR/LIBRARY) ve adlarını çek.
    cp_for: dict[int, tuple[str, int]] = {}
    by_type: dict[str, set[int]] = {"CLIENT": set(), "TUTOR": set(), "LIBRARY": set()}
    for c in convs:
        other = _other_party(c, my_role)
        if other is None:
            continue
        cp_for[c.id] = other
        by_type[other[0]].add(other[1])

    names: dict[tuple[str, int], tuple[str, str | None]] = {}
    if by_type["CLIENT"]:
        for cid, fn, av in (
            await db.execute(
                select(Client.id, Client.full_name, Client.avatar_url).where(
                    Client.id.in_(by_type["CLIENT"])
                )
            )
        ).all():
            names[("CLIENT", cid)] = (fn, av)
    if by_type["TUTOR"]:
        for tid, fn, av in (
            await db.execute(
                select(Tutor.id, Tutor.full_name, Tutor.avatar_url).where(
                    Tutor.id.in_(by_type["TUTOR"])
                )
            )
        ).all():
            names[("TUTOR", tid)] = (fn, av)
    if by_type["LIBRARY"]:
        for lid, nm, logo in (
            await db.execute(
                select(Library.id, Library.name, Library.logo_url).where(
                    Library.id.in_(by_type["LIBRARY"])
                )
            )
        ).all():
            names[("LIBRARY", lid)] = (nm, logo)

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

    # Okunmamış: karşı taraftan (=benden ve SYSTEM'den olmayan) son okumamdan sonraki.
    read_col = getattr(Conversation, _READ_COL[my_role])
    unread_rows = await db.execute(
        select(Message.conversation_id, func.count())
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.conversation_id.in_(conv_ids),
            Message.sender_role.notin_([my_role, "SYSTEM"]),
            or_(read_col.is_(None), Message.created_at > read_col),
        )
        .group_by(Message.conversation_id)
    )
    unread = {row[0]: row[1] for row in unread_rows.all()}

    for c in convs:
        other = cp_for.get(c.id)
        nm = names.get(other) if other else None
        c.counterparty_id = other[1] if other else None
        c.counterparty_name = nm[0] if nm else None
        c.counterparty_avatar_url = nm[1] if nm else None
        # Frontend'in alıcıyı doğru hedeflemesi için karşı taraf rolü.
        c.counterparty_role = other[0] if other else None
        lm = last.get(c.id)
        c.last_message = lm[0] if lm else None
        c.last_message_at = lm[1] if lm else None
        c.unread = unread.get(c.id, 0)
        # Karşı tarafın son okuma anı ("Görüldü" göstergesi için).
        c.counterparty_last_read_at = (
            getattr(c, _READ_COL[other[0]]) if other else None
        )
        c.archived = getattr(c, archived_col) is not None

    convs.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return my_role, convs


async def list_conversations(
    db: AsyncSession, user: CurrentUser, archived: bool = False
) -> list[Conversation]:
    _role, convs = await _enrich_conversations(db, user)
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

    _role, convs = await _enrich_conversations(db, user)
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
                counterparty_role=c.counterparty_role,
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
    my_role, _ = _party_of(user)
    setattr(conv, _ARCH_COL[my_role], now)
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
    my_role, _ = _party_of(user)
    other = _other_party(conv, my_role)
    if other is not None:
        await _notify_party(
            db,
            {"type": "NEW_MESSAGE", "data": {"conversation_id": conv.id}},
            other,
        )

    by_msg = await _reactions_for(db, [message_id], user.role_id, user.id)
    return by_msg.get(message_id, [])


async def mark_read(
    db: AsyncSession, user: CurrentUser, conversation_id: int
) -> None:
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if not _is_party(conv, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your conversation")
    my_role, _ = _party_of(user)
    now = datetime.datetime.now(datetime.timezone.utc)
    setattr(conv, _READ_COL[my_role], now)
    await db.flush()
    # Karşı tarafa (gönderene) sinyal: "Görüldü" göstergesi canlı güncellensin.
    # Yeni mesaj yok; yalnız sohbet/okuma durumu tazelensin diye NEW_MESSAGE yayılır.
    other = _other_party(conv, my_role)
    if other is not None:
        await _notify_party(
            db,
            {"type": "NEW_MESSAGE", "data": {"conversation_id": conv.id}},
            other,
        )


async def unread_counts(db: AsyncSession, user: CurrentUser) -> MessagesUnreadCounts:
    """Okunmamış mesajları gelen kutusu (arşivlenmemiş) ve arşiv olarak ayrı sayar.
    Böylece "Okunmamış" rozeti tıklayınca açılamayan arşiv mesajlarını saymaz."""
    if user.role_id not in _VALID_PARTY_ROLES:
        return MessagesUnreadCounts(inbox=0, archived=0)
    my_role, my_id = _party_of(user)
    party_col = getattr(Conversation, _SLOT_COL[my_role])
    read_col = getattr(Conversation, _READ_COL[my_role])
    archived_col = getattr(Conversation, _ARCH_COL[my_role])
    archived_expr = archived_col.isnot(None)
    rows = (
        await db.execute(
            select(archived_expr.label("is_archived"), func.count())
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                party_col == my_id,
                Message.sender_role.notin_([my_role, "SYSTEM"]),
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
            msg_type=m.msg_type,
            meta_data=m.meta_data,
        )
        for m in msgs
    ]
