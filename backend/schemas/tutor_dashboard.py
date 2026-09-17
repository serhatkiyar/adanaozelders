from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel

from schemas.booking import BookingOut

VisibilityCode = Literal[
    "DRAFT",
    "PENDING_APPROVAL",
    "REJECTED",
    "SUSPENDED",
    "NO_SUBJECTS",
    "NO_AVAILABILITY",
    "PAYOUT_NOT_ACTIVE",
]


class VisibilityIssue(BaseModel):
    code: VisibilityCode
    severity: Literal["hidden", "warning"]


class TutorDashboardOut(BaseModel):
    pending_count: int
    pending: list[BookingOut]
    next_lesson: BookingOut | None = None
    upcoming: list[BookingOut]
    upcoming_count: int
    completed_this_month: int
    completed_total: int
    visibility_issues: list[VisibilityIssue]


class TutorStudentOut(BaseModel):
    """Eğitmenin ders ilişkisi olan öğrencisi (Modül 8, ders teklifi ekranı)."""

    client_id: int
    full_name: str | None = None
    avatar_url: str | None = None
    last_lesson_at: datetime.datetime | None = None
    lesson_count: int = 0
