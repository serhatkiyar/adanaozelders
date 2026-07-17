from __future__ import annotations

import datetime
import secrets
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.moderation import mask_contact_info
from core import storage
from models.booking import Booking, BookingStatus
from models.client import Client
from models.review import Review
from models.role import ROLE_IDS, RoleType, role_name
from models.tutor import Tutor, TutorAvailability, TutorStatus
from models.booking_resource import BookingResource
from models.booking_comment import BookingComment
from models.booking_private_note import BookingPrivateNote
from schemas.booking import BookingCreate, BookingResourceCreate, BookingCommentCreate, BookingLocationUpdate, BookingPrivateNoteCreate
from services import messaging_service, notification_service, payment_service
from core import ws_outbox

CurrentUser = "Admin | Tutor | Client"


def _notify_booking_update(db: AsyncSession, booking: Booking) -> None:
    """Rezervasyon durumu değiştiğinde her iki tarafın (eğitmen + öğrenci)
    rezervasyon listesi/detayı sayfa yenilemeden canlı tazelensin diye WS olayı
    kuyruğa alır. Commit sonrası gönderilir (bkz. core/ws_outbox)."""
    payload = {"type": "BOOKING_UPDATE", "booking_id": booking.id}
    ws_outbox.enqueue(
        db, payload, user_id=booking.tutor_id, role_id=ROLE_IDS[RoleType.TUTOR]
    )
    ws_outbox.enqueue(
        db, payload, user_id=booking.client_id, role_id=ROLE_IDS[RoleType.CLIENT]
    )


def _filter_private_notes(booking: Booking, *, role_id: int, user_id: int) -> None:
    """Booking üzerindeki özel notları yalnızca sahibi görebilsin diye in-place
    filtreler. Özel notlar gizlilik açısından karşı tarafa asla sızmamalı."""
    booking.private_notes = [
        n
        for n in booking.private_notes
        if n.owner_role == role_id and n.owner_id == user_id
    ]

_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.PENDING: {
        BookingStatus.ACCEPTED,
        BookingStatus.REJECTED,
        BookingStatus.CANCELLED,
    },
    BookingStatus.ACCEPTED: {BookingStatus.COMPLETED, BookingStatus.CANCELLED},
    BookingStatus.REJECTED: set(),
    BookingStatus.CANCELLED: set(),
    BookingStatus.COMPLETED: set(),
}


def _transition(booking: Booking, target: BookingStatus) -> None:
    if target not in _TRANSITIONS[booking.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {target.value}",
        )
    booking.status = target


async def _claim_transition(
    db: AsyncSession, booking: Booking, target: BookingStatus
) -> bool:
    """FSM geçişini DB'de atomik claim eder (koşullu UPDATE, tek kazanan).

    Para hareketi tetikleyen geçişlerde (COMPLETED→release, CANCELLED→refund)
    bellekteki ``_transition`` yeterli değildir: iki eşzamanlı istek (ya da arka
    plan döngüsü + manuel istek) aynı ACCEPTED'ı okuyup ikisi de geçiş yapabilir.
    True dönerse geçiş bu çağrıya aittir; False'ta kayıt yarışta kaybetmiştir.
    """
    allowed_from = [s for s, targets in _TRANSITIONS.items() if target in targets]
    result = await db.execute(
        update(Booking)
        .where(
            Booking.id == booking.id,
            Booking.status.in_(allowed_from),
            Booking.deleted_at.is_(None),
        )
        .values(status=target)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 1:
        booking.status = target
        return True
    await db.refresh(booking)
    return False


async def _assert_within_availability(
    db: AsyncSession,
    tutor_id: int,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> None:
    """Eğitmen müsaitlik penceresi tanımladıysa istenen saat bir pencereye sığmalı.
    Tanımlamamışsa kısıt yok (geriye dönük uyumlu). Sabit UTC+3 yerel saat."""
    availability = (
        await db.execute(
            select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)
        )
    ).scalars().all()
    if not availability:
        return
    tz = datetime.timezone(datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS))
    local_start = start_at.astimezone(tz)
    local_end = end_at.astimezone(tz)
    s_min = local_start.hour * 60 + local_start.minute
    e_min = local_end.hour * 60 + local_end.minute
    fits = local_start.date() == local_end.date() and any(
        w.weekday == local_start.weekday()
        and w.start_minute <= s_min
        and e_min <= w.end_minute
        for w in availability
    )
    if not fits:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Selected time is outside the tutor's availability",
        )


def _compute_price(
    tutor: Tutor,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> Decimal | None:
    """Ders ücretini SUNUCUDA hesaplar: eğitmen saatlik ücreti × süre (saat).

    Fiyat asla istemciden alınmaz (manipülasyon önlenir). Eğitmen ücreti
    tanımlamamışsa None döner. 2 ondalığa yuvarlanır.
    """
    if tutor.hourly_rate is None:
        return None
    delta = end_at - start_at
    seconds = Decimal(delta.days * 86400 + delta.seconds)
    hours = seconds / Decimal(3600)
    rate = Decimal(str(tutor.hourly_rate))
    return (rate * hours).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _is_eligible_for_free_lesson(
    db: AsyncSession, tutor_id: int, client_id: int
) -> bool:
    """Öğrenci bu eğitmenden ücretsiz ilk ders alabilir mi?

    Yalnızca daha önce bu eğitmenle (iptal/red dışı) hiç dersi yoksa uygundur.
    PENDING dahil sayılır; böylece arka arkaya ücretsiz talep oluşturulamaz.
    """
    stmt = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.tutor_id == tutor_id,
            Booking.client_id == client_id,
            Booking.deleted_at.is_(None),
            Booking.status.notin_(
                [BookingStatus.REJECTED, BookingStatus.CANCELLED]
            ),
        )
    )
    return int((await db.scalar(stmt)) or 0) == 0


async def create_booking(
    db: AsyncSession, client: Client, data: BookingCreate
) -> Booking:
    tutor = await db.get(Tutor, data.tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or not tutor.is_active
        or tutor.status != TutorStatus.APPROVED
    ):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Tutor not found or not available"
        )

    if data.start_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot book a time slot in the past"
        )

    await _assert_within_availability(db, tutor.id, data.start_at, data.end_at)

    # Ücretsiz ilk ders: eğitmen sunuyor + öğrencinin bu eğitmenle geçmiş dersi yok.
    is_free_lesson = False
    if data.free_lesson:
        if not tutor.first_lesson_free:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Bu eğitmen ücretsiz ilk ders sunmuyor",
            )
        if not await _is_eligible_for_free_lesson(db, tutor.id, client.id):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Ücretsiz ilk ders hakkın bu eğitmen için kullanılmış",
            )
        is_free_lesson = True

    # Ders biçimi: eğitmen tek mod sunuyorsa o sabittir; BOTH/None ise istemci seçer.
    requested = data.mode.value if data.mode else None
    if tutor.teaching_mode in ("ONLINE", "IN_PERSON"):
        if requested and requested != tutor.teaching_mode:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "This tutor does not offer the selected lesson mode",
            )
        mode = tutor.teaching_mode
    else:
        mode = requested or "ONLINE"

    price = (
        Decimal("0.00")
        if is_free_lesson
        else _compute_price(tutor, data.start_at, data.end_at)
    )
    booking = Booking(
        client_id=client.id,
        tutor_id=data.tutor_id,
        start_at=data.start_at,
        end_at=data.end_at,
        price=price,
        is_free_lesson=is_free_lesson,
        notes=data.notes,
        mode=mode,
        location=data.location,
        location_lat=data.location_lat,
        location_lng=data.location_lng,
    )
    db.add(booking)
    await db.flush()  # GiST exclusion violation surfaces here -> IntegrityError -> 409
    await db.refresh(booking)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"{client.full_name} yeni bir ders talebi gönderdi.",
        link="/tutor",
    )
    _notify_booking_update(db, booking)
    # Sohbete gömülü ders talebi kartı enjekte et (Airbnb tarzı)
    await messaging_service.inject_system_message(
        db,
        client_id=client.id,
        tutor_id=booking.tutor_id,
        msg_type="booking_card",
        body=f"{client.full_name} yeni bir ders talebi gönderdi.",
        meta_data={
            "booking_id": booking.id,
            "status": booking.status.value,
            "start_at": booking.start_at.isoformat(),
            "end_at": booking.end_at.isoformat(),
            "price": str(booking.price) if booking.price else None,
            "is_free_lesson": booking.is_free_lesson,
            "mode": booking.mode,
            "notes": booking.notes,
            "client_name": client.full_name,
        },
    )
    return await get_booking(db, booking.id, viewer=client)


async def count_completed(db: AsyncSession, *, role_id: int, user_id: int) -> int:
    column = (
        Booking.tutor_id
        if role_id == ROLE_IDS[RoleType.TUTOR]
        else Booking.client_id
    )
    stmt = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.status == BookingStatus.COMPLETED,
            Booking.deleted_at.is_(None),
            column == user_id,
        )
    )
    return int((await db.scalar(stmt)) or 0)


async def get_booking(
    db: AsyncSession, booking_id: int, *, viewer=None
) -> Booking | None:
    # Tutor/Client adı+avatarı ayrı db.get yerine tek sorguda join ile çekilir.
    stmt = (
        select(
            Booking,
            Tutor.full_name,
            Tutor.avatar_url,
            Client.full_name,
            Client.avatar_url,
        )
        .options(
            selectinload(Booking.resources),
            selectinload(Booking.comments),
        )
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.id == booking_id)
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    booking, tutor_name, tutor_avatar, client_name, client_avatar = row
    if booking.deleted_at is not None:
        return None
    booking.tutor_name = tutor_name
    booking.tutor_avatar_url = tutor_avatar
    booking.client_name = client_name
    booking.client_avatar_url = client_avatar
    review_id = await db.scalar(
        select(Review.id).where(
            Review.booking_id == booking.id, Review.deleted_at.is_(None)
        )
    )
    booking.reviewed = review_id is not None
    # Özel notlar yalnızca sahibine döner. viewer verilmezse (örn. dahili çağrı)
    # güvenli tarafta kalıp tüm notları gizleriz.
    if viewer is not None:
        _filter_private_notes(booking, role_id=viewer.role_id, user_id=viewer.id)
    else:
        booking.private_notes = []
    return booking


async def resolve_signal_target(
    db: AsyncSession,
    booking_id: int,
    sender_user_id: int,
    sender_role_id: int,
) -> tuple[int, int] | None:
    """WebRTC (P2P dosya aktarımı) sinyal relay'i için karşı tarafı çözer.

    Gönderen, booking'in katılımcısı (tutoru ya da clientı) ise karşı tarafın
    ``(user_id, role_id)`` ikilisini döndürür; aksi halde ``None`` (yetkisiz).
    Yalnız aktif (PENDING/ACCEPTED) derslerde relay yapılır.
    """
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.deleted_at is not None:
        return None
    if booking.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        return None
    tutor_role = ROLE_IDS[RoleType.TUTOR]
    client_role = ROLE_IDS[RoleType.CLIENT]
    if sender_role_id == tutor_role and booking.tutor_id == sender_user_id:
        return booking.client_id, client_role
    if sender_role_id == client_role and booking.client_id == sender_user_id:
        return booking.tutor_id, tutor_role
    return None


async def list_bookings(
    db: AsyncSession,
    *,
    role_id: int,
    user_id: int,
    status_filter: BookingStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Booking]:
    reviewed_col = (
        select(Review.id)
        .where(Review.booking_id == Booking.id, Review.deleted_at.is_(None))
        .exists()
        .label("reviewed")
    )
    stmt = (
        select(Booking, Tutor.full_name, Tutor.avatar_url, Client.full_name, Client.avatar_url, reviewed_col)
        .options(
            selectinload(Booking.resources),
            selectinload(Booking.comments)
        )
        .join(Tutor, Booking.tutor_id == Tutor.id)
        .join(Client, Booking.client_id == Client.id)
        .where(Booking.deleted_at.is_(None))
    )
    if role_id == ROLE_IDS[RoleType.CLIENT]:
        stmt = stmt.where(Booking.client_id == user_id)
    elif role_id == ROLE_IDS[RoleType.TUTOR]:
        stmt = stmt.where(Booking.tutor_id == user_id)
    else:
        return []
    if status_filter is not None:
        stmt = stmt.where(Booking.status == status_filter)
    stmt = stmt.order_by(Booking.start_at.desc()).limit(limit).offset(offset)

    bookings: list[Booking] = []
    for booking, tutor_name, tutor_avatar, client_name, client_avatar, reviewed in (await db.execute(stmt)).all():
        booking.tutor_name = tutor_name
        booking.tutor_avatar_url = tutor_avatar
        booking.client_name = client_name
        booking.client_avatar_url = client_avatar
        booking.reviewed = reviewed
        # Özel notlar yalnızca isteği yapan tarafa döner.
        _filter_private_notes(booking, role_id=role_id, user_id=user_id)
        bookings.append(booking)
    return bookings


async def accept(db: AsyncSession, booking: Booking) -> Booking:
    _transition(booking, BookingStatus.ACCEPTED)
    # Canlı ders odası yalnızca uzaktan (ONLINE) derslerde üretilir.
    if booking.mode != "IN_PERSON" and not booking.meeting_room:
        booking.meeting_room = f"adana-{booking.id}-{secrets.token_urlsafe(6)}"
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Rezervasyon talebin kabul edildi.",
        link="/student/bookings",
    )
    # Escrow ödeme kaydını oluştur (PENDING); öğrenci ödemeye yönlendirilir.
    await payment_service.create_for_booking(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def reject(db: AsyncSession, booking: Booking) -> Booking:
    _transition(booking, BookingStatus.REJECTED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Rezervasyon talebin reddedildi.",
        link="/student/bookings",
    )
    _notify_booking_update(db, booking)
    return booking


async def complete(db: AsyncSession, booking: Booking) -> Booking:
    if not await _claim_transition(db, booking, BookingStatus.COMPLETED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {BookingStatus.COMPLETED.value}",
        )
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message="Dersin tamamlandı. Değerlendirme yapabilir ve eğitmene soru sorabilirsin.",
        link="/student/bookings",
    )
    # Emanetteki ödemeyi (varsa) eğitmene serbest bırak.
    await payment_service.release(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def reschedule(
    db: AsyncSession,
    booking: Booking,
    *,
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> Booking:
    if booking.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only pending or accepted bookings can be rescheduled",
        )
    if start_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot reschedule to the past"
        )
    await _assert_within_availability(db, booking.tutor_id, start_at, end_at)
    booking.start_at = start_at
    booking.end_at = end_at
    # Süre değişmiş olabilir; ücreti güncel saatlik ücretle yeniden hesapla.
    tutor = await db.get(Tutor, booking.tutor_id)
    if tutor is not None:
        booking.price = _compute_price(tutor, start_at, end_at)
    # Mevcut ödemeyi yeni fiyata eşitle (PENDING) ya da HELD + fiyat değişimini
    # reddet (409) — Payment.amount ile booking.price sessizce ayrışamaz.
    await payment_service.sync_amount_with_booking(db, booking)
    # Yeni saat eğitmenin yeniden onayına sunulur; oda/hatırlatma sıfırlanır.
    booking.status = BookingStatus.PENDING
    booking.meeting_room = None
    booking.reminder_sent = False
    await db.flush()  # GiST çakışması -> 409 (global handler)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Bir rezervasyon yeni bir saate taşındı ve onayını bekliyor.",
        link="/tutor",
    )
    _notify_booking_update(db, booking)
    return booking


async def set_location(
    db: AsyncSession, booking: Booking, *, actor: "Client | Tutor", data: BookingLocationUpdate
) -> Booking:
    booking.location = data.location
    booking.location_lat = data.location_lat
    booking.location_lng = data.location_lng
    await db.flush()
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        rid, rrole, link = booking.tutor_id, ROLE_IDS[RoleType.TUTOR], "/tutor"
    else:
        rid, rrole, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    await notification_service.notify(
        db,
        user_id=rid,
        role_id=rrole,
        message="Yüzyüze ders için buluşma yeri güncellendi.",
        link=link,
    )
    _notify_booking_update(db, booking)
    return booking


async def send_due_reminders(db: AsyncSession) -> int:
    now = datetime.datetime.now(datetime.timezone.utc)
    soon = now + datetime.timedelta(hours=1)
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.deleted_at.is_(None),
                Booking.reminder_sent.is_(False),
                Booking.start_at > now,
                Booking.start_at <= soon,
            )
        )
    ).scalars().all()
    for b in rows:
        await notification_service.notify(
            db,
            user_id=b.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message="Dersin yaklaşıyor — yakında başlıyor.",
            link="/student/bookings",
        )
        await notification_service.notify(
            db,
            user_id=b.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Yaklaşan dersin var — yakında başlıyor.",
            link="/tutor",
        )
        b.reminder_sent = True
    return len(rows)


async def auto_complete_past_bookings(db: AsyncSession) -> int:
    """Bitişinden AUTO_COMPLETE_GRACE_HOURS saat geçmiş ama hâlâ ACCEPTED olan
    dersleri otomatik COMPLETED'a geçirir. Böylece eğitmen elle işaretlemese de
    öğrencinin değerlendirme ve soru (QA) hakkı açılır.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(hours=settings.AUTO_COMPLETE_GRACE_HOURS)
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.deleted_at.is_(None),
                Booking.end_at <= cutoff,
            )
        )
    ).scalars().all()
    count = 0
    for booking in rows:
        # Atomik claim: eşzamanlı bir manuel complete/cancel ile yarışırsa yalnız
        # biri kazanır (kaybeden para hareketi tetiklemez).
        if not await _claim_transition(db, booking, BookingStatus.COMPLETED):
            continue
        count += 1
        await notification_service.notify(
            db,
            user_id=booking.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message="Dersin tamamlandı. Değerlendirme yapabilir ve eğitmene soru sorabilirsin.",
            link="/student/bookings",
        )
        # Emanetteki ödemeyi de eğitmene serbest bırak (varsa).
        await payment_service.release(db, booking)
        _notify_booking_update(db, booking)
    return count


async def cancel(
    db: AsyncSession,
    booking: Booking,
    *,
    cancelled_by: "Client | Tutor",
    reason: str | None = None,
) -> Booking:
    if not await _claim_transition(db, booking, BookingStatus.CANCELLED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {booking.status.value} -> {BookingStatus.CANCELLED.value}",
        )
    if reason:
        booking.cancel_reason = reason
    await db.flush()

    # Karşı tarafı bilgilendir (iptal eden client ise tutor'a, tutor ise client'a).
    if cancelled_by.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            "/student/bookings",
        )
    message = f"{cancelled_by.full_name} bir rezervasyonu iptal etti."
    if reason:
        message += f" Neden: {reason}"
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=message,
        link=link,
    )
    # Emanette ödeme varsa öğrenciye iade et (yoksa no-op).
    await payment_service.refund(db, booking)
    _notify_booking_update(db, booking)
    return booking


async def add_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    data: BookingResourceCreate,
) -> Booking:
    resource = BookingResource(
        booking_id=booking.id,
        uploader_role=role_name(actor.role_id),
        uploader_id=actor.id,
        title=mask_contact_info(data.title),
        url=data.url,
    )
    db.add(resource)
    await db.flush()
    # Bildirim
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"Ders için yeni bir kaynak paylaşıldı: {data.title}",
        link=link,
    )
    return await get_booking(db, booking.id, viewer=actor)


async def delete_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    resource_id: int,
) -> Booking:
    stmt = select(BookingResource).where(BookingResource.id == resource_id, BookingResource.booking_id == booking.id)
    resource = await db.scalar(stmt)
    if not resource:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")

    actor_role_name = role_name(actor.role_id)
    if resource.uploader_id != actor.id or resource.uploader_role != actor_role_name:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your resource")

    # Yüklenmiş dosyaysa S3/MinIO objesini de sil (best-effort).
    if getattr(resource, "kind", "link") == "file" and resource.url:
        await storage.delete_file(resource.url)
    await db.delete(resource)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)


async def add_uploaded_resource(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    *,
    url: str,
    file_name: str,
    content_type: str | None,
    size_bytes: int,
) -> Booking:
    """Yüklenmiş bir dosyayı ders kaynağı olarak kaydeder (kind='file')."""
    resource = BookingResource(
        booking_id=booking.id,
        uploader_role=role_name(actor.role_id),
        uploader_id=actor.id,
        title=mask_contact_info(file_name),
        kind="file",
        url=url,
        file_name=file_name,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(resource)
    await db.flush()
    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id, ROLE_IDS[RoleType.TUTOR], "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id, ROLE_IDS[RoleType.CLIENT], f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"Ders için yeni bir dosya paylaşıldı: {file_name}",
        link=link,
    )
    return await get_booking(db, booking.id, viewer=actor)


async def add_comment(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    data: BookingCommentCreate,
) -> Booking:
    comment = BookingComment(
        booking_id=booking.id,
        sender_role=role_name(actor.role_id),
        sender_id=actor.id,
        body=mask_contact_info(data.body),
    )
    db.add(comment)
    await db.flush()

    if actor.role_id == ROLE_IDS[RoleType.CLIENT]:
        recipient_id, recipient_role, link = (
            booking.tutor_id,
            ROLE_IDS[RoleType.TUTOR],
            "/tutor",
        )
    else:
        recipient_id, recipient_role, link = (
            booking.client_id,
            ROLE_IDS[RoleType.CLIENT],
            f"/lesson/{booking.id}",
        )
    await notification_service.notify(
        db,
        user_id=recipient_id,
        role_id=recipient_role,
        message=f"{actor.full_name} ders detayına yeni bir not bıraktı.",
        link=link,
    )
    
    ws_outbox.enqueue(
        db,
        {"type": "NEW_BOOKING_COMMENT", "booking_id": booking.id},
        user_id=recipient_id,
        role_id=recipient_role,
    )

    return await get_booking(db, booking.id, viewer=actor)


async def delete_comment(
    db: AsyncSession,
    booking: Booking,
    actor: "Client | Tutor",
    comment_id: int,
) -> Booking:
    stmt = select(BookingComment).where(BookingComment.id == comment_id, BookingComment.booking_id == booking.id)
    comment = await db.scalar(stmt)
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")

    actor_role_name = role_name(actor.role_id)
    if comment.sender_id != actor.id or comment.sender_role != actor_role_name:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your comment")
    
    await db.delete(comment)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)

async def add_private_note(
    db: AsyncSession, booking: Booking, actor: "Client | Tutor", note_in: BookingPrivateNoteCreate
) -> Booking:
    note = BookingPrivateNote(
        booking_id=booking.id,
        owner_role=actor.role_id,
        owner_id=actor.id,
        body=note_in.body,
    )
    db.add(note)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)

async def delete_private_note(
    db: AsyncSession, booking: Booking, actor: "Client | Tutor", note_id: int
) -> Booking:
    # booking.private_notes get_booking tarafından zaten aktöre filtrelenmiştir;
    # başkasının notu bu listede olmadığı için "yok" sayılır (varlık ifşa edilmez).
    note = next((n for n in booking.private_notes if n.id == note_id), None)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Private note not found")
    if note.owner_role != actor.role_id or note.owner_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete someone else's note")

    await db.delete(note)
    await db.flush()
    return await get_booking(db, booking.id, viewer=actor)
