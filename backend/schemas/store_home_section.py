"""Yönetilebilir mağaza ana sayfa akışı API sözleşmeleri."""

from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.store import ProductSearchOut
from schemas.store_hero_slide import _validate_link


def _validate_products(value: list[int]) -> list[int]:
    if not 1 <= len(value) <= 12:
        raise ValueError("Bir ürün şeridinde 1 ile 12 arasında ürün olmalı.")
    if len(value) != len(set(value)):
        raise ValueError("Aynı ürün bir şeritte birden fazla kullanılamaz.")
    if any(product_id <= 0 for product_id in value):
        raise ValueError("Geçersiz ürün kimliği.")
    return value


class StoreHomeImageTileMeta(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(default="", max_length=80)
    alt_text: str = Field(min_length=1, max_length=180)
    link_url: str = Field(max_length=2000)

    _link = field_validator("link_url", mode="before")(_validate_link)


class StoreHomeImageTileEdit(StoreHomeImageTileMeta):
    existing_index: int | None = Field(default=None, ge=0, le=3)
    file_index: int | None = Field(default=None, ge=0, le=3)

    @model_validator(mode="after")
    def exactly_one_source(self):
        if (self.existing_index is None) == (self.file_index is None):
            raise ValueError("Her görsel mevcut bir kutuyu veya yeni bir dosyayı göstermeli.")
        return self


class StoreHomeImageTileOut(StoreHomeImageTileMeta):
    image_url: str


class StoreHomeSectionMeta(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=180)
    link_url: str | None = Field(default=None, max_length=2000)
    link_label: str = Field(default="Tümünü gör", min_length=1, max_length=60)
    is_active: bool = False
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)


class StoreHomeProductSectionWrite(StoreHomeSectionMeta):
    product_ids: list[int]

    _products = field_validator("product_ids")(_validate_products)


class StoreHomeSectionPublicOut(BaseModel):
    id: int
    title: str
    description: str
    section_type: Literal["PRODUCT_RAIL", "IMAGE_GRID", "RECENTLY_VIEWED"]
    link_url: str | None
    link_label: str
    products: list[ProductSearchOut]
    image_tiles: list[StoreHomeImageTileOut]


class StoreHomeFeedOut(BaseModel):
    configured: bool
    sections: list[StoreHomeSectionPublicOut]


class StoreHomeSectionOut(StoreHomeSectionPublicOut):
    product_ids: list[int]
    is_active: bool
    sort_order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class StoreHomeSectionReorder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=30)

    @field_validator("ordered_ids")
    @classmethod
    def unique_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)) or any(item <= 0 for item in value):
            raise ValueError("Geçersiz bölüm sıralaması.")
        return value


class StoreHomeRecentlyViewedUpdate(BaseModel):
    is_active: bool
