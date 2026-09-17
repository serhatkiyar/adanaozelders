from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.booking import BookingOut


class _Aralik(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime

    @model_validator(mode="after")
    def _saat_dilimi_zorunlu(self):
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at ve end_at saat dilimi içermeli")
        return self


class TimeOffPreviewIn(_Aralik):
    pass


class TimeOffIn(_Aralik):
    title: str | None = Field(default=None, max_length=100)
    # Çakışan ders varsa zorunlu: öğrencilere giden iptal/red gerekçesi.
    note: str | None = Field(default=None, max_length=500)


class TimeOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start_at: datetime.datetime
    end_at: datetime.datetime
    title: str | None = None


class TimeOffConflictOut(BaseModel):
    booking: BookingOut
    can_cancel: bool


class TimeOffPreviewOut(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime
    bookings: list[TimeOffConflictOut]
    blocked: bool
    # Aralık mevcut bir izinle kesişiyor mu (kayıt 409 alır).
    overlap: bool


class TimeOffCreatedOut(BaseModel):
    time_off: TimeOffOut
    cancelled_count: int
    skipped_ids: list[int]
