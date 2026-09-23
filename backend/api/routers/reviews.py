from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    require_roles,
    user_rate_limit,
)
from core.config import settings
from core.database import get_db
from models.client import Client
from models.review import Review
from models.role import RoleType
from schemas.review import (
    ReviewCreate,
    ReviewOut,
    ReviewUpdate,
    TutorRatingSummaryOut,
)
from services import review_service

router = APIRouter(prefix="/reviews", tags=["reviews"])

_create_limit = user_rate_limit(
    key="review_create",
    limit=settings.RATE_LIMIT_REVIEW,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


async def _get_review_or_404(db: AsyncSession, review_id: int) -> Review:
    review = await review_service.get_review(db, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    return review


def _assert_owner(review: Review, client: Client) -> None:
    if review.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your review")


@router.post(
    "",
    response_model=ReviewOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_create_limit)],
)
async def create_review(
    payload: ReviewCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    out = await review_service.create_review(db, client, payload)
    # get_db commit'i yanıttan SONRA çalışır; mutation sonrası anında gelen
    # refetch eski veriyi okumasın diye commit yanıttan önce (blog.py deseni).
    await db.commit()
    return out


@router.get("", response_model=list[ReviewOut])
async def list_reviews(
    tutor_id: int | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await review_service.list_reviews(
        db, tutor_id=tutor_id, limit=limit, offset=offset
    )


@router.get("/distribution", response_model=TutorRatingSummaryOut)
async def review_distribution(
    tutor_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    return await review_service.rating_distribution(db, tutor_id)


@router.get("/booking/{booking_id}", response_model=ReviewOut | None)
async def get_review_by_booking(
    booking_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    # Sahiplik kararı TEK ortak yardımcıda (İP-3 §5.3) — router kopyalamaz.
    await review_service.assert_booking_review_viewer(db, user, booking_id)
    return await review_service.get_by_booking(db, booking_id, viewer=user)


@router.get("/{review_id}", response_model=ReviewOut)
async def get_review(
    review_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    review = await _get_review_or_404(db, review_id)
    # Moderasyonla gizlenen yorum yalnız sahibine / admine görünür.
    if review.is_hidden and not review_service.yazari_gorebilir_mi(user, review):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    return await review_service.review_out(db, review, viewer=user)


@router.patch("/{review_id}", response_model=ReviewOut)
async def update_review(
    review_id: int,
    payload: ReviewUpdate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    review = await _get_review_or_404(db, review_id)
    _assert_owner(review, client)
    out = await review_service.update_review(db, review, payload, viewer=client)
    await db.commit()
    return out


@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_review(
    review_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    review = await _get_review_or_404(db, review_id)
    _assert_owner(review, client)
    await review_service.delete_review(db, review)
    await db.commit()
