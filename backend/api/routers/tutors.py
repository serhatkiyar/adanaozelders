from __future__ import annotations

import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles, user_rate_limit
from core.config import settings
from core.database import get_db
from models.role import RoleType
from models.tutor import Gender, Tutor
from schemas.tutor import (
    TeachingMode,
    TutorOut,
    TutorProfileUpdate,
    TutorSearchOut,
    TutorSort,
)
from schemas.tutor_promotion import (
    PromotionPackageOut,
    TutorPromotionOut,
    TutorPromotionPurchaseIn,
    TutorPromotionPurchaseOut,
)
from services import search_service, tutor_promotion_service, tutor_service

router = APIRouter(prefix="/tutors", tags=["tutors"])

# Satın alma bir ödeme başlatır: mağaza/ders ödemeleriyle aynı bütçeye tabidir.
_promotion_limit = user_rate_limit(
    key="promotion_buy",
    limit=settings.RATE_LIMIT_PAYMENT,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


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


@router.get("/me", response_model=TutorOut)
async def read_my_profile(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    await tutor_service.attach_subjects(db, tutor)
    return await tutor_service.attach_availability(db, tutor)


@router.patch("/me", response_model=TutorOut)
async def update_my_profile(
    payload: TutorProfileUpdate,
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await tutor_service.update_profile(db, tutor, payload)


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


# Dinamik path; statik /me ve /search rotalarından SONRA tanımlanmalı.
# Herkese açık (login gerekmez) — kayıt öncesi keşif. Rezervasyon/mesaj yine login ister.
# Hem sayısal id ("42") hem de SEO slug'ı ("ahmet-yilmaz-42") kabul eder; her iki
# durumda da gerçek eğitmen sondaki id'den çözülür.
@router.get("/{tutor_id}", response_model=TutorSearchOut)
async def get_tutor(
    tutor_id: str,
    db: AsyncSession = Depends(get_db),
):
    match = re.search(r"(\d+)$", tutor_id)
    if not match:
        raise HTTPException(status_code=404, detail="Eğitmen bulunamadı.")
    return await search_service.get_tutor_public(db, int(match.group(1)))
