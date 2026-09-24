from __future__ import annotations

import datetime
import math
from collections import defaultdict
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy import delete, exists, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.booking import Booking, BookingStatus
from models.client import Client
from models.demand import Demand
from models.demand_response import DemandResponse
from models.library import Library
from models.library_operator import LibraryOperator
from models.messaging import (
    BlockReason,
    Conversation,
    Message,
    MessageReaction,
    MessageTemplate,
    TutorClientBlock,
)
from models.report import Report, ReportReason, ReportStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from core import ws_outbox
from core.config import settings
from core.moderation import mask_contact_info, mask_external_links
from schemas.messaging import (
    BlockCreate,
    ConversationOut,
    MessageOut,
    MessageSearchHit,
    MessageSearchResults,
    MessagesUnreadCounts,
    MessageTemplateCreate,
    MessagingEligibilityOut,
    ReactionOut,
    ReplyPreview,
)
from services import seo_slug_service

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

    - CLIENT↔TUTOR: bu fonksiyondan geçmez; `send_message` çifti doğrudan
      `_assert_client_tutor_send` ile karşılar (aşama + engel + ders öncesi
      sınırlar, Modül 5). Buraya düşerse kapalıdır.
    - CLIENT→LIBRARY: açık (public işletmeye destek talebi; hedefin ACTIVE
      olduğu `_validate_target`'ta doğrulanır). Bu sohbet ilişkiyi doğurur.
    - LIBRARY→CLIENT: yalnız GERÇEK, kütüphane bazlı iş ilişkisi.
    - LIBRARY↔TUTOR: tanımlı bir iş ilişkisi modeli yok → İKİ YÖN de kapalı.
    """
    roles = {a[0], b[0]}
    parties = {a[0]: a[1], b[0]: b[1]}
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


# ── Öğrenci ↔ eğitmen: aşama, engel ve ders öncesi sınırlar (Modül 5) ──

Stage = Literal["LESSON", "INQUIRY"]

# Bu durumlardan birinde silinmemiş rezervasyon "ders ilişkisi" sayılır.
# Geçmiş (COMPLETED) ders de ilişkidir: eski öğrenci sınırsız yazabilir.
_DERS_ILISKISI = (BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED)

# Otomatik şikâyet açan engel gerekçeleri → şikâyet nedeni.
_BLOCK_REPORT_REASON = {
    BlockReason.OFF_PLATFORM: ReportReason.CONTACT_INFO,
    BlockReason.HARASSMENT: ReportReason.HARASSMENT,
    BlockReason.SCAM: ReportReason.SCAM,
}

_MSG_BLOCKED_CLIENT = "Bu öğretmen şu anda senden mesaj kabul etmiyor."
_MSG_BLOCKED_TUTOR = "Bu öğrenciyi engelledin. Yazmak için önce engeli kaldır."
_MSG_TUTOR_CANNOT_START = (
    "Bu öğrenciye yazabilmen için aranızda bir ders ya da öğrencinin "
    "başlattığı bir sohbet olmalı."
)
_INQUIRY_WINDOW = datetime.timedelta(hours=24)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _site_hosts() -> frozenset[str]:
    """Ders öncesi sohbette serbest bırakılan tek alan adı: sitenin kendisi."""
    host = urlsplit(settings.FRONTEND_BASE_URL).hostname
    return frozenset({host}) if host else frozenset()


def _daily_limit_message() -> str:
    return (
        f"Bugün en fazla {settings.MESSAGE_INQUIRY_DAILY_NEW} yeni öğretmene ilk "
        "mesaj gönderebilirsin. Yarın yeniden dene ya da hemen ders talep et."
    )


def _awaiting_reply_message() -> str:
    return (
        "Öğretmen yanıt verene kadar en fazla "
        f"{settings.MESSAGE_INQUIRY_MAX_UNANSWERED} mesaj gönderebilirsin."
    )


def _error(
    status_code: int, code: str, message: str, headers: dict | None = None
) -> HTTPException:
    """Mesajlaşma hataları yapılandırılmış gövde döner: {code, message}."""
    return HTTPException(
        status_code, detail={"code": code, "message": message}, headers=headers
    )


async def client_tutor_stage(
    db: AsyncSession, *, client_id: int, tutor_id: int
) -> Stage:
    """Çiftin aşaması: ders ilişkisi (rezervasyon PENDING/ACCEPTED/COMPLETED ya da
    eğitmenin öğrencinin bir talebine yanıtı) varsa LESSON, yoksa INQUIRY."""
    has_booking = exists().where(
        Booking.client_id == client_id,
        Booking.tutor_id == tutor_id,
        Booking.status.in_(_DERS_ILISKISI),
        Booking.deleted_at.is_(None),
    )
    has_demand_response = exists().where(
        DemandResponse.tutor_id == tutor_id,
        DemandResponse.demand_id == Demand.id,
        DemandResponse.deleted_at.is_(None),
        Demand.client_id == client_id,
        Demand.deleted_at.is_(None),
    )
    lesson = await db.scalar(select(or_(has_booking, has_demand_response)))
    return "LESSON" if lesson else "INQUIRY"


async def is_blocked(db: AsyncSession, *, tutor_id: int, client_id: int) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    TutorClientBlock.tutor_id == tutor_id,
                    TutorClientBlock.client_id == client_id,
                )
            )
        )
    )


async def assert_client_not_blocked(
    db: AsyncSession, *, tutor_id: int, client_id: int
) -> None:
    """Engellenen öğrencinin eğitmene serbest metin yollarını (ders yorumu,
    ders sonrası soru-cevap) kapatır; engel sohbetle sınırlı kalmasın."""
    if await is_blocked(db, tutor_id=tutor_id, client_id=client_id):
        raise _error(status.HTTP_403_FORBIDDEN, "MESSAGE_BLOCKED", _MSG_BLOCKED_CLIENT)


async def assert_booking_not_blocked(
    db: AsyncSession, *, tutor_id: int, client_id: int
) -> None:
    """Engellenen öğrenci o eğitmene yeni ders talebi açamaz; aksi halde engel
    ders talebi (ve onun sohbet kartı) üzerinden aşılırdı."""
    if await is_blocked(db, tutor_id=tutor_id, client_id=client_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu eğitmen şu anda senden yeni ders talebi kabul etmiyor.",
        )


async def _client_tutor_conversation_id(
    db: AsyncSession, *, client_id: int, tutor_id: int
) -> int | None:
    """Var olan CLIENT↔TUTOR sohbetinin id'si (yaratmaz)."""
    return await db.scalar(
        select(Conversation.id).where(
            Conversation.client_id == client_id,
            Conversation.tutor_id == tutor_id,
        )
    )


async def _sender_counts(db: AsyncSession, conv_id: int | None) -> dict[str, int]:
    """Sohbette gönderen türüne göre mesaj sayısı (CLIENT / TUTOR)."""
    if conv_id is None:
        return {}
    rows = await db.execute(
        select(Message.sender_role, func.count())
        .where(
            Message.conversation_id == conv_id,
            Message.sender_role.in_(["CLIENT", "TUTOR"]),
        )
        .group_by(Message.sender_role)
    )
    return {role: int(n) for role, n in rows.all()}


async def _inquiries_in_window(
    db: AsyncSession, client_id: int, now: datetime.datetime
) -> tuple[int, datetime.datetime | None]:
    """Öğrencinin son 24 saatte başlattığı ders öncesi sohbet sayısı ve en eskisi."""
    count, oldest = (
        await db.execute(
            select(func.count(), func.min(Conversation.inquiry_started_at)).where(
                Conversation.client_id == client_id,
                Conversation.inquiry_started_at.isnot(None),
                Conversation.inquiry_started_at > now - _INQUIRY_WINDOW,
            )
        )
    ).one()
    return int(count or 0), oldest


async def _get_published_tutor(db: AsyncSession, tutor_id: int) -> Tutor:
    """Yayındaki eğitmen (`booking_service.get_bookable_tutor` ölçütü); değilse 404."""
    from services import booking_service  # döngüsel import: booking → messaging

    try:
        return await booking_service.get_bookable_tutor(db, tutor_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Eğitmen bulunamadı"
            ) from exc
        raise


async def _assert_client_tutor_send(
    db: AsyncSession, sender_role: str, *, client_id: int, tutor_id: int
) -> tuple[Stage, bool]:
    """CLIENT↔TUTOR metin mesajı kapısı. `(aşama, bu mesaj yeni bir ders öncesi
    sohbet başlatıyor mu)` döner; izin yoksa HTTPException.

    Sayımlar veritabanından yapılır; Redis erişilemese de uygulanır (fail-closed).
    """
    # 1) Engel iki yönü de kapatır (sistem mesajları bu kapıdan geçmez).
    if await is_blocked(db, tutor_id=tutor_id, client_id=client_id):
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "MESSAGE_BLOCKED",
            _MSG_BLOCKED_TUTOR if sender_role == "TUTOR" else _MSG_BLOCKED_CLIENT,
        )
    # 2) Ders ilişkisi varsa ek sınır yok.
    stage = await client_tutor_stage(db, client_id=client_id, tutor_id=tutor_id)
    if stage == "LESSON":
        return stage, False

    # 3) Ders öncesi: eğitmen yalnız öğrencinin başlattığı sohbete yazabilir
    #    (kütüphanedeki `client_started` deseni).
    if sender_role == "TUTOR":
        client_started = await db.scalar(
            select(
                exists().where(
                    Conversation.client_id == client_id,
                    Conversation.tutor_id == tutor_id,
                    Message.conversation_id == Conversation.id,
                    Message.sender_role == "CLIENT",
                )
            )
        )
        if not client_started:
            raise _error(
                status.HTTP_403_FORBIDDEN, "TUTOR_CANNOT_START", _MSG_TUTOR_CANNOT_START
            )
        return stage, False

    # 4) Öğrenci: hedef eğitmen yayında olmalı. Sayımlar öğrenci satırı
    #    kilitlenerek yapılır; aynı öğrencinin eşzamanlı istekleri sıraya girer.
    await _get_published_tutor(db, tutor_id)
    await db.execute(select(Client.id).where(Client.id == client_id).with_for_update())
    conv_id = await _client_tutor_conversation_id(
        db, client_id=client_id, tutor_id=tutor_id
    )
    counts = await _sender_counts(db, conv_id)
    client_msgs = counts.get("CLIENT", 0)
    tutor_msgs = counts.get("TUTOR", 0)

    if client_msgs == 0:
        now = _now()
        started, oldest = await _inquiries_in_window(db, client_id, now)
        if started >= settings.MESSAGE_INQUIRY_DAILY_NEW:
            retry = 1
            if oldest is not None:
                retry = max(
                    1, math.ceil((oldest + _INQUIRY_WINDOW - now).total_seconds())
                )
            raise _error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "INQUIRY_DAILY_LIMIT",
                _daily_limit_message(),
                headers={"Retry-After": str(retry)},
            )
        return stage, True

    if tutor_msgs == 0 and client_msgs >= settings.MESSAGE_INQUIRY_MAX_UNANSWERED:
        raise _error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "INQUIRY_AWAITING_REPLY",
            _awaiting_reply_message(),
        )
    return stage, False


async def messaging_eligibility(
    db: AsyncSession, client: Client, tutor_id: int
) -> MessagingEligibilityOut:
    """Öğrencinin bu eğitmene şu an yazıp yazamayacağı (yazma alanı için).
    Gönderim kapısıyla (`_assert_client_tutor_send`) aynı ölçütleri kullanır."""
    stage = await client_tutor_stage(db, client_id=client.id, tutor_id=tutor_id)
    if stage == "INQUIRY":
        await _get_published_tutor(db, tutor_id)
    blocked = await is_blocked(db, tutor_id=tutor_id, client_id=client.id)
    conv_id = await _client_tutor_conversation_id(
        db, client_id=client.id, tutor_id=tutor_id
    )
    counts = await _sender_counts(db, conv_id)
    client_msgs = counts.get("CLIENT", 0)
    tutor_msgs = counts.get("TUTOR", 0)

    remaining: int | None = None
    new_left: int | None = None
    if stage == "INQUIRY":
        if tutor_msgs == 0:
            remaining = max(0, settings.MESSAGE_INQUIRY_MAX_UNANSWERED - client_msgs)
        if client_msgs == 0:
            started, _oldest = await _inquiries_in_window(db, client.id, _now())
            new_left = max(0, settings.MESSAGE_INQUIRY_DAILY_NEW - started)

    reason_code = None
    reason_message = None
    if blocked:
        reason_code, reason_message = "MESSAGE_BLOCKED", _MSG_BLOCKED_CLIENT
    elif new_left == 0:
        reason_code, reason_message = "INQUIRY_DAILY_LIMIT", _daily_limit_message()
    elif client_msgs > 0 and remaining == 0:
        reason_code = "INQUIRY_AWAITING_REPLY"
        reason_message = _awaiting_reply_message()

    return MessagingEligibilityOut(
        can_send=reason_code is None,
        stage=stage,
        blocked=blocked,
        reason_code=reason_code,
        reason_message=reason_message,
        conversation_id=conv_id,
        remaining_before_reply=remaining,
        new_conversations_left_today=new_left,
    )


async def _notify_client_refresh(
    db: AsyncSession, *, client_id: int, tutor_id: int
) -> None:
    """Engel değişince öğrencinin sohbet listesi tazelensin (sohbet varsa)."""
    conv_id = await _client_tutor_conversation_id(
        db, client_id=client_id, tutor_id=tutor_id
    )
    if conv_id is not None:
        ws_outbox.enqueue(
            db,
            {"type": "NEW_MESSAGE", "data": {"conversation_id": conv_id}},
            user_id=client_id,
            role_id=_ROLE_CLIENT,
        )


async def block_client(
    db: AsyncSession, tutor: Tutor, data: BlockCreate
) -> TutorClientBlock:
    """Eğitmen öğrenciyi gerekçeyle engeller.

    Önkoşul: aralarında bir sohbet ya da rezervasyon kaydı olmalı; yoksa 404
    (keyfi id ile öğrenci taraması yapılamaz, varlık bilgisi sızmaz).
    """
    from services import booking_service  # döngüsel import: booking → messaging

    client_id = data.client_id
    conv_id = await _client_tutor_conversation_id(
        db, client_id=client_id, tutor_id=tutor.id
    )
    if conv_id is None and not await booking_service.has_relationship(
        db, tutor_id=tutor.id, client_id=client_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Öğrenci bulunamadı")

    note = mask_contact_info(data.note) if data.note else None
    # Eşzamanlı iki istekte benzersiz kısıt 500 yerine 409'a dönsün.
    block_id = await db.scalar(
        insert(TutorClientBlock)
        .values(
            tutor_id=tutor.id,
            client_id=client_id,
            reason=data.reason.value,
            note=note,
        )
        .on_conflict_do_nothing(constraint="uq_tutor_client_block")
        .returning(TutorClientBlock.id)
    )
    if block_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu öğrenci zaten engelli.")

    report_reason = _BLOCK_REPORT_REASON.get(data.reason)
    if report_reason is not None:
        open_dup = await db.scalar(
            select(Report.id).where(
                Report.reporter_role == tutor.role_id,
                Report.reporter_id == tutor.id,
                Report.target_type == "CLIENT",
                Report.target_id == client_id,
                Report.status == ReportStatus.OPEN,
            )
        )
        if open_dup is None:
            db.add(
                Report(
                    reporter_role=tutor.role_id,
                    reporter_id=tutor.id,
                    target_type="CLIENT",
                    target_id=client_id,
                    reason=report_reason,
                    description=note,
                    target_snapshot=(
                        f"Öğretmen #{tutor.id} engelledi: {data.reason.value}"
                    ),
                )
            )

    await _notify_client_refresh(db, client_id=client_id, tutor_id=tutor.id)
    await db.flush()
    return await db.get(TutorClientBlock, block_id)


async def unblock_client(db: AsyncSession, tutor: Tutor, client_id: int) -> None:
    removed = await db.scalar(
        delete(TutorClientBlock)
        .where(
            TutorClientBlock.tutor_id == tutor.id,
            TutorClientBlock.client_id == client_id,
        )
        .returning(TutorClientBlock.id)
    )
    if removed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Engel bulunamadı")
    await _notify_client_refresh(db, client_id=client_id, tutor_id=tutor.id)
    await db.flush()


# ── Hazır mesaj şablonları (v1: yalnız TUTOR — yetki router'da) ──

_MAX_TEMPLATES_PER_OWNER = 20


async def list_templates(
    db: AsyncSession, owner: CurrentUser
) -> list[MessageTemplate]:
    result = await db.scalars(
        select(MessageTemplate)
        .where(
            MessageTemplate.owner_role == "TUTOR",
            MessageTemplate.owner_id == owner.id,
        )
        .order_by(MessageTemplate.created_at)
    )
    return list(result)


async def create_template(
    db: AsyncSession, owner: CurrentUser, data: MessageTemplateCreate
) -> MessageTemplate:
    count = await db.scalar(
        select(func.count())
        .select_from(MessageTemplate)
        .where(
            MessageTemplate.owner_role == "TUTOR",
            MessageTemplate.owner_id == owner.id,
        )
    )
    if (count or 0) >= _MAX_TEMPLATES_PER_OWNER:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "TEMPLATE_LIMIT",
            f"En fazla {_MAX_TEMPLATES_PER_OWNER} şablon kaydedebilirsin.",
        )
    template = MessageTemplate(
        owner_role="TUTOR",
        owner_id=owner.id,
        title=data.title.strip(),
        body=data.body.strip(),
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


async def delete_template(
    db: AsyncSession, owner: CurrentUser, template_id: int
) -> None:
    removed = await db.scalar(
        delete(MessageTemplate)
        .where(
            MessageTemplate.id == template_id,
            MessageTemplate.owner_role == "TUTOR",
            MessageTemplate.owner_id == owner.id,
        )
        .returning(MessageTemplate.id)
    )
    if removed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Şablon bulunamadı")


async def message_for_report(
    db: AsyncSession, user: CurrentUser, message_id: int
) -> Message:
    """Şikâyet edilecek mesajı yetkiyle getirir. Mesaj yoksa, kullanıcı sohbetin
    tarafı değilse ya da mesaj sistem mesajıysa aynı 404 döner (varlık sızmaz)."""
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, "Mesaj bulunamadı")
    if user.role_id not in _VALID_PARTY_ROLES:
        raise not_found
    msg = await db.get(Message, message_id)
    if msg is None or msg.sender_role == "SYSTEM":
        raise not_found
    conv = await db.get(Conversation, msg.conversation_id)
    if conv is None or not _is_party(conv, user):
        raise not_found
    my_role, _ = _party_of(user)
    if msg.sender_role == my_role:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Kendi mesajını şikâyet edemezsin."
        )
    return msg


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
    stage: Stage | None = None
    new_inquiry = False
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
    elif {sender_party[0], counterparty_role} == {"CLIENT", "TUTOR"}:
        await _validate_target(db, counterparty_role, counterparty_id)
        # Uygunluk gönderim anında değerlendirilir: engel, aşama ve ders öncesi
        # sınırlar (Modül 5).
        pair = {sender_party[0]: sender_party[1], counterparty_role: counterparty_id}
        stage, new_inquiry = await _assert_client_tutor_send(
            db, sender_party[0], client_id=pair["CLIENT"], tutor_id=pair["TUTOR"]
        )
    else:
        await _validate_target(db, counterparty_role, counterparty_id)
        if not await _can_message(db, sender_party, target_party):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Mesajlaşmak için aranızda beklemede veya onaylı bir rezervasyon olmalı.",
            )
    conv_id = await _conversation_id(db, sender_party, target_party)
    if new_inquiry:
        conv = await db.get(Conversation, conv_id)
        conv.inquiry_started_at = _now()

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

    # İletişim bilgisi her aşamada gizlenir; ders öncesi sohbette dış
    # bağlantılar da (sitenin kendi alan adı hariç).
    masked = mask_contact_info(body)
    if stage == "INQUIRY":
        masked = mask_external_links(masked, _site_hosts())
    message = Message(
        conversation_id=conv_id,
        sender_role=sender_party[0],
        sender_id=sender.id,
        body=masked,
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
        contact_masked=masked != body,
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
                select(Client.id, Client.first_name, Client.avatar_url).where(
                    Client.id.in_(by_type["CLIENT"])
                )
            )
        ).all():
            names[("CLIENT", cid)] = (fn, av)
    if by_type["TUTOR"]:
        for tid, fn, av in (
            await db.execute(
                select(Tutor.id, Tutor.first_name, Tutor.avatar_url).where(
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

    # CLIENT↔TUTOR aşaması ve engel durumu (toplu sorgular; Modül 5).
    pairs = {
        (c.client_id, c.tutor_id)
        for c in convs
        if c.client_id is not None and c.tutor_id is not None
    }
    lesson_pairs: set[tuple[int, int]] = set()
    blocked_pairs: set[tuple[int, int]] = set()
    if pairs:
        cids = {p[0] for p in pairs}
        tids = {p[1] for p in pairs}
        booking_rows = await db.execute(
            select(Booking.client_id, Booking.tutor_id)
            .where(
                Booking.client_id.in_(cids),
                Booking.tutor_id.in_(tids),
                Booking.status.in_(_DERS_ILISKISI),
                Booking.deleted_at.is_(None),
            )
            .distinct()
        )
        lesson_pairs.update((r[0], r[1]) for r in booking_rows.all())
        response_rows = await db.execute(
            select(Demand.client_id, DemandResponse.tutor_id)
            .join(Demand, Demand.id == DemandResponse.demand_id)
            .where(
                Demand.client_id.in_(cids),
                DemandResponse.tutor_id.in_(tids),
                Demand.deleted_at.is_(None),
                DemandResponse.deleted_at.is_(None),
            )
            .distinct()
        )
        lesson_pairs.update((r[0], r[1]) for r in response_rows.all())
        block_rows = await db.execute(
            select(TutorClientBlock.client_id, TutorClientBlock.tutor_id).where(
                TutorClientBlock.client_id.in_(cids),
                TutorClientBlock.tutor_id.in_(tids),
            )
        )
        blocked_pairs.update((r[0], r[1]) for r in block_rows.all())

    # Karşı taraf eğitmense ilan adresi (profil linki kök adrese gitsin — Modül 6).
    ilan_adresi = await seo_slug_service.ilan_sluglari(
        db,
        [o[1] for o in cp_for.values() if o and o[0] == "TUTOR"],
    )
    for c in convs:
        other = cp_for.get(c.id)
        nm = names.get(other) if other else None
        c.counterparty_url_slug = (
            ilan_adresi.get(other[1]) if other and other[0] == "TUTOR" else None
        )
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
        pair = (c.client_id, c.tutor_id)
        if pair in pairs:
            c.stage = "LESSON" if pair in lesson_pairs else "INQUIRY"
            c.blocked = pair in blocked_pairs
        else:
            c.stage = None
            c.blocked = False

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
    # Engel CLIENT↔TUTOR sohbetinde tepkiyi (ve WS itmesini) de kapatır.
    if (
        conv.client_id is not None
        and conv.tutor_id is not None
        and await is_blocked(db, tutor_id=conv.tutor_id, client_id=conv.client_id)
    ):
        my_role, _ = _party_of(user)
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "MESSAGE_BLOCKED",
            _MSG_BLOCKED_TUTOR if my_role == "TUTOR" else _MSG_BLOCKED_CLIENT,
        )

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
