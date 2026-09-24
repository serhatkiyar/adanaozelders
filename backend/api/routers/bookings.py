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
from core import canli_ders, centrifugo, ders_tahta, storage
from core.config import settings
from core.database import get_db
from models.booking import PAYMENT_CHANNEL_ESCROW, Booking, BookingStatus
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.booking import (
    LiveLessonTokenOut,
    TahtaDurumIn,
    TahtaDurumOut,
    TahtaTokenOut,
    ZoomDersTokenOut,
    BookingCancel,
    BookingCreate,
    BookingOffer,
    BookingIssueReport,
    BookingOut,
    BookingReschedule,
    BookingTutorReschedule,
    BookingResourceCreate,
    BookingCommentCreate,
    BookingLocationUpdate,
    BookingPrivateNoteCreate,
    LessonSeriesCreatedOut,
    LessonSeriesIn,
    LessonSeriesOut,
    LessonSeriesPreviewOut,
)
from services import (
    booking_service,
    lesson_series_service,
    livekit_service,
    payment_gates,
    phone_service,
    zoom_service,
)

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

# Canlı ders token'ı: ders penceresinde yeniden bağlanma birkaç token ister,
# ama döngüye girmiş bir istemci SFU'yu boğmasın.
_live_token_limit = user_rate_limit(
    key="live_token",
    limit=settings.RATE_LIMIT_LIVE_TOKEN,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# Tahta abonelik token'ı: Centrifugo token'ı her tazelemede (TTL
# `CENTRIFUGO_TOKEN_TTL_SECONDS`) ve her yeniden bağlanmada yeniden ister.
_tahta_token_limit = user_rate_limit(
    key="tahta_token",
    limit=settings.RATE_LIMIT_LIVE_TOKEN,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# Katılım penceresi `core/canli_ders.py` içinde (frontend `lesson.ts` ile eş).
# Token ömrü. Pencerenin tamamını kapsar, daha uzun değil: sızan bir token
# ders bittikten sonra işe yaramasın.
_LIVE_TOKEN_TTL_SECONDS = 60 * 60

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


# ── Haftalık ders serisi — `/{booking_id}` rotalarından ÖNCE ────────────────


@router.post("/series/preview", response_model=LessonSeriesPreviewOut)
async def preview_lesson_series(
    payload: LessonSeriesIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Salt okunur: hangi haftalar şimdi/sonra teklif olur, hangileri planlanamaz."""
    return await lesson_series_service.preview_series(
        db, tutor, payload, now=booking_service._utcnow()
    )


@router.post(
    "/series",
    response_model=LessonSeriesCreatedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_create_limit)],
)
async def create_lesson_series(
    payload: LessonSeriesIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await lesson_series_service.create_series(
        db, tutor, payload, now=booking_service._utcnow()
    )


@router.get("/series/{series_id}", response_model=LessonSeriesOut)
async def get_lesson_series(
    series_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await lesson_series_service.get_series(db, series_id, user)


@router.post("/series/{series_id}/end", response_model=LessonSeriesOut)
async def end_lesson_series(
    series_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Seriyi iki taraf da bitirebilir; bekleyen teklifler geri çekilir."""
    return await lesson_series_service.end_series(db, series_id, user)


@router.get("", response_model=list[BookingOut])
async def list_my_bookings(
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=_RANGE_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    # Takvim haftası (Modül 7): ikisi birlikte, en fazla 8 gün.
    start_from: datetime.datetime | None = Query(default=None),
    start_to: datetime.datetime | None = Query(default=None),
    # Eğitmenin Öğrenciler panelinde tek öğrencinin dersleri (yalnız TUTOR'da
    # anlamlı; zaten görülebilen kümeyi daraltır, yeni veri açmaz).
    client_id: int | None = Query(default=None, ge=1),
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
        client_id=client_id,
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


def _canli_ders_kapilari(booking: Booking, user: CurrentUser) -> datetime.datetime:
    """Canlı ders token uçlarının ORTAK kapıları; geçerse şimdiki anı döndürür.

    Kapılar SIRAYLA uygulanır; her biri bir öncekini geçmiş isteği varsayar.
    Sağlayıcıya özel kapılar (sağlayıcı seçimi, yapılandırma 503) çağıran
    uçta, bunlardan SONRA uygulanır.
    """
    # 1. Yalnız dersin iki tarafı (eğitmen/öğrenci). Admin dahil değil: canlı
    #    derse katılmak izleme değil, katılımcı olmaktır.
    _assert_party(booking, user)

    # 2. Ders onaylanmış olmalı; bekleyen/iptal/tamamlanmış derste oda yok.
    if booking.status != BookingStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ders onaylı değil; canlı oda açılmaz."
        )

    # 3. Yüzyüze derste canlı oda yoktur (bkz. booking_service: oda yalnız
    #    ONLINE derste kabul anında üretilir).
    if booking.mode == "IN_PERSON" or not booking.meeting_room:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu ders için canlı oda tanımlı değil."
        )

    # 4. ÖDEME KAPISI — kural tek kaynakta: `core/canli_ders.py::
    #    ders_odasi_acik_mi`. Şema (`BookingOut._gate_meeting_room`) aynı
    #    kuralla oda ADINI yanıttan siler; burası o adla token verilmesini
    #    engeller. Token uçları ORM'den okuduğu için şema kapısından GEÇMEZ;
    #    bu kapı atlanırsa öğrenci ödeme yapmadan canlı derse girer.
    payment_status = booking.payment.status if booking.payment is not None else None
    if not canli_ders.ders_odasi_acik_mi(
        payment_status, booking.price, payment_channel=booking.payment_channel
    ):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Ders ücreti emanete alınmadan canlı derse katılınamaz.",
        )

    # 5. Zaman penceresi: başlangıçtan 15 dk önce açılır, bitişten 30 dk sonra
    #    kapanır (arayüzdeki `isLessonJoinable` ile aynı sınırlar).
    now = datetime.datetime.now(datetime.timezone.utc)
    start = booking.start_at
    end = booking.end_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=datetime.timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=datetime.timezone.utc)
    if not (start - canli_ders.KATILIM_ACILIS <= now <= end + canli_ders.KATILIM_KAPANIS):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Canlı ders yalnız ders saatinde açıktır.",
        )
    return now


@router.get(
    "/{booking_id}/live-token",
    response_model=LiveLessonTokenOut,
    dependencies=[Depends(_live_token_limit)],
)
async def get_live_lesson_token(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Canlı ders (LiveKit) için kısa ömürlü erişim token'ı üretir.

    Kapı 1–5 ortak (`_canli_ders_kapilari`); 6. kapı LiveKit yapılandırması.
    """
    booking = await _get_booking_or_404(db, booking_id, user)
    now = _canli_ders_kapilari(booking, user)

    # 6. Özellik yapılandırılmamışsa sessizce bozuk bir token üretme.
    if not (
        settings.LIVEKIT_URL
        and settings.LIVEKIT_API_KEY
        and settings.LIVEKIT_API_SECRET
    ):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Canlı ders altyapısı yapılandırılmamış.",
        )

    tutor_mu = user.role_id == ROLE_IDS[RoleType.TUTOR]
    identity = f"{'t' if tutor_mu else 'c'}{user.id}"
    token = livekit_service.ders_token_uret(
        room=booking.meeting_room,
        identity=identity,
        name=getattr(user, "full_name", None) or identity,
        ttl_seconds=_LIVE_TOKEN_TTL_SECONDS,
    )
    return LiveLessonTokenOut(
        url=settings.LIVEKIT_URL,
        token=token,
        room=booking.meeting_room,
        identity=identity,
        expires_at=now + datetime.timedelta(seconds=_LIVE_TOKEN_TTL_SECONDS),
    )


@router.get(
    "/{booking_id}/zoom-token",
    response_model=ZoomDersTokenOut,
    dependencies=[Depends(_live_token_limit)],
)
async def get_zoom_lesson_token(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Canlı ders (Zoom Video SDK) için kısa ömürlü giriş JWT'si üretir.

    Kapı 1–5 ortak (`_canli_ders_kapilari`). Eğitmen host (role_type=1),
    öğrenci katılımcı (0). Oturum adı dersin `meeting_room`'udur; istemci
    oturum ya da kullanıcı adını kendisi seçmez.
    """
    booking = await _get_booking_or_404(db, booking_id, user)
    now = _canli_ders_kapilari(booking, user)

    # 6. Sunucu başka bir sağlayıcıya ayarlıysa Zoom oturumu açılmaz.
    if settings.CANLI_DERS_SAGLAYICI != "zoom":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Canlı ders bu sunucuda Zoom ile yapılmıyor.",
        )

    # 7. Özellik yapılandırılmamışsa sessizce bozuk bir token üretme.
    if not (settings.ZOOM_VIDEO_SDK_KEY and settings.ZOOM_VIDEO_SDK_SECRET):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Canlı ders altyapısı yapılandırılmamış.",
        )

    egitmen_mi = user.role_id == ROLE_IDS[RoleType.TUTOR]
    identity = f"{'t' if egitmen_mi else 'c'}{user.id}"
    # Ad üçüncü tarafa (Zoom) gider: soyadsız görünen ad yeterli (ÜK-9).
    kullanici_adi = (
        getattr(user, "display_name", None)
        or getattr(user, "full_name", None)
        or identity
    )
    token, expires_at = zoom_service.ders_token_uret(
        oturum=booking.meeting_room,
        egitmen_mi=egitmen_mi,
        ttl_seconds=_LIVE_TOKEN_TTL_SECONDS,
        now=now,
    )
    return ZoomDersTokenOut(
        token=token,
        oturum_adi=booking.meeting_room,
        kullanici_adi=kullanici_adi,
        rol="host" if egitmen_mi else "katilimci",
        expires_at=expires_at,
    )


def _tahta_servisi_acik() -> None:
    """Tahta eşitlemesi Centrifugo'ya bağlı; kapalıysa sessiz başarı yok."""
    if not settings.CENTRIFUGO_ENABLED:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gerçek-zamanlı servis kapalı"
        )


@router.get(
    "/{booking_id}/tahta-token",
    response_model=TahtaTokenOut,
    dependencies=[Depends(_tahta_token_limit)],
)
async def get_tahta_token(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Ders tahtası kanalı (`ders:{id}`) için kısa ömürlü abonelik JWT'si.

    Kapılar canlı ders token uçlarıyla AYNI (`_canli_ders_kapilari`): ders
    penceresi kapanınca tazeleme 409 alır ve abonelik biter. Token'ın `info`
    alanındaki rol, istemcinin kanala yayınladığı her mesaja Centrifugo
    tarafından eklenir; karşı taraf sayfa işlemlerini yalnız öğretmenden kabul
    eder. `tahta_acik` geç katılanın son durumu okumasıdır.
    """
    booking = await _get_booking_or_404(db, booking_id, user)
    _canli_ders_kapilari(booking, user)
    _tahta_servisi_acik()
    ogretmen = user.role_id == ROLE_IDS[RoleType.TUTOR]
    kanal = centrifugo.ders_kanali(booking.id)
    rol = "ogretmen" if ogretmen else "ogrenci"
    return TahtaTokenOut(
        token=centrifugo.make_subscription_token(
            user_id=user.id, role_id=user.role_id, channel=kanal, info={"rol": rol}
        ),
        kanal=kanal,
        ttl=settings.CENTRIFUGO_TOKEN_TTL_SECONDS,
        rol=rol,
        tahta_acik=await ders_tahta.acik_mi(booking.id),
    )


@router.put(
    "/{booking_id}/tahta",
    response_model=TahtaDurumOut,
    dependencies=[Depends(_tahta_token_limit)],
)
async def set_tahta_durumu(
    booking_id: int,
    payload: TahtaDurumIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Tahtayı açar/kapatır — YALNIZ dersin eğitmeni (Preply: öğrenci açamaz,
    kapatamaz). Durum saklanır ve kanala SUNUCUDAN yayınlanır; istemciler
    aç/kapa mesajını yalnız sunucu yayınından (istemci bilgisi taşımayan)
    kabul eder, böylece öğrenci kanala sahte "kapat" yazamaz.
    """
    booking = await _get_booking_or_404(db, booking_id, user)
    _canli_ders_kapilari(booking, user)
    if user.role_id != ROLE_IDS[RoleType.TUTOR]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Tahtayı yalnız eğitmen açıp kapatabilir."
        )
    _tahta_servisi_acik()
    await ders_tahta.yaz(booking.id, payload.acik)
    await centrifugo.broadcast(
        [centrifugo.ders_kanali(booking.id)], {"t": "tahta", "acik": payload.acik}
    )
    return TahtaDurumOut(acik=payload.acik)


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
    booking = await _get_booking_or_404(db, booking_id, user)
    _assert_yanit_verecek_taraf(booking, user)
    # Emanetli kabul öğrenciye ödeme yükümlülüğü doğurur; kol kapalıyken bu söz
    # verilemez. Kanal ilk kabulde sabitlenir (booking_service.accept): kol
    # kapalıyken ilk kez kabul edilen ders DIRECT olur ve ödeme kaydı açmaz.
    # Önceden ESCROW sabitlenmiş bir ders (ör. ertelendikten sonra yeniden
    # kabul) kol kapandıysa yine reddedilir.
    if booking.payment_channel == PAYMENT_CHANNEL_ESCROW:
        await payment_gates.assert_branch_open(
            db, payment_gates.PaymentBranch.TUTOR_MARKETPLACE
        )
    return await booking_service.accept(db, booking)


@router.post("/{booking_id}/withdraw", response_model=BookingOut)
async def withdraw_booking_offer(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Eğitmen yanıt bekleyen teklifini geri çeker (iptal sayılmaz)."""
    booking = await _get_booking_or_404(db, booking_id, tutor)
    return await booking_service.withdraw_offer(db, booking, tutor)


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


@router.post("/{booking_id}/tutor-reschedule", response_model=BookingOut)
async def tutor_reschedule_booking(
    booking_id: int,
    payload: BookingTutorReschedule,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Öğretmen onaylı dersi başka zamana alır; öğrenciye "uygun mu" sorulur."""
    booking = await _get_booking_or_404(db, booking_id, tutor)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.reschedule_by_tutor(db, booking, start_at=payload.start_at)


@router.post("/{booking_id}/tutor-reschedule/accept", response_model=BookingOut)
async def accept_tutor_reschedule(
    booking_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Öğrenci öğretmenin önerdiği yeni saati kabul eder."""
    booking = await _get_booking_or_404(db, booking_id, client)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.accept_tutor_reschedule(db, booking)


@router.post("/{booking_id}/tutor-reschedule/decline", response_model=BookingOut)
async def decline_tutor_reschedule(
    booking_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Öğrenci yeni saati kabul etmez: ders iptal, ücret her durumda iade."""
    booking = await _get_booking_or_404(db, booking_id, client)
    if booking.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your booking")
    return await booking_service.decline_tutor_reschedule(db, booking)


@router.post(
    "/{booking_id}/remind-confirm",
    response_model=BookingOut,
    dependencies=[Depends(_create_limit)],
)
async def remind_confirm_booking(
    booking_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Öğretmen öğrenciye "dersi onayla" hatırlatması gönderir (günde en fazla bir)."""
    booking = await _get_booking_or_404(db, booking_id, tutor)
    _assert_owner_tutor(booking, tutor)
    return await booking_service.remind_confirm(db, booking)


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
