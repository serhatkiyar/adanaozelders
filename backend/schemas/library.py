from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Çalışma saatleri ────────────────────────────────────────────────────────────


class LibraryHoursIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    is_closed: bool = False
    open_minute: int | None = Field(default=None, ge=0, le=1440)
    close_minute: int | None = Field(default=None, ge=0, le=1440)

    @field_validator("close_minute")
    @classmethod
    def _check_range(cls, v: int | None, info):
        is_closed = info.data.get("is_closed")
        open_minute = info.data.get("open_minute")
        if is_closed:
            return v
        if v is None or open_minute is None:
            raise ValueError("Açık günde open_minute ve close_minute zorunludur")
        if v <= open_minute:
            raise ValueError("close_minute, open_minute'tan büyük olmalı")
        return v


class LibraryHoursOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weekday: int
    is_closed: bool
    open_minute: int | None = None
    close_minute: int | None = None


# ── Değerlendirme ────────────────────────────────────────────────────────────────


class LibraryReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment_text: str | None = Field(default=None, max_length=2000)


class LibraryReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    library_id: int
    client_id: int
    rating: int
    comment_text: str | None = None
    created_at: datetime.datetime
    client_name: str | None = None
    client_avatar_url: str | None = None


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


class LibraryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=300)
    cover_url: str | None = Field(default=None, max_length=500)
    location_text: str | None = Field(default=None, max_length=300)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    capacity: int | None = Field(default=None, ge=0, le=100000)
    study_hourly_price: float | None = Field(default=None, ge=0, le=100000)
    status: str = Field(default="ACTIVE")
    amenities: list[str] = Field(default_factory=list)
    hours: list[LibraryHoursIn] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in ("ACTIVE", "HIDDEN"):
            raise ValueError("status ACTIVE veya HIDDEN olmalı")
        return v

    @field_validator("amenities")
    @classmethod
    def _dedupe_amenities(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for a in v:
            a = a.strip().lower()
            if a and a not in seen and len(a) <= 50:
                seen.append(a)
        return seen


class LibraryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=300)
    cover_url: str | None = Field(default=None, max_length=500)
    location_text: str | None = Field(default=None, max_length=300)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    capacity: int | None = Field(default=None, ge=0, le=100000)
    study_hourly_price: float | None = Field(default=None, ge=0, le=100000)
    status: str | None = None
    amenities: list[str] | None = None
    hours: list[LibraryHoursIn] | None = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("ACTIVE", "HIDDEN"):
            raise ValueError("status ACTIVE veya HIDDEN olmalı")
        return v

    @field_validator("amenities")
    @classmethod
    def _dedupe_amenities(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        seen: list[str] = []
        for a in v:
            a = a.strip().lower()
            if a and a not in seen and len(a) <= 50:
                seen.append(a)
        return seen


# ── Public çıktı ─────────────────────────────────────────────────────────────────


class LibrarySearchOut(BaseModel):
    """Katalog/harita liste öğesi."""

    id: int
    name: str
    slug: str
    description: str | None = None
    cover_url: str | None = None
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    capacity: int | None = None
    study_hourly_price: str | None = None  # Decimal -> string
    amenities: list[str] = Field(default_factory=list)
    rating_count: int = 0
    rating_average: float | None = None
    bayesian_score: float | None = None
    distance_km: float | None = None
    # Şu anda açık mı (sunucuda, kütüphane yerel saatine göre hesaplanır).
    open_now: bool | None = None


class LibraryDetailOut(LibrarySearchOut):
    """Profil detayı: iletişim + tüm çalışma saatleri."""

    phone: str | None = None
    email: str | None = None
    website: str | None = None
    status: str = "ACTIVE"
    hours: list[LibraryHoursOut] = Field(default_factory=list)
    created_at: datetime.datetime | None = None
