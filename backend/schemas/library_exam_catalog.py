from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Admin küratör CRUD ───────────────────────────────────────────────────────────


class CatalogCreate(BaseModel):
    exam_name: str = Field(min_length=2, max_length=200)
    exam_type: str = Field(min_length=1, max_length=20)  # TYT/AYT/YKS/LGS…
    publisher_name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    question_count: int | None = Field(default=None, ge=0, le=1000)
    duration_minutes: int | None = Field(default=None, ge=0, le=1000)
    is_public: bool = True
    is_nationwide: bool = False


class CatalogUpdate(BaseModel):
    exam_name: str | None = Field(default=None, min_length=2, max_length=200)
    exam_type: str | None = Field(default=None, min_length=1, max_length=20)
    publisher_name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    question_count: int | None = Field(default=None, ge=0, le=1000)
    duration_minutes: int | None = Field(default=None, ge=0, le=1000)
    is_public: bool | None = None
    is_nationwide: bool | None = None


class CatalogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exam_name: str
    exam_type: str
    publisher_name: str | None = None
    description: str | None = None
    question_count: int | None = None
    duration_minutes: int | None = None
    is_public: bool = True
    is_nationwide: bool = False
    answer_key_url: str | None = None
    # answer_key_data (JSON oto-değerlendirme) Faz B; çıktıda yalnız "var mı" bilgisi.
    has_answer_key_data: bool = False
    created_at: datetime.datetime | None = None
    # Bu katalogu kullanan oturum sayısı (admin listesinde bilgi amaçlı).
    session_count: int = 0
