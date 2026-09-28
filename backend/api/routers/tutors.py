from __future__ import annotations

import datetime
import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles, user_rate_limit
from core.config import settings
from core.ratelimit import rate_limit
from core.database import get_db
from models.role import RoleType
from models.tutor import Gender, Tutor
from schemas.booking import LESSON_DURATIONS_MIN, SlotsOut
from schemas.tutor import (
    TeachingMode,
    TutorOut,
    TutorProfileUpdate,
    TutorSearchOut,
    TutorSort,
)
from schemas.tutor_video import (
    TutorIntroVideoOut,
    TutorIntroVideoStateOut,
    UploadInitIn,
    UploadInitOut,
)
from schemas.tutor_promotion import (
    PromotionPackageOut,
    TutorPromotionOut,
    TutorPromotionPurchaseIn,
    TutorPromotionPurchaseOut,
)
from schemas.time_off import (
    TimeOffCreatedOut,
    TimeOffIn,
    TimeOffOut,
    TimeOffPreviewIn,
    TimeOffPreviewOut,
)
from schemas.extra_availability import (
    ExtraAvailabilityCreatedOut,
    ExtraAvailabilityIn,
    ExtraAvailabilityOut,
)
from schemas.tutor_analytics import Period, SuccessGoalOut, TutorOverviewOut, TutorSeriesOut
from schemas.tutor_dashboard import TutorDashboardOut, TutorStudentOut
from services import (
    booking_service,
    extra_availability_service,
    search_service,
    time_off_service,
    tutor_analytics_service,
    tutor_dashboard_service,
    tutor_promotion_service,
    tutor_service,
    tutor_video_service,
)

router = APIRouter(prefix="/tutors", tags=["tutors"])

# Video yükleme başlatma: depoya yazma hakkı veren imzalı adres üretir → kullanıcı
# bazlı saatlik bütçe (kısmi unique zaten tek yolda videoya izin verir).
_video_upload_limit = user_rate_limit(
    key="tutor_video_upload",
    limit=settings.RATE_LIMIT_VIDEO_UPLOAD,
    window_seconds=3600,
)

# Video yükleme tamamlama: her çağrı depodaki nesneyi yoklar → kullanıcı bazlı
# dakikalık bütçe. İptal ucu yalnız siler, sınır almaz.
_VIDEO_COMPLETE_LIMIT_PER_MIN = 20
_video_complete_limit = user_rate_limit(
    key="tutor_video_complete",
    limit=_VIDEO_COMPLETE_LIMIT_PER_MIN,
    window_seconds=60,
)

# Satın alma bir ödeme başlatır: mağaza/ders ödemeleriyle aynı bütçeye tabidir.
_promotion_limit = user_rate_limit(
    key="promotion_buy",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
# İzin ekleme dersleri toplu iptal edip iade başlatabilir: ders yazma bütçesi.
_time_off_limit = user_rate_limit(
    key="time_off",
    limit=settings.RATE_LIMIT_BOOKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# Ek zaman aralığı yazma: ders yazma bütçesi (izinle aynı).
_extra_limit = user_rate_limit(
    key="extra_availability",
    limit=settings.RATE_LIMIT_BOOKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# Slot listesi anonim ve DB okur: IP bazlı okuma bütçesi.
_slots_limit = rate_limit(
    key="tutor_slots",
    limit=settings.RATE_LIMIT_TRACKING,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@router.get("/search", response_model=list[TutorSearchOut])
async def search_tutors(
    q: str | None = Query(default=None),
    min_rate: Decimal | None = Query(default=None, ge=0),
    max_rate: Decimal | None = Query(default=None, ge=0),
    mode: list[TeachingMode] | None = Query(default=None),
    gender: Gender | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    subject: list[str] | None = Query(default=None),
    district: list[str] | None = Query(default=None),
    # Sınav bağlamı (TYT/AYT/KPSS…): SERT FİLTRE DEĞİL — yalnız sıralama boost'u
    # (ilgili sınava odaklı eğitmenler üste çıkar; eşleşmeyen elenmez).
    exam: str | None = Query(default=None),
    sort: TutorSort | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    level_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await search_service.search_tutors(
        db,
        q=q,
        min_rate=min_rate,
        max_rate=max_rate,
        modes=[m.value for m in mode] if mode else None,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subject,
        districts=district,
        exam=exam,
        sort=sort,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        level_id=level_id,
        limit=limit,
        offset=offset,
    )


@router.get("/price-histogram", response_model=list[float])
async def tutor_price_histogram(
    q: str | None = Query(default=None),
    mode: list[TeachingMode] | None = Query(default=None),
    gender: Gender | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    subject: list[str] | None = Query(default=None),
    district: list[str] | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    level_id: int | None = Query(default=None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    # Fiyat aralığı filtresi histogramı için eşleşen eğitmenlerin saatlik ücret
    # dağılımı (fiyat filtresi HARİÇ aynı sert filtreler uygulanır).
    return await search_service.price_histogram(
        db,
        q=q,
        modes=[m.value for m in mode] if mode else None,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subject,
        districts=district,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        level_id=level_id,
    )


@router.get("/gender-facets", response_model=dict[str, int])
async def tutor_gender_facets(
    q: str | None = Query(default=None),
    mode: list[TeachingMode] | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    subject: list[str] | None = Query(default=None),
    district: list[str] | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    level_id: int | None = Query(default=None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Cinsiyet filtresinin seçenek başına kaç eğitmene denk geldiği.

    `gender` parametresi BİLEREK YOK: faset kendi eksenini saymaz (aynı desen
    `price-histogram`da da var). Dönen `gorunmeyen`, cinsiyet filtresi
    seçildiğinde sonuçtan düşen eğitmen sayısıdır — bu uç noktanın var oluş
    sebebi o sessiz elemeyi görünür kılmaktır.

    SATIR DEĞİL SAYI döner; kimlik sızdırmaz.
    """
    return await search_service.gender_facets(
        db,
        q=q,
        modes=[m.value for m in mode] if mode else None,
        min_age=min_age,
        max_age=max_age,
        subjects=subject,
        districts=district,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        level_id=level_id,
    )


@router.get("/featured", response_model=list[TutorSearchOut])
async def featured_tutors(
    q: str | None = Query(default=None),
    min_rate: Decimal | None = Query(default=None, ge=0),
    max_rate: Decimal | None = Query(default=None, ge=0),
    mode: list[TeachingMode] | None = Query(default=None),
    gender: Gender | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    subject: list[str] | None = Query(default=None),
    district: list[str] | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    level_id: int | None = Query(default=None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Ücretli öne çıkarma bloğu — arama ile AYNI sert filtreler, en fazla 3.

    Anonim erişilebilir (arama gibi). Sıralamayı DEĞİŞTİRMEZ: bu ayrı bir
    bloktur ve arayüzde "Reklam" etiketiyle çizilmek zorundadır.
    `exam` ve `sort` bilinçli olarak YOKTUR — ikisi de sıralama parametresidir,
    bu blokta sıralama satın alınmaz.
    """
    return await search_service.featured_tutors(
        db,
        q=q,
        min_rate=min_rate,
        max_rate=max_rate,
        modes=[m.value for m in mode] if mode else None,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subject,
        districts=district,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        level_id=level_id,
    )


@router.get("/promotion-packages", response_model=list[PromotionPackageOut])
async def promotion_packages():
    """Satın alınabilir paketler. Fiyatın tek kaynağı sunucudur."""
    return tutor_promotion_service.list_packages()


@router.get("/me/promotions", response_model=list[TutorPromotionOut])
async def my_promotions(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_promotion_service.list_for_tutor(db, tutor.id)


@router.post(
    "/me/promotions",
    response_model=TutorPromotionPurchaseOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_promotion_limit)],
)
async def buy_promotion(
    payload: TutorPromotionPurchaseIn,
    request: Request,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    promo, redirect_url = await tutor_promotion_service.purchase(
        db,
        tutor,
        days=payload.days,
        terms_accepted=payload.terms_accepted,
        client_ip=request.client.host if request.client else None,
    )
    return TutorPromotionPurchaseOut(
        promotion=TutorPromotionOut.model_validate(promo),
        redirect_url=redirect_url,
    )


@router.get("/me/dashboard", response_model=TutorDashboardOut)
async def read_my_dashboard(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Eğitmen panosu: sayılar, sıradaki/yaklaşan dersler, görünürlük nedenleri.

    Sahiplik sorguda sağlanır (yalnız `tutor.id`); dışarıdan kimlik almaz.
    ``/{tutor_id}`` rotasından ÖNCE tanımlı kalmalı.
    """
    return await tutor_dashboard_service.build_dashboard(
        db, tutor, now=datetime.datetime.now(datetime.timezone.utc)
    )


@router.get("/me/students", response_model=list[TutorStudentOut])
async def list_my_students(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Ders ilişkisi olan öğrenciler — ders teklifi ekranı ve Öğrenciler sayfası.

    ``/{tutor_id}`` rotasından ÖNCE tanımlı kalmalı.
    """
    return await booking_service.list_tutor_students(
        db, tutor, now=datetime.datetime.now(datetime.timezone.utc)
    )


# ── Takvim: izinler (Modül 7) — hepsi `/{tutor_id}`'den ÖNCE ─────────────────


@router.get("/me/time-off", response_model=list[TimeOffOut])
async def list_my_time_off(
    start: datetime.datetime = Query(...),
    end: datetime.datetime = Query(...),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "start ve end saat dilimi içermeli"
        )
    if end <= start or end - start > datetime.timedelta(
        days=time_off_service.MAX_LIST_DAYS
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Aralık en fazla {time_off_service.MAX_LIST_DAYS} gün olabilir.",
        )
    return await time_off_service.list_time_off(db, tutor, start=start, end=end)


@router.post("/me/time-off/preview", response_model=TimeOffPreviewOut)
async def preview_my_time_off(
    payload: TimeOffPreviewIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    """Salt okunur: izin eklenirse etkilenecek dersler ve engel durumu."""
    return await time_off_service.preview(
        db, tutor, start=payload.start_at, end=payload.end_at, now=_utcnow()
    )


@router.post(
    "/me/time-off",
    response_model=TimeOffCreatedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_time_off_limit)],
)
async def create_my_time_off(
    payload: TimeOffIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await time_off_service.create_time_off(
        db,
        tutor,
        start=payload.start_at,
        end=payload.end_at,
        title=payload.title,
        note=payload.note,
        now=_utcnow(),
    )


@router.delete("/me/time-off/{time_off_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_time_off(
    time_off_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await time_off_service.delete_time_off(db, tutor, time_off_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Takvim: ek zaman aralıkları — hepsi `/{tutor_id}`'den ÖNCE ────────────────


@router.get("/me/extra-availability", response_model=list[ExtraAvailabilityOut])
async def list_my_extra_availability(
    start: datetime.datetime = Query(...),
    end: datetime.datetime = Query(...),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "start ve end saat dilimi içermeli"
        )
    if end <= start or end - start > datetime.timedelta(
        days=extra_availability_service.MAX_LIST_DAYS
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Aralık en fazla {extra_availability_service.MAX_LIST_DAYS} gün olabilir.",
        )
    return await extra_availability_service.list_extra(db, tutor, start=start, end=end)


@router.post(
    "/me/extra-availability",
    response_model=ExtraAvailabilityCreatedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_extra_limit)],
)
async def create_my_extra_availability(
    payload: ExtraAvailabilityIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await extra_availability_service.create_extra(
        db, tutor, start=payload.start_at, end=payload.end_at, now=_utcnow()
    )


@router.delete(
    "/me/extra-availability/{extra_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_my_extra_availability(
    extra_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await extra_availability_service.delete_extra(db, tutor, extra_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Analizler (Modül 7) ─────────────────────────────────────────────────────


@router.get("/me/analytics/overview", response_model=TutorOverviewOut)
async def read_my_analytics_overview(
    period: Period = Query(default="month"),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_analytics_service.build_overview(
        db, tutor, period=period, now=_utcnow()
    )


@router.get("/me/analytics/goals", response_model=list[SuccessGoalOut])
async def read_my_analytics_goals(
    period: Period = Query(default="month"),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_analytics_service.build_goals(
        db, tutor, period=period, now=_utcnow()
    )


@router.get("/me/analytics/series", response_model=TutorSeriesOut)
async def read_my_analytics_series(
    period: Period = Query(default="month"),
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    points = await tutor_analytics_service.build_series(
        db, tutor, period=period, now=_utcnow()
    )
    return {"period": period, "points": points}


async def _with_intro_video(db: AsyncSession, tutor: Tutor) -> Tutor:
    """`TutorOut.intro_video` — eğitmenin kendi profilinde yayındaki yüklenmiş video."""
    tutor.intro_video = tutor_video_service.to_public_out(
        await tutor_video_service.get_active(db, tutor.id)
    )
    return tutor


@router.get("/me", response_model=TutorOut)
async def read_my_profile(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await tutor_service.attach_subjects(db, tutor)
    await tutor_service.attach_availability(db, tutor)
    return await _with_intro_video(db, tutor)


@router.patch("/me", response_model=TutorOut)
async def update_my_profile(
    payload: TutorProfileUpdate,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await tutor_service.update_profile(db, tutor, payload)
    return await _with_intro_video(db, tutor)


# ── Tanıtım videosu: doğrudan yükleme (tarayıcı → imzalı PUT → depo → worker) ──
#
# Bütün uçlar `/me` altındadır: satırlar oturumdaki eğitmenin `tutor_id`si ile
# aranır, anahtarlar sunucuda üretilir, istemci hiçbir istekte anahtar göndermez.


@router.get("/me/intro-video", response_model=TutorIntroVideoStateOut)
async def read_my_intro_video(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_video_service.get_state(db, tutor)


@router.post(
    "/me/intro-video/uploads",
    response_model=UploadInitOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_video_upload_limit)],
)
async def start_intro_video_upload(
    payload: UploadInitIn,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_video_service.init_upload(db, tutor, payload)


@router.post(
    "/me/intro-video/uploads/{video_id}/complete",
    response_model=TutorIntroVideoOut,
    dependencies=[Depends(_video_complete_limit)],
)
async def complete_intro_video_upload(
    video_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_video_service.complete_upload(db, tutor, video_id)


@router.delete("/me/intro-video/uploads/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_intro_video_upload(
    video_id: int,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await tutor_video_service.cancel_upload(db, tutor, video_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/intro-video", status_code=status.HTTP_204_NO_CONTENT)
async def remove_my_intro_video(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await tutor_video_service.remove_active(db, tutor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/me/submit", response_model=TutorOut)
async def submit_my_profile(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_service.submit_for_approval(db, tutor)


@router.post("/me/suspend", response_model=TutorOut)
async def suspend_my_listing(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_service.suspend(db, tutor)


@router.post("/me/activate", response_model=TutorOut)
async def activate_my_listing(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_service.activate(db, tutor)


_PG_INT_MAX = 2_147_483_647


def _tutor_id_coz(tutor_id: str) -> int:
    """Sayısal id ("42") ya da SEO slug'ı ("ahmet-yilmaz-42") → id."""
    match = re.search(r"(\d+)$", tutor_id)
    # Postgres INTEGER sınırını aşan ya da 0 olan id sorguya gitmez: taşan
    # değer asyncpg'de 500'e dönüşüyordu. Böyle bir eğitmen zaten yoktur.
    if not match or len(match.group(1)) > 10:
        raise HTTPException(status_code=404, detail="Öğretmen bulunamadı.")
    tutor_pk = int(match.group(1))
    if not 0 < tutor_pk <= _PG_INT_MAX:
        raise HTTPException(status_code=404, detail="Öğretmen bulunamadı.")
    return tutor_pk


@router.get(
    "/{tutor_id}/slots",
    response_model=SlotsOut,
    dependencies=[Depends(_slots_limit)],
)
async def get_tutor_slots(
    tutor_id: str,
    day_from: datetime.date | None = Query(default=None, alias="from"),
    days: int = Query(default=7, ge=1, le=7),
    duration: int = Query(default=60),
    db: AsyncSession = Depends(get_db),
):
    """Ders talep ızgarası (Modül 3) — anonim.

    Boş ve dolu slotlar, gün bölümleri, bildirim/pencere kuralları ve seçilen
    süre için sunucuda hesaplanmış fiyat. Kuralların kendisi `POST /bookings`
    içinde yeniden uygulanır; bu uç yalnız önceden gösterir.
    """
    if duration not in LESSON_DURATIONS_MIN:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ders süresi 30, 60, 90 ya da 120 dakika olmalı.",
        )
    tutor = await booking_service.get_bookable_tutor(db, _tutor_id_coz(tutor_id))
    now = _utcnow()
    if day_from is None:
        day_from = now.astimezone(
            datetime.timezone(datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS))
        ).date()
    return await booking_service.list_slots(
        db, tutor, day_from=day_from, days=days, duration_min=duration, now=now
    )


# Dinamik path; statik /me ve /search rotalarından SONRA tanımlanmalı.
# Herkese açık (login gerekmez) — kayıt öncesi keşif. Rezervasyon/mesaj yine login ister.
# Hem sayısal id ("42") hem de SEO slug'ı ("ahmet-yilmaz-42") kabul eder; her iki
# durumda da gerçek eğitmen sondaki id'den çözülür.
@router.get("/{tutor_id}", response_model=TutorSearchOut)
async def get_tutor(
    tutor_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await search_service.get_tutor_public(db, _tutor_id_coz(tutor_id))
