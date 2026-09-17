from __future__ import annotations

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
