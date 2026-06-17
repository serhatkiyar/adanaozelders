from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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
    # Bu kütüphanede ATTENDED (deneme/çalışma) kaydı olan öğrenci → doğrulanmış ziyaretçi.
    verified: bool = False


# ── Galeri görselleri ────────────────────────────────────────────────────────────


class LibraryImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    caption: str | None = None
    sort_order: int = 0


class LibraryImagesReorder(BaseModel):
    """Galeri sırasını tümüyle yeniden tanımlar (verilen id sırasına göre)."""

    image_ids: list[int] = Field(default_factory=list)


# ── Kazanç özeti (operatör/admin) ────────────────────────────────────────────────


class LibraryEarningsOut(BaseModel):
    """Kütüphanenin escrow kazanç özeti (deneme oturumları + çalışma alanı birleşik)."""

    currency: str
    released_earning: str  # kütüphaneye serbest bırakılmış net kazanç (Decimal->str)
    held_earning: str  # emanette bekleyen (ödenmiş ama henüz serbest değil)
    commission_total: str  # serbest bırakılanlardan kesilen platform komisyonu
    released_count: int
    held_count: int
    this_month_earning: str = "0"  # bu ay serbest bırakılan net kazanç
    refunded_total: str = "0"  # iade edilen brüt tutar


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


class LibraryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    website: str | None = Field(default=None, max_length=300)
    cover_url: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=500)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    # Yapısal adres (elle girilir; location_text bunlardan derlenir).
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    neighborhood: str | None = Field(default=None, max_length=150)
    street: str | None = Field(default=None, max_length=200)
    building_no: str | None = Field(default=None, max_length=30)
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
    logo_url: str | None = Field(default=None, max_length=500)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    neighborhood: str | None = Field(default=None, max_length=150)
    street: str | None = Field(default=None, max_length=200)
    building_no: str | None = Field(default=None, max_length=30)
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
    logo_url: str | None = None
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    # Kart/hero kısa bölge etiketi için yapısal il/ilçe.
    city: str | None = None
    district: str | None = None
    capacity: int | None = None
    study_hourly_price: str | None = None  # Decimal -> string
    amenities: list[str] = Field(default_factory=list)
    rating_count: int = 0
    rating_average: float | None = None
    bayesian_score: float | None = None
    distance_km: float | None = None
    # Katalog durumu (admin listesi PENDING/REJECTED ayırt etsin; public hep ACTIVE).
    status: str = "ACTIVE"
    # Şu anda açık mı (sunucuda, kütüphane yerel saatine göre hesaplanır).
    open_now: bool | None = None


class LibraryDetailOut(LibrarySearchOut):
    """Profil detayı: iletişim + tüm çalışma saatleri."""

    phone: str | None = None
    email: str | None = None
    website: str | None = None
    # Yapısal adresin tamamı (editörde düzenleme için).
    neighborhood: str | None = None
    street: str | None = None
    building_no: str | None = None
    status: str = "ACTIVE"
    # Self-kayıt reddedilmişse admin gerekçesi (operatör panelinde gösterilir).
    rejection_reason: str | None = None
    hours: list[LibraryHoursOut] = Field(default_factory=list)
    images: list[LibraryImageOut] = Field(default_factory=list)
    created_at: datetime.datetime | None = None


# ── Self-servis onboarding ("kütüphaneni listele") ───────────────────────────────


class LibraryRegister(BaseModel):
    """Self-servis kayıt: operatör hesabı + temel kütüphane bilgisi. Kütüphane
    PENDING durumda oluşur (public'te görünmez); admin onayıyla ACTIVE olur. Profilin
    gerisi (saat/foto/olanak) onay sonrası operatör panelinden tamamlanır."""

    # Operatör hesabı
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=75)
    last_name: str = Field(min_length=1, max_length=75)
    # Kütüphane temel bilgisi
    name: str = Field(min_length=2, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    description: str | None = Field(default=None, max_length=5000)
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    location_text: str | None = Field(default=None, max_length=400)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)


class LibraryRejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
