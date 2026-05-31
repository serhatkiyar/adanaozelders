from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user
from core.database import get_db
from schemas.flashcard import (
    CardCreate,
    CardOut,
    CardUpdate,
    DeckCreate,
    DeckOut,
    DeckUpdate,
    ReviewIn,
)
from services import flashcard_service

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


# ── Desteler ─────────────────────────────────────────────────────
@router.get("/decks", response_model=list[DeckOut])
async def list_decks(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.list_decks(db, user)


@router.post("/decks", response_model=DeckOut, status_code=status.HTTP_201_CREATED)
async def create_deck(
    payload: DeckCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.create_deck(db, user, payload)


@router.patch("/decks/{deck_id}", response_model=DeckOut)
async def update_deck(
    deck_id: int,
    payload: DeckUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.update_deck(db, user, deck_id, payload)


@router.delete("/decks/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deck(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await flashcard_service.delete_deck(db, user, deck_id)


# ── Kartlar ──────────────────────────────────────────────────────
@router.get("/decks/{deck_id}/cards", response_model=list[CardOut])
async def list_cards(
    deck_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.list_cards(db, user, deck_id)


@router.post(
    "/decks/{deck_id}/cards",
    response_model=CardOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_card(
    deck_id: int,
    payload: CardCreate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.create_card(db, user, deck_id, payload)


@router.patch("/cards/{card_id}", response_model=CardOut)
async def update_card(
    card_id: int,
    payload: CardUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.update_card(db, user, card_id, payload)


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    card_id: int,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await flashcard_service.delete_card(db, user, card_id)


# ── Çalışma & tekrar ─────────────────────────────────────────────
@router.get("/decks/{deck_id}/study", response_model=list[CardOut])
async def study(
    deck_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.get_study_cards(db, user, deck_id, limit)


@router.post("/cards/{card_id}/review", response_model=CardOut)
async def review(
    card_id: int,
    payload: ReviewIn,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await flashcard_service.review_card(db, user, card_id, payload.rating)
