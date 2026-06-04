"""Kütüphane (çalışma mekânı / etüt merkezi) iş mantığı.

Tutor arama servisinin kütüphanelere uyarlanmış kardeşi: pg_trgm + TSVECTOR
full-text, Haversine "yakınımdaki" mesafe filtresi ve Bayesian average sıralama.
Kütüphaneler admin küratörlüğünde yönetilir (self-servis onboarding yok).
"""

from __future__ import annotations

import datetime
import re
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.admin import Admin
from models.client import Client
from models.library import (
    Library,
    LibraryAmenity,
    LibraryHours,
    LibraryReview,
    LibraryStatus,
)
from schemas.library import (
    LibraryCreate,
    LibraryDetailOut,
    LibraryHoursOut,
    LibraryReviewCreate,
    LibraryReviewOut,
    LibrarySearchOut,
    LibraryUpdate,
)
from services.ranking import bayesian_average

try:  # Türkiye yerel saati (açık/kapalı hesabı). Yoksa UTC'ye düşer.
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # noqa: BLE001
    _TZ = datetime.timezone(datetime.timedelta(hours=3))


# ── Yardımcılar ──────────────────────────────────────────────────────────────────


def _slugify(value: str) -> str:
    """Türkçe-güvenli slug ("Şehit Pilot Kütüphanesi" -> "sehit-pilot-kutuphanesi")."""
    table = str.maketrans("çğıİöşüÇĞÖŞÜ", "cgiiosucgosu")
    value = value.translate(table)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "kutuphane"


async def _unique_slug(db: AsyncSession, base: str, *, exclude_id: int | None = None) -> str:
    """Aktif kayıtlar arasında benzersiz slug üretir (gerekirse -2, -3 ekler)."""
    slug = base
    n = 1
    while True:
        stmt = select(Library.id).where(
            Library.slug == slug, Library.deleted_at.is_(None)
        )
        if exclude_id is not None:
            stmt = stmt.where(Library.id != exclude_id)
        if (await db.execute(stmt)).first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _haversine_km(lat: float, lng: float):
    """Library.location_lat/lng ile (lat,lng) arası km mesafe (Haversine).
    acos domain'ini [-1,1]'e clamp ederek float hatasından NaN'i önler."""
    cos_expr = (
        func.cos(func.radians(lat))
        * func.cos(func.radians(Library.location_lat))
        * func.cos(func.radians(Library.location_lng) - func.radians(lng))
        + func.sin(func.radians(lat)) * func.sin(func.radians(Library.location_lat))
    )
    clamped = func.greatest(-1.0, func.least(1.0, cos_expr))
    return 6371.0 * func.acos(clamped)


def _is_open_now(hours: list[LibraryHours]) -> bool | None:
    """Kütüphane yerel saatine (Europe/Istanbul) göre şu an açık mı.
    Çalışma saati tanımlı değilse None (bilinmiyor)."""
    if not hours:
        return None
    now = datetime.datetime.now(_TZ)
    weekday = now.weekday()
    minute = now.hour * 60 + now.minute
    for h in hours:
        if h.weekday == weekday:
            if h.is_closed or h.open_minute is None or h.close_minute is None:
                return False
            return h.open_minute <= minute < h.close_minute
    return None


async def _compute_global_mean(db: AsyncSession) -> float:
    stmt = select(
        func.coalesce(func.sum(Library.rating_sum), 0),
        func.coalesce(func.sum(Library.rating_count), 0),
    ).where(Library.deleted_at.is_(None))
    total_sum, total_count = (await db.execute(stmt)).one()
    if not total_count:
        return settings.BAYESIAN_PRIOR_MEAN
    return float(total_sum) / float(total_count)


def _bayesian_score_expr(prior_mean: float, confidence: float):
    return (
        (Library.rating_sum + confidence * prior_mean)
        / (cast(Library.rating_count, Float) + confidence)
    ).label("bayesian_score")


def _to_search_out(
    lib: Library,
    prior_mean: float,
    confidence: float,
    *,
    amenities: list[str],
    distance_km: float | None = None,
) -> LibrarySearchOut:
    return LibrarySearchOut(
        id=lib.id,
        name=lib.name,
        slug=lib.slug,
        description=lib.description,
        cover_url=lib.cover_url,
        location_text=lib.location_text,
        location_lat=float(lib.location_lat) if lib.location_lat is not None else None,
        location_lng=float(lib.location_lng) if lib.location_lng is not None else None,
        capacity=lib.capacity,
        study_hourly_price=(
            str(lib.study_hourly_price) if lib.study_hourly_price is not None else None
        ),
        amenities=amenities,
        rating_count=lib.rating_count,
        rating_average=(lib.rating_sum / lib.rating_count if lib.rating_count else None),
        bayesian_score=bayesian_average(
            lib.rating_sum, lib.rating_count, prior_mean, confidence
        ),
        distance_km=round(distance_km, 1) if distance_km is not None else None,
    )


# ── Public arama / detay ─────────────────────────────────────────────────────────


async def search_libraries(
    db: AsyncSession,
    *,
    q: str | None = None,
    amenities: list[str] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    sort: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[LibrarySearchOut]:
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    score = _bayesian_score_expr(prior_mean, confidence)

    geo = lat is not None and lng is not None
    distance_expr = _haversine_km(lat, lng) if geo else None

    base_cols = (Library, distance_expr.label("distance_km")) if geo else (Library,)
    stmt = (
        select(*base_cols)
        .options(
            selectinload(Library.amenity_links),
            selectinload(Library.hours),
        )
        .where(
            Library.status == LibraryStatus.ACTIVE.value,
            Library.deleted_at.is_(None),
        )
    )

    if geo:
        stmt = stmt.where(
            Library.location_lat.isnot(None), Library.location_lng.isnot(None)
        )
        if radius_km is not None:
            stmt = stmt.where(distance_expr <= radius_km)

    if amenities:
        wanted = [a.strip().lower() for a in amenities if a.strip()]
        for am in wanted:
            stmt = stmt.where(
                Library.id.in_(
                    select(LibraryAmenity.library_id).where(
                        LibraryAmenity.amenity == am
                    )
                )
            )

    relevance = None
    if q:
        tsquery = func.websearch_to_tsquery("simple", q)
        stmt = stmt.where(
            or_(
                Library.search_vector.op("@@")(tsquery),
                Library.name.op("%")(q),
            )
        )
        relevance = func.ts_rank(Library.search_vector, tsquery) + func.similarity(
            Library.name, q
        )

    if sort == "rating":
        stmt = stmt.order_by(score.desc(), Library.created_at.desc())
    elif geo:
        stmt = stmt.order_by(distance_expr.asc(), score.desc())
    elif relevance is not None:
        stmt = stmt.order_by(score.desc(), relevance.desc())
    else:
        stmt = stmt.order_by(score.desc(), Library.created_at.desc())

    stmt = stmt.limit(limit).offset(offset)

    rows = (await db.execute(stmt)).all()
    results: list[LibrarySearchOut] = []
    for row in rows:
        lib = row[0]
        distance = row[1] if geo else None
        out = _to_search_out(
            lib,
            prior_mean,
            confidence,
            amenities=sorted(link.amenity for link in lib.amenity_links),
            distance_km=float(distance) if distance is not None else None,
        )
        out.open_now = _is_open_now(list(lib.hours))
        results.append(out)
    return results


async def _load_full(db: AsyncSession, lib_id: int) -> Library | None:
    stmt = (
        select(Library)
        .options(
            selectinload(Library.amenity_links),
            selectinload(Library.hours),
        )
        .where(Library.id == lib_id, Library.deleted_at.is_(None))
    )
    return (await db.execute(stmt)).scalars().first()


async def get_library_public(db: AsyncSession, id_or_slug: str) -> LibraryDetailOut:
    stmt = (
        select(Library)
        .options(
            selectinload(Library.amenity_links),
            selectinload(Library.hours),
        )
        .where(Library.deleted_at.is_(None), Library.status == LibraryStatus.ACTIVE.value)
    )
    if id_or_slug.isdigit():
        stmt = stmt.where(Library.id == int(id_or_slug))
    else:
        stmt = stmt.where(Library.slug == id_or_slug)
    lib = (await db.execute(stmt)).scalars().first()
    if lib is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")

    prior_mean = await _compute_global_mean(db)
    base = _to_search_out(
        lib,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        amenities=sorted(link.amenity for link in lib.amenity_links),
    )
    hours = sorted(lib.hours, key=lambda h: h.weekday)
    return LibraryDetailOut(
        **base.model_dump(),
        phone=lib.phone,
        email=lib.email,
        website=lib.website,
        status=lib.status,
        created_at=lib.created_at,
        hours=[LibraryHoursOut.model_validate(h) for h in hours],
        open_now=_is_open_now(hours),
    )


# ── Değerlendirme ────────────────────────────────────────────────────────────────


async def list_reviews(
    db: AsyncSession, *, library_id: int, limit: int = 20, offset: int = 0
) -> list[LibraryReviewOut]:
    stmt = (
        select(LibraryReview, Client)
        .join(Client, Client.id == LibraryReview.client_id)
        .where(
            LibraryReview.library_id == library_id,
            LibraryReview.deleted_at.is_(None),
        )
        .order_by(LibraryReview.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).all()
    out: list[LibraryReviewOut] = []
    for review, client in rows:
        item = LibraryReviewOut.model_validate(review)
        item.client_name = client.full_name
        item.client_avatar_url = client.avatar_url
        out.append(item)
    return out


async def create_review(
    db: AsyncSession, client: Client, library_id: int, payload: LibraryReviewCreate
) -> LibraryReviewOut:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")

    existing = (
        await db.execute(
            select(LibraryReview).where(
                LibraryReview.library_id == library_id,
                LibraryReview.client_id == client.id,
                LibraryReview.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu kütüphaneyi zaten değerlendirdiniz"
        )

    review = LibraryReview(
        library_id=library_id,
        client_id=client.id,
        rating=payload.rating,
        comment_text=payload.comment_text,
    )
    db.add(review)
    lib.rating_count += 1
    lib.rating_sum += payload.rating
    await db.commit()
    await db.refresh(review)

    item = LibraryReviewOut.model_validate(review)
    item.client_name = client.full_name
    item.client_avatar_url = client.avatar_url
    return item


async def delete_review(db: AsyncSession, client: Client, review_id: int) -> None:
    review = await db.get(LibraryReview, review_id)
    if review is None or review.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Değerlendirme bulunamadı")
    if review.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin değerlendirmeniz değil")
    lib = await db.get(Library, review.library_id)
    review.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    if lib is not None:
        lib.rating_count = max(0, lib.rating_count - 1)
        lib.rating_sum = max(0, lib.rating_sum - review.rating)
    await db.commit()


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


def _apply_amenities(lib: Library, amenities: list[str]) -> None:
    lib.amenity_links = [LibraryAmenity(amenity=a) for a in amenities]


def _apply_hours(lib: Library, hours: list) -> None:
    lib.hours = [
        LibraryHours(
            weekday=h.weekday,
            is_closed=h.is_closed,
            open_minute=None if h.is_closed else h.open_minute,
            close_minute=None if h.is_closed else h.close_minute,
        )
        for h in hours
    ]


async def create_library(
    db: AsyncSession, admin: Admin, payload: LibraryCreate
) -> LibraryDetailOut:
    slug = await _unique_slug(db, _slugify(payload.name))
    lib = Library(
        name=payload.name,
        slug=slug,
        description=payload.description,
        phone=payload.phone,
        email=payload.email,
        website=payload.website,
        cover_url=payload.cover_url,
        location_text=payload.location_text,
        location_lat=payload.location_lat,
        location_lng=payload.location_lng,
        capacity=payload.capacity,
        study_hourly_price=payload.study_hourly_price,
        status=payload.status,
        created_by_admin_id=admin.id,
    )
    _apply_amenities(lib, payload.amenities)
    _apply_hours(lib, payload.hours)
    db.add(lib)
    await db.commit()
    return await get_library_admin(db, lib.id)


async def update_library(
    db: AsyncSession, lib_id: int, payload: LibraryUpdate
) -> LibraryDetailOut:
    lib = await _load_full(db, lib_id)
    if lib is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        lib.name = data["name"]
        lib.slug = await _unique_slug(db, _slugify(data["name"]), exclude_id=lib.id)
    for field in (
        "description",
        "phone",
        "email",
        "website",
        "cover_url",
        "location_text",
        "location_lat",
        "location_lng",
        "capacity",
        "study_hourly_price",
        "status",
    ):
        if field in data:
            setattr(lib, field, data[field])
    if "amenities" in data and data["amenities"] is not None:
        _apply_amenities(lib, data["amenities"])
    if "hours" in data and data["hours"] is not None:
        _apply_hours(lib, payload.hours or [])

    await db.commit()
    return await get_library_admin(db, lib.id)


async def delete_library(db: AsyncSession, lib_id: int) -> None:
    lib = await db.get(Library, lib_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    lib.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()


async def get_library_admin(db: AsyncSession, lib_id: int) -> LibraryDetailOut:
    lib = await _load_full(db, lib_id)
    if lib is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    prior_mean = await _compute_global_mean(db)
    base = _to_search_out(
        lib,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        amenities=sorted(link.amenity for link in lib.amenity_links),
    )
    hours = sorted(lib.hours, key=lambda h: h.weekday)
    return LibraryDetailOut(
        **base.model_dump(),
        phone=lib.phone,
        email=lib.email,
        website=lib.website,
        status=lib.status,
        created_at=lib.created_at,
        hours=[LibraryHoursOut.model_validate(h) for h in hours],
        open_now=_is_open_now(hours),
    )


async def list_libraries_admin(
    db: AsyncSession, *, limit: int = 100, offset: int = 0
) -> list[LibrarySearchOut]:
    """Admin listesi — gizli (HIDDEN) kayıtlar dahil."""
    prior_mean = await _compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    stmt = (
        select(Library)
        .options(
            selectinload(Library.amenity_links),
            selectinload(Library.hours),
        )
        .where(Library.deleted_at.is_(None))
        .order_by(Library.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    libs = (await db.execute(stmt)).scalars().all()
    out: list[LibrarySearchOut] = []
    for lib in libs:
        item = _to_search_out(
            lib,
            prior_mean,
            confidence,
            amenities=sorted(link.amenity for link in lib.amenity_links),
        )
        item.open_now = _is_open_now(list(lib.hours))
        out.append(item)
    return out
