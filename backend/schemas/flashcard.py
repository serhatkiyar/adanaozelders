from __future__ import annotations

import datetime
import enum

from pydantic import BaseModel, ConfigDict, Field


class ReviewRating(str, enum.Enum):
    AGAIN = "again"  # Tekrar (bilemedim)
    HARD = "hard"    # Zor
    GOOD = "good"    # İyi
    EASY = "easy"    # Kolay


class DeckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class DeckUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    card_count: int = 0
    due_count: int = 0
    created_at: datetime.datetime


class CardCreate(BaseModel):
    front: str = Field(min_length=1, max_length=2000)
    back: str = Field(min_length=1, max_length=2000)


class CardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=2000)
    back: str | None = Field(default=None, min_length=1, max_length=2000)


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    front: str
    back: str
    interval_minutes: int
    repetitions: int
    ease_factor: float
    due_at: datetime.datetime
    last_reviewed_at: datetime.datetime | None = None


class ReviewIn(BaseModel):
    rating: ReviewRating
