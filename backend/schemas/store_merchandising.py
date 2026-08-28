"""Mağaza yönetiminin KALAN API sözleşmeleri: öznitelikler + medya.

Manuel vitrin kararı (28 Ağu 2026): landing page / akıllı ürün grubu
şemaları söküldü — vitrin frontend'de kod olarak yaşar.
"""

from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AttributeValueWrite(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True


class AttributeValueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    definition_id: int
    label: str
    slug: str
    sort_order: int
    is_active: bool


class AttributeDefinitionWrite(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=0)
    is_active: bool = True


class AttributeDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool
    values: list[AttributeValueOut] = []


class ProductAttributeAssignmentWrite(BaseModel):
    value_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("value_ids")
    @classmethod
    def unique_values(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Aynı özellik değeri birden fazla kez seçilemez.")
        return value


class MediaAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    image_url: str
    alt_text: str
    mime_type: str
    width: int
    height: int
    file_size: int
    created_at: datetime.datetime
