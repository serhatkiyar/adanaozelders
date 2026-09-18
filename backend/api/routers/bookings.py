from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_roles,
    user_rate_limit,
)
from core import storage
from core.config import settings
from core.database import get_db
from models.booking import Booking, BookingStatus
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.booking import (
    BookingCancel,
    BookingCreate,
    BookingOffer,
    BookingIssueReport,
    BookingOut,
    BookingReschedule,
    BookingResourceCreate,
    BookingCommentCreate,
    BookingLocationUpdate,
    BookingPrivateNoteCreate,
)
from services import booking_service, payment_gates, phone_service

router = APIRouter(prefix="/bookings", tags=["bookings"])

_create_limit = user_rate_limit(
    key="booking_create",
    limit=settings.RATE_LIMIT_BOOKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
_upload_limit = user_rate_limit(
    key="resource_upload",
    limit=settings.RATE_LIMIT_BOOKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

_comment_limit = user_rate_limit(
    key="booking_comment",
    limit=settings.RATE_LIMIT_MESSAGE,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

_LIMIT_MAX = 100
# Tarih aralığı verildiğinde bir haftanın tüm dersleri tek istekte gelsin.
_RANGE_LIMIT_MAX = 300
_RANGE_MAX = datetime.timedelta(days=8)


async def _get_booking_or_404(
    db: AsyncSession, booking_id: int, viewer: CurrentUser
) -> Booking:
    # viewer, özel notların yalnızca sahibine dönmesi için servise iletilir.
    booking = await booking_service.get_booking(db, booking_id, viewer=viewer)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return booking


def _assert_owner_tutor(booking: Booking, tutor: Tutor) -> None:
    if booking.tutor_id != tutor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


def _assert_party(booking: Booking, user: CurrentUser) -> None:
    if user.role_id == ROLE_IDS[RoleType.CLIENT] and booking.client_id == user.id:
        return
    if user.role_id == ROLE_IDS[RoleType.TUTOR] and booking.tutor_id == user.id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")


@router.post(
    "",
    response_model=BookingOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_create_limit)],
)
async def create_booking(
    payload: BookingCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    phone_service.require_phone_verified(client)
    return await booking_service.create_booking(db, client, payload)


@router.post(
    "/offer",
    response_model=BookingOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_create_limit)],
)
async def offer_lesson(
    payload: BookingOffer,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Eğitmen kendi öğrencisine ders teklif eder; yanıtı öğrenci verir."""
    return await booking_service.offer_lesson(db, tutor, payload)


@router.get("", response_model=list[BookingOut])
async def list_my_bookings(
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=_RANGE_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    # Takvim haftası (Modül 7): ikisi birlikte, en fazla 8 gün.
    start_from: datetime.datetime | None = Query(default=None),
    start_to: datetime.datetime | None = Query(default=None),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if (start_from is None) != (start_to is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "start_from ve start_to birlikte verilmeli",
        )
    if start_from is not None and start_to is not None:
        if start_from.tzinfo is None or start_to.tzinfo is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "start_from ve start_to saat dilimi içermeli",
            )
        if start_to <= start_from or start_to - start_from > _RANGE_MAX:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Tarih aralığı en fazla 8 gün olabilir",
            )
    elif limit > _LIMIT_MAX:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"limit en fazla {_LIMIT_MAX} olabilir",
        )
    # Özel not filtrelemesi servis katmanında (list_bookings) yapılır.
    return await booking_service.list_bookings(
        db,
        role_id=user.role_id,
        user_id=user.id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
        start_from=start_from,
        start_to=start_to,
    )


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return booking


def _assert_yanit_verecek_taraf(booking: Booking, user: CurrentUser) -> None:
    """Bekleyen bir rezervasyonu KİM yanıtlar?

    Öğrencinin talebinde eğitmen, eğitmenin teklifinde öğrenci (Modül 8).
    Yanlış taraf çağırırsa 403 — teklifi eğitmen kendi kabul edip öğrenciye
    ödeme yükümlülüğü çıkaramaz.
    """
    _assert_party(booking, user)
    beklenen = (
        ROLE_IDS[RoleType.CLIENT]
        if booking.offered_by_tutor
        else ROLE_IDS[RoleType.TUTOR]
    )
    if user.role_id != beklenen:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Bu rezervasyonun yanıtı karşı tarafta.",
        )


@router.post("/{booking_id}/accept", response_model=BookingOut)
async def accept_booking(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    # Kabul, ogrenciye odenecek bir yukumluluk dogurur (PENDING escrow).
    # Kol kapaliyken kabul etmek, odenemeyecek bir ders sozu vermek olur.
    await payment_gates.assert_branch_open(
        db, payment_gates.PaymentBranch.TUTOR_MARKETPLACE
    )
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_yanit_verecek_taraf(booking, user)
    return await booking_service.accept(db, booking)


@router.post("/{booking_id}/reject", response_model=BookingOut)
async def reject_booking(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_yanit_verecek_taraf(booking, user)
    return await booking_service.reject(db, booking)


@router.post("/{booking_id}/complete", response_model=BookingOut)
async def complete_booking(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, tutor)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.complete(db, booking)


@router.post("/{booking_id}/confirm", response_model=BookingOut)
async def confirm_booking(
    booking_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Öğrenci dersin gerçekleştiğini onaylar; emanet eğitmene geçer."""
    booking = await _get_booking_or_404(db, booking_id, client)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.confirm_by_student(db, booking)


@router.post(
    "/{booking_id}/report-issue",
    response_model=BookingOut,
    dependencies=[Depends(_create_limit)],
)
async def report_booking_issue(
    booking_id: int,
    payload: BookingIssueReport,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Öğrenci ders sonrası sorun bildirir; para admin kararına kadar emanette kalır."""
    booking = await _get_booking_or_404(db, booking_id, client)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.report_issue(
        db, booking, reason=payload.reason, note=payload.note
    )


@router.post("/{booking_id}/cancel", response_model=BookingOut)
async def cancel_booking(
    booking_id: int,
    payload: BookingCancel | None = None,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.cancel(
        db, booking, cancelled_by=user, reason=payload.reason if payload else None
    )


@router.post("/{booking_id}/reschedule", response_model=BookingOut)
async def reschedule_booking(
    booking_id: int,
    payload: BookingReschedule,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, client)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.reschedule(
        db, booking, start_at=payload.start_at, end_at=payload.end_at
    )


@router.post("/{booking_id}/location", response_model=BookingOut)
async def set_booking_location(
    booking_id: int,
    payload: BookingLocationUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.set_location(
        db, booking, actor=user, data=payload
    )


@router.post("/{booking_id}/resources", response_model=BookingOut)
async def add_booking_resource(
    booking_id: int,
    payload: BookingResourceCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.add_resource(db, booking, actor=user, data=payload)


@router.delete("/{booking_id}/resources/{resource_id}", response_model=BookingOut)
async def delete_booking_resource(
    booking_id: int,
    resource_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.delete_resource(
        db, booking, actor=user, resource_id=resource_id
    )


@router.post(
    "/{booking_id}/resources/upload",
    response_model=BookingOut,
    dependencies=[Depends(_upload_limit)],
)
async def upload_booking_resource(
    booking_id: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    if not storage.is_allowed_resource(file.filename):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Desteklenmeyen dosya türü"
        )
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya")
    if len(data) > settings.MAX_RESOURCE_SIZE_BYTES:
        mb = settings.MAX_RESOURCE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Dosya çok büyük (en fazla {mb} MB)",
        )
    url = await storage.upload_file(
        data, original_name=file.filename, content_type=file.content_type
    )
    return await booking_service.add_uploaded_resource(
        db,
        booking,
        actor=user,
        url=url,
        file_name=file.filename or "dosya",
        content_type=file.content_type,
        size_bytes=len(data),
    )


@router.post(
    "/{booking_id}/comments",
    response_model=BookingOut,
    dependencies=[Depends(_comment_limit)],
)
async def add_booking_comment(
    booking_id: int,
    payload: BookingCommentCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.add_comment(db, booking, actor=user, data=payload)


@router.delete("/{booking_id}/comments/{comment_id}", response_model=BookingOut)
async def delete_booking_comment(
    booking_id: int,
    comment_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.delete_comment(db, booking, actor=user, comment_id=comment_id)

@router.post("/{booking_id}/private-notes", response_model=BookingOut)
async def add_booking_private_note(
    booking_id: int,
    payload: BookingPrivateNoteCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.add_private_note(db, booking, actor=user, note_in=payload)

@router.delete("/{booking_id}/private-notes/{note_id}", response_model=BookingOut)
async def delete_booking_private_note(
    booking_id: int,
    note_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_party(booking, user)
    return await booking_service.delete_private_note(db, booking, actor=user, note_id=note_id)
