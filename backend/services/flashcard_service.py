from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser
from models.flashcard import Flashcard, FlashcardDeck
from schemas.flashcard import (
    CardCreate,
    CardUpdate,
    DeckCreate,
    DeckUpdate,
    ReviewRating,
)

_MIN_EASE = 1.3
_MAX_EASE = 3.0
_DAY = 1440  # bir gün, dakika
_MAX_INTERVAL_MIN = 365 * _DAY


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ── Deck sahiplik ────────────────────────────────────────────────
async def _owned_deck_or_404(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> FlashcardDeck:
    deck = await db.get(FlashcardDeck, deck_id)
    if (
        deck is None
        or deck.deleted_at is not None
        or deck.user_id != user.id
        or deck.role_id != user.role_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deste bulunamadı")
    return deck


async def _owned_card_or_404(
    db: AsyncSession, user: CurrentUser, card_id: int
) -> Flashcard:
    card = await db.get(Flashcard, card_id)
    if card is None or card.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kart bulunamadı")
    await _owned_deck_or_404(db, user, card.deck_id)
    return card


# ── Desteler ─────────────────────────────────────────────────────
async def list_decks(db: AsyncSession, user: CurrentUser) -> list[FlashcardDeck]:
    now = _now()
    decks = list(
        (
            await db.execute(
                select(FlashcardDeck)
                .where(
                    FlashcardDeck.user_id == user.id,
                    FlashcardDeck.role_id == user.role_id,
                    FlashcardDeck.deleted_at.is_(None),
                )
                .order_by(FlashcardDeck.created_at.desc())
            )
        ).scalars().all()
    )
    if not decks:
        return decks
    ids = [d.id for d in decks]

    totals = dict(
        (
            await db.execute(
                select(Flashcard.deck_id, func.count())
                .where(Flashcard.deck_id.in_(ids), Flashcard.deleted_at.is_(None))
                .group_by(Flashcard.deck_id)
            )
        ).all()
    )
    dues = dict(
        (
            await db.execute(
                select(Flashcard.deck_id, func.count())
                .where(
                    Flashcard.deck_id.in_(ids),
                    Flashcard.deleted_at.is_(None),
                    Flashcard.due_at <= now,
                )
                .group_by(Flashcard.deck_id)
            )
        ).all()
    )
    for d in decks:
        d.card_count = int(totals.get(d.id, 0))
        d.due_count = int(dues.get(d.id, 0))
    return decks


async def create_deck(
    db: AsyncSession, user: CurrentUser, data: DeckCreate
) -> FlashcardDeck:
    deck = FlashcardDeck(
        user_id=user.id,
        role_id=user.role_id,
        name=data.name.strip(),
        description=(data.description or "").strip() or None,
    )
    db.add(deck)
    await db.flush()
    await db.refresh(deck)
    deck.card_count = 0
    deck.due_count = 0
    return deck


async def update_deck(
    db: AsyncSession, user: CurrentUser, deck_id: int, data: DeckUpdate
) -> FlashcardDeck:
    deck = await _owned_deck_or_404(db, user, deck_id)
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload and payload["name"]:
        deck.name = payload["name"].strip()
    if "description" in payload:
        deck.description = (payload["description"] or "").strip() or None
    await db.flush()
    return deck


async def delete_deck(db: AsyncSession, user: CurrentUser, deck_id: int) -> None:
    deck = await _owned_deck_or_404(db, user, deck_id)
    deck.deleted_at = _now()
    await db.flush()


# ── Kartlar ──────────────────────────────────────────────────────
async def list_cards(
    db: AsyncSession, user: CurrentUser, deck_id: int
) -> list[Flashcard]:
    await _owned_deck_or_404(db, user, deck_id)
    return list(
        (
            await db.execute(
                select(Flashcard)
                .where(Flashcard.deck_id == deck_id, Flashcard.deleted_at.is_(None))
                .order_by(Flashcard.created_at.desc())
            )
        ).scalars().all()
    )


async def create_card(
    db: AsyncSession, user: CurrentUser, deck_id: int, data: CardCreate
) -> Flashcard:
    await _owned_deck_or_404(db, user, deck_id)
    card = Flashcard(
        deck_id=deck_id,
        front=data.front.strip(),
        back=data.back.strip(),
        due_at=_now(),
    )
    db.add(card)
    await db.flush()
    await db.refresh(card)
    return card


async def update_card(
    db: AsyncSession, user: CurrentUser, card_id: int, data: CardUpdate
) -> Flashcard:
    card = await _owned_card_or_404(db, user, card_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("front"):
        card.front = payload["front"].strip()
    if payload.get("back"):
        card.back = payload["back"].strip()
    await db.flush()
    return card


async def delete_card(db: AsyncSession, user: CurrentUser, card_id: int) -> None:
    card = await _owned_card_or_404(db, user, card_id)
    card.deleted_at = _now()
    await db.flush()


# ── Çalışma & tekrar (SM-2) ──────────────────────────────────────
async def get_study_cards(
    db: AsyncSession, user: CurrentUser, deck_id: int, limit: int
) -> list[Flashcard]:
    await _owned_deck_or_404(db, user, deck_id)
    return list(
        (
            await db.execute(
                select(Flashcard)
                .where(
                    Flashcard.deck_id == deck_id,
                    Flashcard.deleted_at.is_(None),
                    Flashcard.due_at <= _now(),
                )
                .order_by(Flashcard.due_at.asc())
                .limit(limit)
            )
        ).scalars().all()
    )


def _apply_sm2(card: Flashcard, rating: ReviewRating) -> None:
    """SM-2 (Anki) varyantı, DAKİKA-bazlı öğrenme adımlarıyla:
      • Tekrar → 1 dk (üst üste basınca kısa kalır)
      • Zor    → öğrenmede 10 dk, olgunda aralık×1.2 (gün)
      • İyi    → 1 saat → (sonra) 1 gün → olgunda aralık×ease
      • Kolay  → 1 gün → olgunda aralık×ease×1.3
    """
    now = _now()
    ef = card.ease_factor
    iv = card.interval_minutes  # mevcut aralık (dk)

    if rating == ReviewRating.AGAIN:
        card.repetitions = 0
        card.interval_minutes = 1
        card.ease_factor = max(_MIN_EASE, ef - 0.20)
    elif rating == ReviewRating.HARD:
        if iv < _DAY:
            card.interval_minutes = 10  # öğrenme adımı
        else:
            days = max(1, round(iv / _DAY * 1.2))
            card.interval_minutes = days * _DAY
            card.ease_factor = max(_MIN_EASE, ef - 0.15)
        card.repetitions += 1
    elif rating == ReviewRating.GOOD:
        if iv < 60:
            card.interval_minutes = 60       # 1 saat
        elif iv < _DAY:
            card.interval_minutes = _DAY     # mezuniyet: 1 gün
        else:
            days = max(1, round(iv / _DAY * ef))
            card.interval_minutes = days * _DAY
        card.repetitions += 1
    else:  # EASY
        card.ease_factor = min(_MAX_EASE, ef + 0.15)
        if iv < _DAY:
            card.interval_minutes = _DAY     # 1 gün (varsayılan)
        else:
            days = max(1, round(iv / _DAY * card.ease_factor * 1.3))
            card.interval_minutes = days * _DAY
        card.repetitions += 1

    card.interval_minutes = min(card.interval_minutes, _MAX_INTERVAL_MIN)
    card.due_at = now + datetime.timedelta(minutes=card.interval_minutes)
    card.last_reviewed_at = now


async def review_card(
    db: AsyncSession, user: CurrentUser, card_id: int, rating: ReviewRating
) -> Flashcard:
    card = await _owned_card_or_404(db, user, card_id)
    _apply_sm2(card, rating)
    await db.flush()
    await db.refresh(card)
    return card
