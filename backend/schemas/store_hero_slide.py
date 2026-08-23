"""Mağaza hero carousel public ve yönetim sözleşmeleri."""
from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _validate_link(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.startswith("https://") or value.startswith("http://"):
        return value
    raise ValueError("Bağlantı / ile başlayan site içi yol veya http(s) adresi olmalı.")


class StoreHeroSlideCreate(BaseModel):
    alt_text: str = Field(default="", max_length=180)
    link_url: str | None = Field(default=None, max_length=2000)
    is_active: bool = False
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("Bitiş tarihi başlangıç tarihinden sonra olmalı.")
        return self


class StoreHeroSlideUpdate(BaseModel):
    # Varsayılanlar yalnız Pydantic sözleşmesini kurar; service
    # ``exclude_unset=True`` kullandığı için gönderilmeyen alanlar değişmez.
    # NOT NULL kolonlarda açık ``null`` ise 500 yerine 422 ile reddedilir.
    alt_text: str = Field(default="", max_length=180)
    link_url: str | None = Field(default=None, max_length=2000)
    is_active: bool = False
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)


class StoreHeroSlidePublicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    image_url: str
    mobile_image_url: str | None = None
    alt_text: str
    link_url: str | None = None


class StoreHeroSlideOut(StoreHeroSlidePublicOut):
    is_active: bool
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    sort_order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class StoreHeroSlideReorder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=50)

    @field_validator("ordered_ids")
    @classmethod
    def unique_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Sıralama listesinde aynı kayıt birden fazla olamaz.")
        if any(item <= 0 for item in value):
            raise ValueError("Geçersiz kayıt kimliği.")
        return value
