"""Kütüphane (çalışma mekânı / etüt merkezi) iş mantığı.

Tutor arama servisinin kütüphanelere uyarlanmış kardeşi: pg_trgm + TSVECTOR
full-text, Haversine "yakınımdaki" mesafe filtresi ve Bayesian average sıralama.
Kütüphaneler admin küratörlüğünde yönetilir (self-servis onboarding yok).
"""

from __future__ import annotations

import datetime
import re
import unicodedata
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.admin import Admin
from models.client import Client
from core import storage
from models.library import (
    Library,
    LibraryAmenity,
    LibraryHours,
    LibraryImage,
    LibraryReview,
    LibraryStatus,
)
from models.library_exam import (
    ExamRegistration,
    LibraryExamSession,
    RegistrationStatus,
)
from models.study_reservation import StudyReservation
from schemas.library import (
    LibraryCreate,
    LibraryDetailOut,
    LibraryEarningsOut,
    LibraryHoursOut,
    LibraryImageOut,
    LibraryReviewCreate,
    LibraryReviewOut,
    LibrarySearchOut,
    LibraryUpdate,
)
from schemas.review import RatingDistributionOut
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


def _compose_address(
    street: str | None,
    building_no: str | None,
    neighborhood: str | None,
    district: str | None,
    city: str | None,
) -> str | None:
    """Yapısal alanlardan tam adres metni derler (location_text). Boş alanlar atlanır.
    Örn: 'Atatürk Cd No:5, Reşatbey, Çukurova, Adana'."""
    line1_parts = [p.strip() for p in (street, f"No:{building_no}" if building_no else None) if p and p.strip()]
    line1 = " ".join(line1_parts)
    parts = [line1, neighborhood, district, city]
    out = ", ".join(p.strip() for p in parts if p and p.strip())
    return out or None


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
        logo_url=lib.logo_url,
        location_text=lib.location_text,
        location_lat=float(lib.location_lat) if lib.location_lat is not None else None,
        location_lng=float(lib.location_lng) if lib.location_lng is not None else None,
        city=lib.city,
        district=lib.district,
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
        status=lib.status,
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
            selectinload(Library.images),
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
            selectinload(Library.images),
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
        # open_now açıkça aşağıda veriliyor → base dump'ından çıkar (çift argüman olmasın).
        **base.model_dump(exclude={"open_now", "status"}),
        phone=lib.phone,
        email=lib.email,
        website=lib.website,
        neighborhood=lib.neighborhood,
        street=lib.street,
        building_no=lib.building_no,
        status=lib.status,
        rejection_reason=lib.rejection_reason,
        created_at=lib.created_at,
        hours=[LibraryHoursOut.model_validate(h) for h in hours],
        images=[LibraryImageOut.model_validate(im) for im in lib.images],
        open_now=_is_open_now(hours),
    )


# ── Değerlendirme ────────────────────────────────────────────────────────────────


async def _verified_client_ids(db: AsyncSession, library_id: int) -> set[int]:
    """Bu kütüphanede ATTENDED (katılmış) deneme VEYA çalışma kaydı olan client'lar —
    'doğrulanmış ziyaretçi' rozeti için."""
    exam = (
        select(ExamRegistration.client_id)
        .join(LibraryExamSession, LibraryExamSession.id == ExamRegistration.session_id)
        .where(
            LibraryExamSession.library_id == library_id,
            ExamRegistration.status == RegistrationStatus.ATTENDED.value,
            ExamRegistration.deleted_at.is_(None),
        )
    )
    study = select(StudyReservation.client_id).where(
        StudyReservation.library_id == library_id,
        StudyReservation.status == RegistrationStatus.ATTENDED.value,
        StudyReservation.deleted_at.is_(None),
    )
    rows = (await db.execute(exam.union(study))).all()
    return {r[0] for r in rows}


async def _is_verified_visitor(db: AsyncSession, library_id: int, client_id: int) -> bool:
    return client_id in await _verified_client_ids(db, library_id)


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
    verified_ids = await _verified_client_ids(db, library_id)
    out: list[LibraryReviewOut] = []
    for review, client in rows:
        item = LibraryReviewOut.model_validate(review)
        item.client_name = client.full_name
        item.client_avatar_url = client.avatar_url
        item.verified = client.id in verified_ids
        out.append(item)
    return out


async def rating_distribution(
    db: AsyncSession, library_id: int
) -> RatingDistributionOut:
    """Kütüphanenin yıldız dağılımı. Yalnız ortalamaya sayılan (doğrulanmış
    ziyaretçi) değerlendirmeleri içerir — özet ortalama/sayı ile tutarlı kalır."""
    rows = (
        await db.execute(
            select(LibraryReview.rating, func.count())
            .where(
                LibraryReview.library_id == library_id,
                LibraryReview.deleted_at.is_(None),
                LibraryReview.counts_to_rating.is_(True),
            )
            .group_by(LibraryReview.rating)
        )
    ).all()
    counts = {star: 0 for star in range(1, 6)}
    total = 0
    weighted = 0
    for rating, count in rows:
        r, c = int(rating), int(count)
        counts[r] = c
        total += c
        weighted += r * c
    average = (weighted / total) if total else None
    return RatingDistributionOut(count=total, average=average, distribution=counts)


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

    # Karma puanlama: yorumu herkes yazabilir ama yıldız ortalaması/Bayesian sıralamaya
    # yalnız "doğrulanmış ziyaretçi" (ATTENDED deneme/çalışma kaydı) sayılır → sahte
    # puan şişirmesi etkisiz kalır. Doğrulanmamış yorum yazılır ama agregeyi etkilemez;
    # öğrenci sonradan katılırsa promote_reviews_for_visitor ile dahil edilir.
    counts = await _is_verified_visitor(db, library_id, client.id)
    review = LibraryReview(
        library_id=library_id,
        client_id=client.id,
        rating=payload.rating,
        comment_text=payload.comment_text,
        counts_to_rating=counts,
    )
    db.add(review)
    if counts:
        lib.rating_count += 1
        lib.rating_sum += payload.rating
    await db.commit()
    await db.refresh(review)

    item = LibraryReviewOut.model_validate(review)
    item.client_name = client.full_name
    item.client_avatar_url = client.avatar_url
    item.verified = counts
    return item


async def delete_review(db: AsyncSession, client: Client, review_id: int) -> None:
    review = await db.get(LibraryReview, review_id)
    if review is None or review.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Değerlendirme bulunamadı")
    if review.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizin değerlendirmeniz değil")
    lib = await db.get(Library, review.library_id)
    review.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    # Yalnız agregeye katılmış (doğrulanmış) yorumun silinmesi ortalamayı düşürür.
    if lib is not None and review.counts_to_rating:
        lib.rating_count = max(0, lib.rating_count - 1)
        lib.rating_sum = max(0, lib.rating_sum - review.rating)
    await db.commit()


async def promote_reviews_for_visitor(
    db: AsyncSession, library_id: int, client_id: int
) -> None:
    """Öğrenci bu kütüphanede ATTENDED oldu → daha önce yazdığı ama agregeye katılmamış
    (``counts_to_rating=False``) aktif yorumlarını artık yıldız ortalamasına/sıralamaya
    dahil et. Katılım doğrulama akışından best-effort çağrılır; idempotenttir."""
    reviews = (
        await db.execute(
            select(LibraryReview).where(
                LibraryReview.library_id == library_id,
                LibraryReview.client_id == client_id,
                LibraryReview.deleted_at.is_(None),
                LibraryReview.counts_to_rating.is_(False),
            )
        )
    ).scalars().all()
    if not reviews:
        return
    lib = await db.get(Library, library_id)
    for r in reviews:
        r.counts_to_rating = True
        if lib is not None:
            lib.rating_count += 1
            lib.rating_sum += r.rating
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
        logo_url=payload.logo_url,
        location_text=_compose_address(
            payload.street,
            payload.building_no,
            payload.neighborhood,
            payload.district,
            payload.city,
        ),
        location_lat=payload.location_lat,
        location_lng=payload.location_lng,
        city=payload.city,
        district=payload.district,
        neighborhood=payload.neighborhood,
        street=payload.street,
        building_no=payload.building_no,
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
    db: AsyncSession, lib_id: int, payload: LibraryUpdate, *, allow_identity: bool = True
) -> LibraryDetailOut:
    """``allow_identity=False`` (operatör) iken ad/slug ve görünürlük (status)
    değiştirilemez — bunlar admin küratörlüğünde kalır."""
    lib = await _load_full(db, lib_id)
    if lib is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if allow_identity and "name" in data and data["name"]:
        lib.name = data["name"]
        lib.slug = await _unique_slug(db, _slugify(data["name"]), exclude_id=lib.id)
    editable = [
        "description",
        "phone",
        "email",
        "website",
        "cover_url",
        "logo_url",
        "location_lat",
        "location_lng",
        "city",
        "district",
        "neighborhood",
        "street",
        "building_no",
        "capacity",
        "study_hourly_price",
    ]
    if allow_identity:
        editable.append("status")
    for field in editable:
        if field in data:
            setattr(lib, field, data[field])
    # En az bir DOLU yapısal adres alanı varsa tam adres metnini (location_text) yeniden
    # derle. Hepsi boşsa eski location_text'i KORU (eski kayıtların adresi silinmesin).
    if any(
        (data.get(k) or "").strip()
        for k in ("city", "district", "neighborhood", "street", "building_no")
    ):
        lib.location_text = _compose_address(
            lib.street, lib.building_no, lib.neighborhood, lib.district, lib.city
        )
    # Çocuk koleksiyonları (amenities/hours) yeniden kurulurken eski satırları ÖNCE
    # silip flush etmeliyiz: aksi halde SQLAlchemy yeni INSERT'leri orphan DELETE'lerden
    # önce gönderir ve aynı (library_id, weekday) / (library_id, amenity) için unique
    # ihlali (23505 → 409) oluşur.
    if "amenities" in data and data["amenities"] is not None:
        lib.amenity_links.clear()
        await db.flush()
        _apply_amenities(lib, data["amenities"])
    if "hours" in data and data["hours"] is not None:
        lib.hours.clear()
        await db.flush()
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
        # open_now açıkça aşağıda veriliyor → base dump'ından çıkar (çift argüman olmasın).
        **base.model_dump(exclude={"open_now", "status"}),
        phone=lib.phone,
        email=lib.email,
        website=lib.website,
        neighborhood=lib.neighborhood,
        street=lib.street,
        building_no=lib.building_no,
        status=lib.status,
        rejection_reason=lib.rejection_reason,
        created_at=lib.created_at,
        hours=[LibraryHoursOut.model_validate(h) for h in hours],
        images=[LibraryImageOut.model_validate(im) for im in lib.images],
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


# ── Görsel yönetimi (admin küratör; logo / banner / galeri) ──────────────────────


async def _require_lib(db: AsyncSession, lib_id: int) -> Library:
    lib = await db.get(Library, lib_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    return lib


async def set_logo(db: AsyncSession, lib_id: int, file_bytes: bytes) -> LibraryDetailOut:
    """Kurumsal logoyu (1:1 kare) yükler ve eskisini storage'dan temizler."""
    lib = await _require_lib(db, lib_id)
    old = lib.logo_url
    lib.logo_url = await storage.upload_library_photo(file_bytes, square=True)
    await db.commit()
    if old:
        await storage.delete_file(old)
    return await get_library_admin(db, lib_id)


async def set_cover(db: AsyncSession, lib_id: int, file_bytes: bytes) -> LibraryDetailOut:
    """Geniş kapak/banner (16:9) yükler ve eskisini storage'dan temizler."""
    lib = await _require_lib(db, lib_id)
    old = lib.cover_url
    lib.cover_url = await storage.upload_library_photo(file_bytes, square=False)
    await db.commit()
    if old:
        await storage.delete_file(old)
    return await get_library_admin(db, lib_id)


async def add_images(
    db: AsyncSession, lib_id: int, files: list[bytes], *, captions: list[str | None] | None = None
) -> LibraryDetailOut:
    """Galeriye bir veya daha fazla fotoğraf ekler (mevcut sıranın sonuna)."""
    await _require_lib(db, lib_id)
    start = (
        await db.execute(
            select(func.coalesce(func.max(LibraryImage.sort_order), -1) + 1).where(
                LibraryImage.library_id == lib_id
            )
        )
    ).scalar_one()
    for i, raw in enumerate(files):
        url = await storage.upload_library_photo(raw, square=False)
        cap = captions[i] if captions and i < len(captions) else None
        db.add(
            LibraryImage(
                library_id=lib_id, url=url, caption=cap, sort_order=start + i
            )
        )
    await db.commit()
    return await get_library_admin(db, lib_id)


async def delete_image(db: AsyncSession, lib_id: int, image_id: int) -> LibraryDetailOut:
    """Galeri fotoğrafını siler (kayıt + storage objesi)."""
    await _require_lib(db, lib_id)
    img = await db.get(LibraryImage, image_id)
    if img is None or img.library_id != lib_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Görsel bulunamadı")
    url = img.url
    await db.delete(img)
    await db.commit()
    if url:
        await storage.delete_file(url)
    return await get_library_admin(db, lib_id)


async def reorder_images(
    db: AsyncSession, lib_id: int, image_ids: list[int]
) -> LibraryDetailOut:
    """Galeri sırasını verilen id dizisine göre yeniden numaralar."""
    await _require_lib(db, lib_id)
    imgs = (
        await db.execute(
            select(LibraryImage).where(LibraryImage.library_id == lib_id)
        )
    ).scalars().all()
    by_id = {im.id: im for im in imgs}
    order = 0
    for iid in image_ids:
        im = by_id.get(iid)
        if im is not None:
            im.sort_order = order
            order += 1
    # Dizide olmayanlar (varsa) sona eklenir, stabil kalsın.
    for im in imgs:
        if im.id not in image_ids:
            im.sort_order = order
            order += 1
    await db.commit()
    return await get_library_admin(db, lib_id)


# ── Kazanç özeti (operatör/admin) ────────────────────────────────────────────────


async def earnings_summary(db: AsyncSession, library_id: int) -> LibraryEarningsOut:
    """Kütüphanenin escrow kazanç özeti — deneme oturumları + çalışma alanı birleşik.
    RELEASED = ``released_at`` dolu (katılım doğrulandı VEYA no-show sonrası serbest);
    HELD = ödenmiş ama henüz serbest değil (``status=PAID`` ve ``released_at`` NULL)."""
    await _require_lib(db, library_id)

    # Deneme — serbest bırakılmış (kazanç + komisyon + adet)
    exam_rel = (
        await db.execute(
            select(
                func.coalesce(func.sum(ExamRegistration.library_earning), 0),
                func.coalesce(func.sum(ExamRegistration.commission_amount), 0),
                func.count(),
            )
            .join(
                LibraryExamSession,
                LibraryExamSession.id == ExamRegistration.session_id,
            )
            .where(
                LibraryExamSession.library_id == library_id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.released_at.isnot(None),
            )
        )
    ).one()
    # Deneme — emanette (held)
    exam_held = (
        await db.execute(
            select(
                func.coalesce(func.sum(ExamRegistration.library_earning), 0),
                func.count(),
            )
            .join(
                LibraryExamSession,
                LibraryExamSession.id == ExamRegistration.session_id,
            )
            .where(
                LibraryExamSession.library_id == library_id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.status == RegistrationStatus.PAID.value,
                ExamRegistration.released_at.is_(None),
            )
        )
    ).one()
    # Çalışma alanı — serbest bırakılmış
    study_rel = (
        await db.execute(
            select(
                func.coalesce(func.sum(StudyReservation.library_earning), 0),
                func.coalesce(func.sum(StudyReservation.commission_amount), 0),
                func.count(),
            ).where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.released_at.isnot(None),
            )
        )
    ).one()
    # Çalışma alanı — emanette
    study_held = (
        await db.execute(
            select(
                func.coalesce(func.sum(StudyReservation.library_earning), 0),
                func.count(),
            ).where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status == RegistrationStatus.PAID.value,
                StudyReservation.released_at.is_(None),
            )
        )
    ).one()

    # Bu ay serbest bırakılan (deneme + çalışma)
    month_start = datetime.datetime.now(datetime.timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    exam_month = (
        await db.execute(
            select(func.coalesce(func.sum(ExamRegistration.library_earning), 0))
            .join(
                LibraryExamSession,
                LibraryExamSession.id == ExamRegistration.session_id,
            )
            .where(
                LibraryExamSession.library_id == library_id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.released_at >= month_start,
            )
        )
    ).scalar_one()
    study_month = (
        await db.execute(
            select(func.coalesce(func.sum(StudyReservation.library_earning), 0)).where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.released_at >= month_start,
            )
        )
    ).scalar_one()
    # İade edilen brüt tutar (deneme + çalışma)
    exam_refunded = (
        await db.execute(
            select(func.coalesce(func.sum(ExamRegistration.amount), 0))
            .join(
                LibraryExamSession,
                LibraryExamSession.id == ExamRegistration.session_id,
            )
            .where(
                LibraryExamSession.library_id == library_id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.status == RegistrationStatus.REFUNDED.value,
            )
        )
    ).scalar_one()
    study_refunded = (
        await db.execute(
            select(func.coalesce(func.sum(StudyReservation.amount), 0)).where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.status == RegistrationStatus.REFUNDED.value,
            )
        )
    ).scalar_one()

    def _d(v) -> Decimal:
        return Decimal(str(v)).quantize(Decimal("0.01"))

    released_earning = _d(exam_rel[0]) + _d(study_rel[0])
    commission_total = _d(exam_rel[1]) + _d(study_rel[1])
    held_earning = _d(exam_held[0]) + _d(study_held[0])

    return LibraryEarningsOut(
        currency=settings.PAYMENT_CURRENCY,
        released_earning=str(released_earning),
        held_earning=str(held_earning),
        commission_total=str(commission_total),
        released_count=int(exam_rel[2]) + int(study_rel[2]),
        held_count=int(exam_held[1]) + int(study_held[1]),
        this_month_earning=str(_d(exam_month) + _d(study_month)),
        refunded_total=str(_d(exam_refunded) + _d(study_refunded)),
    )


def normalize_escrow_status(
    *,
    status: str,
    released_at: datetime.datetime | None,
    refunded_at: datetime.datetime | None = None,
) -> str:
    """Gömülü escrow durumunu (deneme/çalışma) Payment sözlüğüne çevirir.

    Frontend tek rozet mantığı kullanabilsin diye RegistrationStatus →
    PENDING/HELD/RELEASED/REFUNDED eşlenir. ``released_at`` doluysa (katılım ya da
    no-show sonrası serbest) RELEASED önceliklidir. Saf fonksiyon — pytest'li.
    """
    if released_at is not None:
        return "RELEASED"
    if refunded_at is not None or status == RegistrationStatus.REFUNDED.value:
        return "REFUNDED"
    if status == RegistrationStatus.PAID.value:
        return "HELD"
    if status == RegistrationStatus.PENDING_PAYMENT.value:
        return "PENDING"
    if status == RegistrationStatus.CANCELLED.value:
        return "CANCELLED"
    return status


async def earnings_transactions(
    db: AsyncSession, library_id: int, *, limit: int = 200
) -> list[dict]:
    """Kütüphanenin escrow hareketleri (deneme + çalışma birleşik, en yeni önce).

    Yalnız ödemesi alınmış kayıtlar döner (``paid_at`` dolu) — emanette/serbest/iade;
    ödeme bekleyen (PENDING_PAYMENT) terk edilmiş kayıtlar listeyi kirletmesin.
    """
    await _require_lib(db, library_id)
    out: list[dict] = []

    exam_rows = (
        await db.execute(
            select(ExamRegistration, LibraryExamSession, Client)
            .join(
                LibraryExamSession,
                LibraryExamSession.id == ExamRegistration.session_id,
            )
            .join(Client, Client.id == ExamRegistration.client_id)
            .where(
                LibraryExamSession.library_id == library_id,
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.paid_at.isnot(None),
            )
            .order_by(ExamRegistration.created_at.desc())
            .limit(limit)
        )
    ).all()
    for reg, session, client in exam_rows:
        out.append(
            {
                "id": reg.id,
                "source": "EXAM",
                "title": session.title,
                "counterparty": client.full_name,
                "gross": Decimal(str(reg.amount)),
                "commission": Decimal(str(reg.commission_amount)),
                "net": Decimal(str(reg.library_earning)),
                "status": normalize_escrow_status(
                    status=reg.status,
                    released_at=reg.released_at,
                    refunded_at=reg.refunded_at,
                ),
                "currency": reg.currency,
                "occurred_at": reg.released_at or reg.paid_at or reg.created_at,
                "created_at": reg.created_at,
            }
        )

    study_rows = (
        await db.execute(
            select(StudyReservation, Client)
            .join(Client, Client.id == StudyReservation.client_id)
            .where(
                StudyReservation.library_id == library_id,
                StudyReservation.deleted_at.is_(None),
                StudyReservation.paid_at.isnot(None),
            )
            .order_by(StudyReservation.created_at.desc())
            .limit(limit)
        )
    ).all()
    for res, client in study_rows:
        out.append(
            {
                "id": res.id,
                "source": "STUDY",
                "title": "Çalışma alanı rezervasyonu",
                "counterparty": client.full_name,
                "gross": Decimal(str(res.amount)),
                "commission": Decimal(str(res.commission_amount)),
                "net": Decimal(str(res.library_earning)),
                "status": normalize_escrow_status(
                    status=res.status,
                    released_at=res.released_at,
                    refunded_at=res.refunded_at,
                ),
                "currency": res.currency,
                "occurred_at": res.released_at or res.paid_at or res.created_at,
                "created_at": res.created_at,
            }
        )

    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out[:limit]
