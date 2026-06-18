from __future__ import annotations

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_roles,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from core.ratelimit import rate_limit
from core.security import create_access_token
from models.admin import Admin
from models.client import Client
from models.library import Library
from models.library_operator import LibraryOperator
from models.role import RoleType
from schemas.auth import Token
from schemas.payment import EarningTransaction
from schemas.payout import LibraryPayoutSubmitIn, PayoutOut
from schemas.review import RatingDistributionOut
from schemas.library import (
    LibraryCreate,
    LibraryDetailOut,
    LibraryEarningsOut,
    LibraryImagesReorder,
    LibraryRegister,
    LibraryRejectRequest,
    LibraryReviewCreate,
    LibraryReviewOut,
    LibrarySearchOut,
    LibraryUpdate,
)
from services import (
    library_onboarding_service,
    library_service,
    payout_service,
    refresh_token_service,
)

# Tek görsel için üst sınır (yüklemeden önce; optimize sonrası çok daha küçük olur).
_MAX_IMAGE_BYTES = 12 * 1024 * 1024


async def _read_image(file: UploadFile) -> bytes:
    """UploadFile'ı okur, image olduğunu ve boyutu doğrular (aksi halde 400)."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Yalnızca görsel dosyası yüklenebilir."
        )
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya.")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Görsel 12MB sınırını aşıyor."
        )
    return data

router = APIRouter(prefix="/libraries", tags=["libraries"])

_review_limit = user_rate_limit(
    key="library_review",
    limit=settings.RATE_LIMIT_REVIEW,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
# Self-servis kayıt IP bazlı rate-limit (kayıt/register ile aynı bütçe).
_register_limit = rate_limit(
    key="library_register",
    limit=settings.RATE_LIMIT_REGISTER,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


def _assert_can_manage_library(user: CurrentUser, library_id: int) -> None:
    """Profil/görsel yönetimi: admin her kütüphaneyi, operatör yalnız kendi
    kütüphanesini yönetebilir (deneme oturumlarındaki ``_assert_can_manage`` deseni)."""
    if isinstance(user, Admin):
        return
    if isinstance(user, LibraryOperator) and user.library_id == library_id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu kütüphanede yetkin yok")


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


# ── Self-servis onboarding ("kütüphaneni listele") — /{id_or_slug}'tan ÖNCE ──


@router.post(
    "/register",
    response_model=Token,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_library(
    payload: LibraryRegister, db: AsyncSession = Depends(get_db)
):
    """Public self-servis kayıt: operatör hesabı + PENDING kütüphane oluşturur ve
    oturumu açar (login deseniyle token döner). Kütüphane admin onayına dek public
    değildir; operatör panelinden profilini tamamlar."""
    operator = await library_onboarding_service.register(db, payload)
    token = create_access_token(
        subject=operator.id,
        role=RoleType.LIBRARY_OPERATOR.value,
        role_id=operator.role_id,
    )
    refresh = await refresh_token_service.issue(
        db, role_id=operator.role_id, user_id=operator.id
    )
    await db.commit()
    return Token(access_token=token, refresh_token=refresh)


@router.post("/{library_id}/approve", response_model=LibraryDetailOut)
async def approve_library(
    library_id: int,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Bekleyen self-servis başvuruyu onaylar → ACTIVE (public)."""
    return await library_onboarding_service.approve(db, admin, library_id)


@router.post("/{library_id}/reject", response_model=LibraryDetailOut)
async def reject_library(
    library_id: int,
    payload: LibraryRejectRequest,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Bekleyen başvuruyu reddeder → REJECTED + gerekçe (operatöre bildirilir)."""
    return await library_onboarding_service.reject(db, admin, library_id, payload.reason)


@router.post("/{library_id}/resubmit", response_model=LibraryDetailOut)
async def resubmit_library(
    library_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Operatör reddedilen başvurusunu düzeltip tekrar gönderir → PENDING (kuyruğa döner)."""
    _assert_can_manage_library(user, library_id)
    return await library_onboarding_service.resubmit(db, library_id)


# ── Admin küratör listesi (gizliler dahil) — /{id_or_slug}'tan ÖNCE tanımlanmalı ──


@router.get("/admin", response_model=list[LibrarySearchOut])
async def list_libraries_admin(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.list_libraries_admin(db, limit=limit, offset=offset)


@router.get("/admin/{library_id}", response_model=LibraryDetailOut)
async def get_library_admin_detail(
    library_id: int,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    """Düzenleme için tam detay — public uçtan farkı GİZLİ (HIDDEN) kütüphaneyi de
    döndürür. Admin her kütüphaneyi, operatör yalnız kendi kütüphanesini görür."""
    _assert_can_manage_library(user, library_id)
    return await library_service.get_library_admin(db, library_id)


@router.post("", response_model=LibraryDetailOut, status_code=status.HTTP_201_CREATED)
async def create_library(
    payload: LibraryCreate,
    admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    return await library_service.create_library(db, admin, payload)


# ── Payout (alt üye işyeri) — admin küratörlüğünde ───────────────────────────────


async def _get_library_or_404(db: AsyncSession, library_id: int) -> Library:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    return lib


@router.get("/admin/{library_id}/payout", response_model=PayoutOut)
async def get_library_payout(
    library_id: int,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    lib = await _get_library_or_404(db, library_id)
    return payout_service.to_out(lib)


@router.post("/admin/{library_id}/payout", response_model=PayoutOut)
async def submit_library_payout(
    library_id: int,
    payload: LibraryPayoutSubmitIn,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    """Kütüphanenin ödeme hesabını (IBAN + sorumlu kişi TCKN) kurar. Admin ya da
    kütüphanenin operatörü yapabilir (operatör yalnız kendi kütüphanesi için)."""
    _assert_can_manage_library(user, library_id)
    lib = await _get_library_or_404(db, library_id)
    return await payout_service.submit(
        db,
        lib,
        external_id=f"library:{library_id}",
        name=payload.contact_name,
        email=payload.contact_email,
        payload=payload,
    )


# ── Public detay ─────────────────────────────────────────────────────────────────


@router.get("/{id_or_slug}", response_model=LibraryDetailOut)
async def get_library(
    id_or_slug: str,
    db: AsyncSession = Depends(get_db),
):
    return await library_service.get_library_public(db, id_or_slug)


# ── Değerlendirme ────────────────────────────────────────────────────────────────


@router.get(
    "/{library_id}/reviews/distribution", response_model=RatingDistributionOut
)
async def library_review_distribution(
    library_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await library_service.rating_distribution(db, library_id)


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


# ── Kazanç özeti (admin / o kütüphanenin operatörü) ──────────────────────────────


@router.get("/{library_id}/earnings", response_model=LibraryEarningsOut)
async def library_earnings(
    library_id: int,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    """Kütüphane escrow kazanç özeti (serbest + emanette). Operatör yalnız kendi
    kütüphanesini görebilir."""
    if isinstance(user, LibraryOperator) and user.library_id != library_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu kütüphanede yetkin yok")
    return await library_service.earnings_summary(db, library_id)


@router.get(
    "/{library_id}/earnings/transactions", response_model=list[EarningTransaction]
)
async def library_earnings_transactions(
    library_id: int,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    """Kütüphane escrow hareketleri dökümü (deneme + çalışma). Operatör yalnız kendi
    kütüphanesini görebilir."""
    if isinstance(user, LibraryOperator) and user.library_id != library_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu kütüphanede yetkin yok")
    rows = await library_service.earnings_transactions(db, library_id)
    return [EarningTransaction(**r) for r in rows]


# ── Admin görsel yönetimi (logo / banner / galeri) ───────────────────────────────


@router.post("/{library_id}/logo", response_model=LibraryDetailOut)
async def upload_library_logo(
    library_id: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    return await library_service.set_logo(db, library_id, await _read_image(file))


@router.post("/{library_id}/cover", response_model=LibraryDetailOut)
async def upload_library_cover(
    library_id: int,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    return await library_service.set_cover(db, library_id, await _read_image(file))


@router.post("/{library_id}/images", response_model=LibraryDetailOut)
async def upload_library_images(
    library_id: int,
    files: list[UploadFile] = File(...),
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "En az bir görsel seçin.")
    blobs = [await _read_image(f) for f in files]
    return await library_service.add_images(db, library_id, blobs)


@router.patch("/{library_id}/images/reorder", response_model=LibraryDetailOut)
async def reorder_library_images(
    library_id: int,
    payload: LibraryImagesReorder,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    return await library_service.reorder_images(db, library_id, payload.image_ids)


@router.delete("/{library_id}/images/{image_id}", response_model=LibraryDetailOut)
async def delete_library_image(
    library_id: int,
    image_id: int,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    return await library_service.delete_image(db, library_id, image_id)


# ── Güncelle (admin / sahip operatör) / sil (yalnız admin) ───────────────────────


@router.patch("/{library_id}", response_model=LibraryDetailOut)
async def update_library(
    library_id: int,
    payload: LibraryUpdate,
    user: CurrentUser = Depends(
        require_roles(RoleType.ADMIN, RoleType.LIBRARY_OPERATOR)
    ),
    db: AsyncSession = Depends(get_db),
):
    _assert_can_manage_library(user, library_id)
    # Operatör ad/slug ve görünürlük (status) DEĞİŞTİREMEZ (kimlik + yayın admin'de).
    return await library_service.update_library(
        db, library_id, payload, allow_identity=isinstance(user, Admin)
    )


@router.delete("/{library_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_library(
    library_id: int,
    _admin: Admin = Depends(require_roles(RoleType.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    await library_service.delete_library(db, library_id)
