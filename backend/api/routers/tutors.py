from __future__ import annotations

import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
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
from services import search_service, tutor_service

router = APIRouter(prefix="/tutors", tags=["tutors"])


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
    district: str | None = Query(default=None, max_length=80),
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
        district=district,
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
    district: str | None = Query(default=None, max_length=80),
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
        district=district,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
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
