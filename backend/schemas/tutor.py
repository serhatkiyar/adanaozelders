from __future__ import annotations

import datetime
import enum
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from core.slug import tutor_slug
from models.tutor import Gender, TutorStatus
from schemas.education import EducationOut
from schemas.user import UserOut


class AvailabilityIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_minute: int = Field(ge=0, le=1440)
    end_minute: int = Field(ge=0, le=1440)

    @model_validator(mode="after")
    def _check_range(self) -> "AvailabilityIn":
        if self.end_minute <= self.start_minute:
            raise ValueError("end_minute must be greater than start_minute")
        return self


class AvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weekday: int
    start_minute: int
    end_minute: int


class TutorSort(str, enum.Enum):
    RELEVANCE = "relevance"
    PRICE_ASC = "price_asc"
    PRICE_DESC = "price_desc"
    RATING_DESC = "rating_desc"


class TeachingMode(str, enum.Enum):
    ONLINE = "ONLINE"  # Uzaktan
    IN_PERSON = "IN_PERSON"  # Yüzyüze
    BOTH = "BOTH"  # Her ikisi


class TutorProfileUpdate(BaseModel):
    headline: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    hourly_rate: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    teaching_mode: TeachingMode | None = None
    # Yüzyüze ders için baz konum (serbest adres + harita koordinatı).
    location_text: str | None = Field(default=None, max_length=300)
    location_lat: float | None = Field(default=None, ge=-90, le=90)
    location_lng: float | None = Field(default=None, ge=-180, le=180)
    # Verilirse eğitmenin ders/branş kümesini tümüyle değiştirir (replace).
    subjects: list[str] | None = Field(default=None, max_length=40)
    # Verilirse haftalık müsaitlik pencerelerini tümüyle değiştirir (replace).
    availability: list[AvailabilityIn] | None = Field(default=None, max_length=60)


class TutorOut(UserOut):
    status: TutorStatus
    headline: str | None = None
    bio: str | None = None
    hourly_rate: Decimal | None = None
    teaching_mode: TeachingMode | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    subjects: list[str] = []
    availability: list[AvailabilityOut] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def slug(self) -> str:
        """Kanonik SEO slug: ``isim-soyisim-{id}``."""
        return tutor_slug(self.id, self.full_name)


class TutorSearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    avatar_url: str | None = None
    headline: str | None = None
    bio: str | None = None
    hourly_rate: Decimal | None = None
    teaching_mode: TeachingMode | None = None
    gender: Gender | None = None
    birth_date: datetime.date | None = None
    last_seen_at: datetime.datetime | None = None
    # Güven sinyalleri: hesabın açılış tarihi ("… tarihinden beri üye") ve
    # tamamlanmış ders sayısı (sosyal kanıt). Profilde rozet olarak gösterilir.
    created_at: datetime.datetime | None = None
    completed_lessons: int = 0
    rating_count: int
    rating_average: float | None = None
    bayesian_score: float
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    # "Yakınımdaki" araması yapıldığında doldurulur (km).
    distance_km: float | None = None
    subjects: list[str] = []
    availability: list[AvailabilityOut] = []
    educations: list[EducationOut] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def slug(self) -> str:
        """Kanonik SEO slug: ``isim-soyisim-{id}``."""
        return tutor_slug(self.id, self.full_name)
