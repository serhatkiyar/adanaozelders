from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_roles,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from models.admin import Admin
from models.client import Client
from models.role import RoleType
from schemas.library import (
    LibraryCreate,
    LibraryDetailOut,
    LibraryReviewCreate,
    LibraryReviewOut,
    LibrarySearchOut,
    LibraryUpdate,
)
from services import library_service

router = APIRouter(prefix="/libraries", tags=["libraries"])

_review_limit = user_rate_limit(
    key="library_review",
    limit=settings.RATE_LIMIT_REVIEW,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


# ── Public arama / liste ─────────────────────────────────────────────────────────


@router.get("", response_model=list[LibrarySearchOut])
async def search_libraries(
    q: str | None = Query(default=None, max_length=200),
    amenities: list[str] | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    sort: str | None = Query(default=None, pattern="^(rating|distance)$"),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Kütüphane kataloğu/haritası — public. ``lat``/``lng`` verilirse Haversine ile
    "yakınımdaki kütüphaneler"; ``sort=rating`` Bayesian sıralar."""
    return await library_service.search_libraries(
        db,
        q=q,
        amenities=amenities,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        sort=sort,
        limit=limit,
        offset=offset,
    )


# ── Admin küratör listesi (gizliler dahil) — /{id_or_slug}'tan ÖNCE tanımlanmalı ──


@router.get("/admin", response_model=list[LibrarySearchOut])
async def list_libraries_admin(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.list_libraries_admin(db, limit=limit, offset=offset)


@router.post("", response_model=LibraryDetailOut, status_code=status.HTTP_201_CREATED)
async def create_library(
    payload: LibraryCreate,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.create_library(db, admin, payload)


# ── Public detay ─────────────────────────────────────────────────────────────────


@router.get("/{id_or_slug}", response_model=LibraryDetailOut)
async def get_library(
    id_or_slug: str,
    db: AsyncSession = Depends(get_db),
):
    return await library_service.get_library_public(db, id_or_slug)


# ── Değerlendirme ────────────────────────────────────────────────────────────────


@router.get("/{library_id}/reviews", response_model=list[LibraryReviewOut])
async def list_library_reviews(
    library_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.list_reviews(
        db, library_id=library_id, limit=limit, offset=offset
    )


@router.post(
    "/{library_id}/reviews",
    response_model=LibraryReviewOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_review_limit)],
)
async def create_library_review(
    library_id: int,
    payload: LibraryReviewCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.create_review(db, client, library_id, payload)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_library_review(
    review_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await library_service.delete_review(db, client, review_id)


# ── Admin güncelle / sil ─────────────────────────────────────────────────────────


@router.patch("/{library_id}", response_model=LibraryDetailOut)
async def update_library(
    library_id: int,
    payload: LibraryUpdate,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.update_library(db, library_id, payload)


@router.delete("/{library_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_library(
    library_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await library_service.delete_library(db, library_id)
