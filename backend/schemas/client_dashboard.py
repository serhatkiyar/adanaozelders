from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from schemas.booking import BookingOut

# Sıra `client_dashboard_service.NEXT_ACTION_PRIORITY` ile aynıdır.
NextActionKind = Literal[
    "JOIN_LESSON",
    "RESPOND_OFFER",
    "PAY",
    "CONFIRM_LESSON",
    "REVIEW",
    "NEXT_LESSON",
    "BOOK_AGAIN",
]


class ClientNextAction(BaseModel):
    kind: NextActionKind
    booking: BookingOut


class ClientDashboardOut(BaseModel):
    next_action: ClientNextAction | None = None
    upcoming: list[BookingOut]
    upcoming_count: int
    offer_count: int
    payment_due_count: int
    confirm_count: int
    review_count: int
    completed_total: int
    has_bookings: bool
    free_first_lesson_tutor_count: int
