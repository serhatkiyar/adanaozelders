"""Mağaza vitrin kartlarının public ve admin API sözleşmeleri."""

from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.store_hero_slide import _validate_link


def _validate_products(value: list[int]) -> list[int]:
    if not 1 <= len(value) <= 4:
        raise ValueError("Bir kartta 1 ile 4 arasında ürün olmalı.")
    if len(value) != len(set(value)):
        raise ValueError("Aynı ürün bir kartta birden fazla kullanılamaz.")
    if any(product_id <= 0 for product_id in value):
        raise ValueError("Geçersiz ürün kimliği.")
    return value


class StoreShowcaseCustomTileMeta(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(default="", max_length=80)
    alt_text: str = Field(min_length=1, max_length=180)
    link_url: str = Field(max_length=2000)

    _link = field_validator("link_url", mode="before")(_validate_link)


class StoreShowcaseCustomTileOut(StoreShowcaseCustomTileMeta):
    image_url: str


class StoreShowcaseCustomCardMeta(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=180)
    link_url: str = Field(max_length=2000)
    link_label: str = Field(default="Keşfet", min_length=1, max_length=60)
    is_active: bool = False
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)


class StoreShowcaseCustomTileEdit(StoreShowcaseCustomTileMeta):
    existing_index: int | None = Field(default=None, ge=0, le=3)
    file_index: int | None = Field(default=None, ge=0, le=3)

    @model_validator(mode="after")
    def exactly_one_source(self):
        if (self.existing_index is None) == (self.file_index is None):
            raise ValueError("Her görsel mevcut bir kutuyu veya yeni bir dosyayı göstermeli.")
        return self


class StoreShowcaseCardCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=180)
    link_url: str = Field(max_length=2000)
    link_label: str = Field(default="Keşfet", min_length=1, max_length=60)
    product_ids: list[int]
    is_active: bool = False
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)
    _products = field_validator("product_ids")(_validate_products)


class StoreShowcaseCardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=180)
    link_url: str | None = Field(default=None, max_length=2000)
    link_label: str | None = Field(default=None, min_length=1, max_length=60)
    product_ids: list[int] | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)

    @field_validator("product_ids")
    @classmethod
    def products(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return value
        return _validate_products(value)


class StoreShowcaseProductOut(BaseModel):
    id: int
    slug: str
    title: str
    cover_url: str | None = None


class StoreShowcaseCardPublicOut(BaseModel):
    id: int
    title: str
    description: str
    link_url: str
    link_label: str
    content_mode: Literal["PRODUCTS", "CUSTOM"]
    products: list[StoreShowcaseProductOut]
    custom_tiles: list[StoreShowcaseCustomTileOut]


class StoreShowcaseFeedOut(BaseModel):
    configured: bool
    cards: list[StoreShowcaseCardPublicOut]


class StoreShowcaseCardOut(StoreShowcaseCardPublicOut):
    product_ids: list[int]
    is_active: bool
    sort_order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class StoreShowcaseCardReorder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=20)

    @field_validator("ordered_ids")
    @classmethod
    def unique_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)) or any(item <= 0 for item in value):
            raise ValueError("Geçersiz kart sıralaması.")
        return value
