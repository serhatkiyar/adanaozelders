from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.booking import BookingStatus
from schemas.tutor import TeachingMode


class BookingCreate(BaseModel):
    tutor_id: int
    start_at: datetime.datetime
    end_at: datetime.datetime
    price: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    notes: str | None = None
    mode: TeachingMode | None = None  # ONLINE | IN_PERSON (BOTH seçilemez)
    location: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingCreate":
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at and end_at must be timezone-aware")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class BookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BookingLocation(BaseModel):
    location: str = Field(min_length=1, max_length=300)


class BookingReschedule(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime

    @model_validator(mode="after")
    def _validate_window(self) -> "BookingReschedule":
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at and end_at must be timezone-aware")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tutor_id: int
    client_id: int
    status: BookingStatus
    start_at: datetime.datetime
    end_at: datetime.datetime
    price: Decimal | None = None
    notes: str | None = None
    cancel_reason: str | None = None
    mode: str | None = None
    location: str | None = None
    meeting_room: str | None = None
    created_at: datetime.datetime
    # Görüntüleme için; list_bookings/get_booking doldurur, aksiyon yanıtlarında da set edilir.
    tutor_name: str | None = None
    tutor_avatar_url: str | None = None
    client_name: str | None = None
    client_avatar_url: str | None = None
    # Bu rezervasyon için aktif bir değerlendirme var mı? list_bookings/get_booking doldurur.
    reviewed: bool = False
