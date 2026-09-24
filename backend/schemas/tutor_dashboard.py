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


class TutorStudentAction(BaseModel):
    """Öğrenciler sayfasındaki "Önerilen eylem" (yalnız ucu olan eylemler)."""

    #: RESPOND_REQUEST | COMPLETE_LESSON | OFFER_PENDING | PLAN_LESSON
    kind: str
    #: İlgili ders; PLAN_LESSON'da yoktur.
    booking_id: int | None = None


class TutorStudentOut(BaseModel):
    """Eğitmenin ders ilişkisi olan öğrencisi (ders teklifi + Öğrenciler sayfası)."""

    client_id: int
    full_name: str | None = None
    avatar_url: str | None = None
    # Başlamış kabul edilmiş/tamamlanmış son ders; iptal/red sayılmaz.
    last_lesson_at: datetime.datetime | None = None
    # Kabul edilmiş ilk gelecek ders; bekleyen teklif/talep sayılmaz.
    next_lesson_at: datetime.datetime | None = None
    # Yalnız onaylı (COMPLETED) dersler — Öğrenciler sayfasındaki "Toplam ders".
    completed_lesson_count: int = 0
    # Tüm rezervasyon kaydı (talep/teklif dahil) — ders teklifi penceresi.
    lesson_count: int = 0
    # TRIAL | WEEKLY | SINGLE — yalnız iptal/red kaydı olanda None.
    kind: str | None = None
    # Ücretsiz ilk dersin tarihi (varsa).
    trial_at: datetime.datetime | None = None
    # Bu eğitmenle yapılan ilk ders (kabul edilmiş/tamamlanmış).
    first_lesson_at: datetime.datetime | None = None
    suggested_action: TutorStudentAction | None = None
