"""Mağaza Pydantic şemaları (ürün/kategori/değerlendirme/sipariş).

Fiyatlar dışarıya **string** olarak sunulur (frontend money.ts Decimal parse eder;
Library.study_hourly_price deseni). Tutar otoritesi sunucudadır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ── Kategori ───────────────────────────────────────────────────────────────────────


class ProductCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    parent_id: int | None = None
    icon_url: str | None = None
    sort_order: int = 0
    product_count: int | None = None


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: int | None = None
    icon_url: str | None = Field(default=None, max_length=500)
    sort_order: int = 0


class ProductCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: int | None = None
    icon_url: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None


# ── Ürün ─────────────────────────────────────────────────────────────────────────


class ProductImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    caption: str | None = None
    sort_order: int = 0


class ProductSearchOut(BaseModel):
    """Katalog kartı (liste/ızgara)."""

    id: int
    slug: str
    title: str
    kind: str
    seller_type: str
    tutor_id: int | None = None
    tutor_name: str | None = None
    price: str
    compare_at_price: str | None = None
    currency: str
    cover_url: str | None = None
    in_stock: bool = True
    category_id: int | None = None
    rating_count: int = 0
    rating_average: float | None = None
    bayesian_score: float | None = None
    status: str | None = None


class ProductDetailOut(ProductSearchOut):
    description: str | None = None
    stock: int | None = None
    weight_grams: int | None = None
    digital_asset_name: str | None = None
    # Kitap künyesi (dolu olanlar detayda "Ürün Özellikleri" tablosunda gösterilir).
    author: str | None = None
    publisher: str | None = None
    isbn: str | None = None
    page_count: int | None = None
    dimensions: str | None = None
    publication_year: int | None = None
    edition: str | None = None
    language: str | None = None
    cover_type: str | None = None
    images: list[ProductImageOut] = []
    created_at: datetime.datetime | None = None


class _BookSpecFields(BaseModel):
    """Kitap künyesi (opsiyonel) — ProductCreate/ProductUpdate ortak alanları."""

    author: str | None = Field(default=None, max_length=200)
    publisher: str | None = Field(default=None, max_length=200)
    isbn: str | None = Field(default=None, max_length=20)
    page_count: int | None = Field(default=None, ge=0)
    dimensions: str | None = Field(default=None, max_length=40)
    publication_year: int | None = Field(default=None, ge=0, le=2100)
    edition: str | None = Field(default=None, max_length=40)
    language: str | None = Field(default=None, max_length=40)
    cover_type: str | None = Field(default=None, max_length=40)


class ProductCreate(_BookSpecFields):
    """Admin ürün oluşturma (varsayılan PLATFORM/fiziksel). Eğitmen ürünleri ayrı
    seller ucundan gelir (kind=DIGITAL zorlanır)."""

    title: str = Field(min_length=1, max_length=250)
    description: str | None = None
    kind: str = Field(pattern="^(PHYSICAL|DIGITAL)$")
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    stock: int | None = Field(default=None, ge=0)
    weight_grams: int | None = Field(default=None, ge=0)
    category_id: int | None = None
    status: str = Field(default="DRAFT", pattern="^(ACTIVE|HIDDEN|DRAFT)$")
    cover_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check(self):
        if self.compare_at_price is not None and self.compare_at_price <= self.price:
            raise ValueError("compare_at_price fiyattan büyük olmalı")
        return self


class ProductUpdate(_BookSpecFields):
    title: str | None = Field(default=None, min_length=1, max_length=250)
    description: str | None = None
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    stock: int | None = Field(default=None, ge=0)
    weight_grams: int | None = Field(default=None, ge=0)
    category_id: int | None = None
    status: str | None = Field(default=None, pattern="^(ACTIVE|HIDDEN|DRAFT|PENDING)$")
    cover_url: str | None = Field(default=None, max_length=500)


class SellerProductCreate(BaseModel):
    """Eğitmen dijital ürün oluşturma (kind=DIGITAL + status=PENDING zorlanır)."""

    title: str = Field(min_length=1, max_length=250)
    description: str | None = None
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    category_id: int | None = None
    cover_url: str | None = Field(default=None, max_length=500)


# ── Eğitmen kazanç özeti ──


class StockNotifyIn(BaseModel):
    """Stok-bitince bildirim aboneliği (public; e-posta zorunlu)."""

    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)


class BulkImportRowError(BaseModel):
    row: int
    message: str


class BulkImportResultOut(BaseModel):
    """CSV toplu içe aktarma özeti."""

    created: int
    skipped: int
    errors: list[BulkImportRowError] = []


class SellerProductStat(BaseModel):
    """Ürün başına satış istatistiği (yalnız ödenmiş siparişler)."""

    product_id: int | None = None
    title: str
    units_sold: int
    gross: str
    earnings: str


class SellerEarningsOut(BaseModel):
    total_units: int
    total_orders: int
    total_gross: str
    total_earnings: str
    products: list[SellerProductStat] = []


# ── Değerlendirme ──────────────────────────────────────────────────────────────────


class ProductReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment_text: str | None = Field(default=None, max_length=2000)


class ProductReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rating: int
    comment_text: str | None = None
    created_at: datetime.datetime
    client_name: str | None = None
    client_avatar_url: str | None = None


# ── Sipariş ─────────────────────────────────────────────────────────────────────────


class CartLineIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=99)


class OrderCreate(BaseModel):
    items: list[CartLineIn] = Field(min_length=1)
    # Fiziksel kalem varsa zorunlu (sunucuda doğrulanır).
    address_id: int | None = None
    coupon_code: str | None = Field(default=None, max_length=40)


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None = None
    title: str
    cover_url: str | None = None
    unit_price: str
    quantity: int
    kind: str
    seller_type: str
    # İndirme linki yalnız PAID + DIGITAL kaleme döner (serviste doldurulur).
    download_url: str | None = None


class OrderOut(BaseModel):
    id: int
    status: str
    payment_status: str
    subtotal: str
    shipping_fee: str
    discount: str = "0.00"
    coupon_code: str | None = None
    total: str
    currency: str
    has_physical: bool
    ship_recipient: str | None = None
    ship_phone: str | None = None
    ship_address: str | None = None
    ship_city: str | None = None
    ship_district: str | None = None
    tracking_no: str | None = None
    # En güncel iade talebinin durumu (PENDING/APPROVED/REJECTED) — yoksa None.
    return_status: str | None = None
    created_at: datetime.datetime
    items: list[OrderItemOut] = []
    # Hosted checkout (iyzico) yönlendirme URL'i — fake sağlayıcıda None.
    redirect_url: str | None = None


class CartValidateOut(BaseModel):
    """Checkout öncesi sunucu doğrulaması: güncel fiyatlar + uygunluk."""

    items: list[OrderItemOut] = []
    subtotal: str
    shipping_fee: str
    discount: str = "0.00"
    coupon_code: str | None = None
    coupon_error: str | None = None
    total: str
    currency: str
    has_physical: bool
    issues: list[str] = []


class OrderShipIn(BaseModel):
    tracking_no: str | None = Field(default=None, max_length=100)


# ── Kupon (admin küratörlüğü) ──


class CouponOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    discount_type: str
    discount_value: str
    min_subtotal: str
    max_uses: int | None = None
    per_user_limit: int | None = None
    used_count: int
    valid_from: datetime.datetime | None = None
    valid_until: datetime.datetime | None = None
    is_active: bool


class CouponCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    discount_type: str = Field(pattern="^(PERCENT|FIXED)$")
    discount_value: Decimal = Field(gt=0)
    min_subtotal: Decimal = Field(default=Decimal("0"), ge=0)
    max_uses: int | None = Field(default=None, ge=1)
    per_user_limit: int | None = Field(default=1, ge=1)
    valid_from: datetime.datetime | None = None
    valid_until: datetime.datetime | None = None
    is_active: bool = True


class CouponUpdate(BaseModel):
    discount_type: str | None = Field(default=None, pattern="^(PERCENT|FIXED)$")
    discount_value: Decimal | None = Field(default=None, gt=0)
    min_subtotal: Decimal | None = Field(default=None, ge=0)
    max_uses: int | None = Field(default=None, ge=1)
    per_user_limit: int | None = Field(default=None, ge=1)
    valid_from: datetime.datetime | None = None
    valid_until: datetime.datetime | None = None
    is_active: bool | None = None


# ── İade talebi (RMA) ──


class OrderReturnCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class OrderReturnResolve(BaseModel):
    admin_note: str | None = Field(default=None, max_length=1000)


class OrderReturnOut(BaseModel):
    id: int
    order_id: int
    status: str
    reason: str
    admin_note: str | None = None
    created_at: datetime.datetime
    resolved_at: datetime.datetime | None = None
    # Admin listesinde sipariş özeti gömülü gelir; müşteri yanıtında None.
    order: OrderOut | None = None


# ── Koleksiyon (Listelerim) ──────────────────────────────────────────────────────


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def _strip(self) -> "CollectionCreate":
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Liste adı boş olamaz")
        return self


class CollectionUpdate(CollectionCreate):
    pass


class CollectionItemAdd(BaseModel):
    product_id: int


class CollectionOut(BaseModel):
    """Liste kartı: ad + paylaşım token'ı + üyelik (product_ids) + önizleme (≤6)."""

    id: int
    name: str
    share_token: str
    product_ids: list[int] = []
    preview: list[ProductSearchOut] = []


class CollectionDetailOut(BaseModel):
    """Liste detayı (sahibi) ve public paylaşım görünümü."""

    id: int
    name: str
    share_token: str
    items: list[ProductSearchOut] = []
