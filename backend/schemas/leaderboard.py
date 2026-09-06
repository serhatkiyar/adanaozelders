from __future__ import annotations

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    id: int
    name: str
    value: float


class LeaderboardOut(BaseModel):
    tutors_by_lessons: list[LeaderboardEntry]
    tutors_by_rating: list[LeaderboardEntry]
    uyeler_ders_sayisi: list[LeaderboardEntry]
    uyeler_net: list[LeaderboardEntry]
