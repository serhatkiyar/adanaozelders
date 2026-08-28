"""Akıllı ürün grupları ve sürümlü mağaza sayfalarının API sözleşmeleri."""

from __future__ import annotations

import datetime
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schemas.store import ProductCategoryOut, ProductSearchOut


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


class CategoryRule(BaseModel):
    field: Literal["CATEGORY"]
    operator: Literal["IN", "NOT_IN"] = "IN"
    values: list[int] = Field(min_length=1, max_length=50)
    include_descendants: bool = True


class AttributeRule(BaseModel):
    field: Literal["ATTRIBUTE"]
    operator: Literal["IN", "NOT_IN"] = "IN"
    values: list[int] = Field(min_length=1, max_length=100)


class KindRule(BaseModel):
    field: Literal["KIND"]
    operator: Literal["IN", "NOT_IN"] = "IN"
    values: list[Literal["PHYSICAL", "DIGITAL"]] = Field(min_length=1, max_length=2)


class AvailabilityRule(BaseModel):
    field: Literal["AVAILABLE"]
    operator: Literal["EQ"] = "EQ"
    value: bool = True


class PriceRule(BaseModel):
    field: Literal["PRICE"]
    operator: Literal["BETWEEN"] = "BETWEEN"
    minimum: float | None = Field(default=None, ge=0)
    maximum: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def valid_range(self):
        if self.minimum is None and self.maximum is None:
            raise ValueError("Fiyat kuralında alt veya üst sınır gerekli.")
        if self.minimum is not None and self.maximum is not None and self.maximum < self.minimum:
            raise ValueError("Üst fiyat alt fiyattan küçük olamaz.")
        return self


ProductSetRule = Annotated[
    CategoryRule | AttributeRule | KindRule | AvailabilityRule | PriceRule,
    Field(discriminator="field"),
]


class ProductSetRevisionWrite(BaseModel):
    match_mode: Literal["ALL", "ANY"] = "ALL"
    rules: list[ProductSetRule] = Field(default_factory=list, max_length=20)
    pinned_product_ids: list[int] = Field(default_factory=list, max_length=100)
    excluded_product_ids: list[int] = Field(default_factory=list, max_length=100)
    sort_mode: Literal[
        "MANUAL", "NEWEST", "POPULAR", "RATING", "PRICE_ASC", "PRICE_DESC"
    ] = "NEWEST"
    max_items: int = Field(default=12, ge=1, le=48)

    @model_validator(mode="after")
    def validate_overrides(self):
        pins = set(self.pinned_product_ids)
        excluded = set(self.excluded_product_ids)
        if len(pins) != len(self.pinned_product_ids) or len(excluded) != len(self.excluded_product_ids):
            raise ValueError("Ürün kimlikleri tekrar edemez.")
        if pins & excluded:
            raise ValueError("Bir ürün aynı anda sabitlenip hariç tutulamaz.")
        return self


class ProductSetWrite(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    is_active: bool = True
    revision: ProductSetRevisionWrite


class ProductSetRevisionOut(ProductSetRevisionWrite):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_set_id: int
    version: int
    status: str
    published_at: datetime.datetime | None = None


class ProductSetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    is_active: bool
    revision: ProductSetRevisionOut
    published_revision_id: int | None = None
    matched_count: int = 0
    preview_products: list[ProductSearchOut] = []
    warnings: list[str] = []


class LandingPageBlockWrite(BaseModel):
    block_key: str | None = Field(default=None, max_length=36)
    block_type: Literal[
        "HERO_CAROUSEL",
        "IMAGE_CARD_GRID",
        "CATEGORY_GRID",
        "PRODUCT_RAIL",
        "BANNER",
        "RICH_TEXT",
        "RECENTLY_VIEWED",
    ]
    title: str = Field(default="", max_length=140)
    description: str = Field(default="", max_length=1000)
    link_label: str = Field(default="", max_length=60)
    link_url: str | None = Field(default=None, max_length=500)
    config: dict = Field(default_factory=dict)
    product_set_id: int | None = None
    product_set_revision_id: int | None = None
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0)

    _link = field_validator("link_url", mode="before")(_validate_link)

    @model_validator(mode="after")
    def validate_config(self):
        if len(json.dumps(self.config, ensure_ascii=False)) > 200_000:
            raise ValueError("Blok ayarları 200 KB sınırını aşamaz.")

        def validate_links(value: object) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == "link_url" and child is not None:
                        if not isinstance(child, str):
                            raise ValueError("Blok bağlantısı metin olmalı.")
                        _validate_link(child)
                    else:
                        validate_links(child)
            elif isinstance(value, list):
                for child in value:
                    validate_links(child)

        validate_links(self.config)
        if (
            self.block_type == "PRODUCT_RAIL"
            and self.product_set_id is None
            and self.product_set_revision_id is None
        ):
            raise ValueError("Ürün şeridi için bir koleksiyon seçilmeli.")
        if self.block_type == "HERO_CAROUSEL" and not self.config.get("slides"):
            raise ValueError("Hero alanında en az bir görsel olmalı.")
        if self.block_type == "IMAGE_CARD_GRID" and not self.config.get("cards"):
            raise ValueError("Resimli kart alanında en az bir kart olmalı.")
        if self.block_type == "BANNER" and not self.config.get("image_url"):
            raise ValueError("Banner görseli zorunludur.")
        return self


class LandingPageRevisionWrite(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    seo_title: str = Field(min_length=1, max_length=160)
    seo_description: str = Field(default="", max_length=320)
    og_image_url: str | None = Field(default=None, max_length=500)
    blocks: list[LandingPageBlockWrite] = Field(default_factory=list, max_length=60)
    # Puck editörünün kanonik verisi (Faz 2). DOLUYSA `blocks` gönderilemez —
    # blok satırları sunucuda bu veriden türetilir (store_merchandising_puck).
    puck_data: dict | None = None

    @model_validator(mode="after")
    def tek_kaynak(self):
        if self.puck_data is not None and self.blocks:
            raise ValueError("puck_data ve blocks birlikte gönderilemez.")
        return self


class LandingPageCreate(BaseModel):
    internal_name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=140)
    page_type: Literal["HOME", "CAMPAIGN", "SEASONAL", "EXAM", "BRAND", "CURATED"] = "CAMPAIGN"
    revision: LandingPageRevisionWrite


class LandingPageIdentityUpdate(BaseModel):
    internal_name: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(default=None, min_length=1, max_length=140)
    is_archived: bool | None = None


class LandingPagePublishIn(BaseModel):
    starts_at: datetime.datetime
    ends_at: datetime.datetime | None = None

    @model_validator(mode="after")
    def end_after_start(self):
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("Bitiş zamanı başlangıçtan sonra olmalı.")
        return self


class LandingPageBlockOut(LandingPageBlockWrite):
    id: int
    block_key: str
    products: list[ProductSearchOut] = []
    categories: list[ProductCategoryOut] = []
    warnings: list[str] = []


class LandingPageRevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    page_id: int
    version: int
    status: str
    title: str
    seo_title: str
    seo_description: str
    og_image_url: str | None = None
    published_at: datetime.datetime | None = None
    blocks: list[LandingPageBlockOut] = []
    puck_data: dict | None = None


class LandingPageOut(BaseModel):
    id: int
    internal_name: str
    slug: str
    page_type: str
    is_archived: bool
    state: Literal["DRAFT", "UPCOMING", "LIVE", "ENDED", "ARCHIVED"]
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    canonical_url: str
    revision: LandingPageRevisionOut


class LandingPageSummaryOut(BaseModel):
    id: int
    internal_name: str
    slug: str
    page_type: str
    is_archived: bool
    state: str
    latest_revision_id: int
    latest_version: int
    starts_at: datetime.datetime | None = None
    ends_at: datetime.datetime | None = None
    has_unpublished_changes: bool = False


class LandingPagePublicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    page_id: int
    revision_id: int
    starts_at: datetime.datetime
    ends_at: datetime.datetime | None = None
    state: Literal["UPCOMING", "LIVE", "ENDED"]


class LandingPagePublicationUpdate(BaseModel):
    starts_at: datetime.datetime
    ends_at: datetime.datetime | None = None

    @model_validator(mode="after")
    def end_after_start(self):
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("Bitiş zamanı başlangıçtan sonra olmalı.")
        return self


class LandingPageDuplicateIn(BaseModel):
    internal_name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=140)


class StorePageEventIn(BaseModel):
    event_type: Literal["PAGE_VIEW", "BLOCK_CLICK", "PRODUCT_CLICK"]
    block_key: str = Field(default="", max_length=36)
    product_id: int | None = None

    @model_validator(mode="after")
    def validate_event_target(self):
        if self.event_type == "PAGE_VIEW":
            if self.block_key or self.product_id is not None:
                raise ValueError("Sayfa görüntüleme olayı blok veya ürün taşıyamaz.")
            return self
        if not self.block_key:
            raise ValueError("Tıklama olayı için blok anahtarı zorunludur.")
        if self.event_type == "PRODUCT_CLICK" and self.product_id is None:
            raise ValueError("Ürün tıklaması için ürün zorunludur.")
        if self.event_type == "BLOCK_CLICK" and self.product_id is not None:
            raise ValueError("Blok tıklaması ürün taşıyamaz.")
        return self


class StorePageEventOut(BaseModel):
    attribution_token: str | None = None


class StorePageMetricOut(BaseModel):
    page_id: int
    page_revision_id: int
    page_views: int
    block_clicks: int
    product_clicks: int
    paid_orders: int
    attributed_revenue: str


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
