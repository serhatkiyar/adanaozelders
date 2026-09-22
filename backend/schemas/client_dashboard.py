from __future__ import annotations

import datetime
import decimal
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


class ClientTutorOut(BaseModel):
    """Öğrencinin ders aldığı öğretmen ("Derslerim → Öğretmenlerim")."""

    tutor_id: int
    full_name: str | None = None
    avatar_url: str | None = None
    hourly_rate: decimal.Decimal | None = None
    last_lesson_at: datetime.datetime | None = None
    next_lesson_at: datetime.datetime | None = None
    #: Yalnız onaylı (COMPLETED) dersler.
    completed_lesson_count: int = 0
    #: Yalnız ücretsiz ilk ders alınmış, henüz tamamlanmış ders yok.
    trial_only: bool = False


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
