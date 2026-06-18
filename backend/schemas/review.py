from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewCreate(BaseModel):
    booking_id: int
    rating: int = Field(ge=1, le=5)
    comment_text: str | None = None


class ReviewUpdate(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    comment_text: str | None = None


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    booking_id: int
    client_id: int
    tutor_id: int
    rating: int
    comment_text: str | None = None
    tutor_reply: str | None = None
    created_at: datetime.datetime
    # Yorum geçmişinde göstermek için; list_reviews dışında None döner.
    client_name: str | None = None
    client_avatar_url: str | None = None


class TutorReply(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)


class RatingDistributionOut(BaseModel):
    """Yıldız puan dağılımı — özet başlık + 5→1 dağılım çubukları için.
    Eğitmen ve kütüphane değerlendirmelerinde ortak kullanılır."""

    count: int = 0
    average: float | None = None
    # Yıldız (1..5) → adet.
    distribution: dict[int, int] = Field(default_factory=dict)
