"""Mağaza (D&R tarzı) modelleri — dördüncü tedarik/satış yüzeyi.

Hibrit + kısıtlı çok-satıcılı: *platform* fiziksel ürün (kitap/kırtasiye/deneme)
satar, *eğitmenler* dijital ürün (ders notu, PDF/çözüm paketi) satar. Katalog
``Library`` modelini şablon alır (slug + soft-delete + TSVECTOR arama + Numeric
fiyat + galeri + review). Ödeme **escrow değil, doğrudan satıştır**: tek iyzico
ödemesi → sipariş PAID → dijital teslim anında + eğitmen payı kazanca kredi edilir.
"""
from __future__ import annotations

import datetime
import enum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed

from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin


class ProductKind(str, enum.Enum):
    """Teslimat türü. PHYSICAL → kargo + stok; DIGITAL → anında indirme, stoksuz."""

    PHYSICAL = "PHYSICAL"
    DIGITAL = "DIGITAL"


class SellerType(str, enum.Enum):
    """Satıcı. PLATFORM yalnız fiziksel; TUTOR yalnız dijital satar (iş kuralı)."""

    PLATFORM = "PLATFORM"
    TUTOR = "TUTOR"


class ProductStatus(str, enum.Enum):
    """Ürün durumu. Yalnız ACTIVE public katalogda görünür. PENDING = eğitmen
    dijital ürünü admin onayı bekliyor (lansman kalite kapısı)."""

    ACTIVE = "ACTIVE"
    HIDDEN = "HIDDEN"
    DRAFT = "DRAFT"
    PENDING = "PENDING"


class OrderStatus(str, enum.Enum):
    """Sipariş yaşam döngüsü. Ödeme öncesi PENDING; ödeme sonrası PAID. Fiziksel
    kalem varsa admin SHIPPED/DELIVERED işler. İptal/iade CANCELLED/REFUNDED."""

    PENDING = "PENDING"
    PAID = "PAID"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"
    REFUNDED = "REFUNDED"


class OrderPaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"


class ReturnStatus(str, enum.Enum):
    """İade talebi (RMA) durumu. Müşteri PENDING açar; admin onaylar/reddeder."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class CouponDiscountType(str, enum.Enum):
    """İndirim türü. PERCENT → yüzde (0..100); FIXED → sabit TL tutarı."""

    PERCENT = "PERCENT"
    FIXED = "FIXED"


class ProductCategory(Base, TimestampMixin, SoftDeleteMixin):
    """Mağaza kategorisi (D&R kategori çubuğu / mega-menü). İki seviye yeterli:
    üst kategori (``parent_id`` boş) + alt kategori. ``icon_url`` kategori ikonu."""

    __tablename__ = "product_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(140), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_categories.id", ondelete="SET NULL"), nullable=True
    )
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    products: Mapped[list["Product"]] = relationship(back_populates="category")

    __table_args__ = (
        Index(
            "uq_product_categories_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_product_categories_parent", "parent_id"),
    )


class Product(Base, TimestampMixin, SoftDeleteMixin):
    """Mağaza ürünü. ``kind`` teslimat türünü (fiziksel/dijital), ``seller_type``
    satıcıyı (platform/eğitmen) belirler. Fiyat sunucuda otoritedir (istemciye
    güvenilmez). ``stock`` yalnız PHYSICAL'de anlamlı; ``digital_asset_key`` yalnız
    DIGITAL'de (MinIO object key — indirme imzalı/proxy URL ile sunulur)."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(280), nullable=False)
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    seller_type: Mapped[str] = mapped_column(String(10), nullable=False)
    tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutors.id", ondelete="SET NULL"), nullable=True
    )

    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    # Üzeri çizili "eski fiyat" (D&R indirim rozeti). Doluysa price'tan büyük olmalı.
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )
    # Yalnız PHYSICAL: kalan stok. DIGITAL'de NULL (sınırsız).
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Kargo ağırlık ipucu (ileride il/ağırlık bazlı tarife için). MVP'de bilgi amaçlı.
    weight_grams: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── Kitap künyesi (hepsi opsiyonel; kitap-dışı/dijital üründe boş kalır, gösterilmez).
    # D&R/Kitapseç/Trendyol "Ürün Özellikleri" tablosunun karşılığı; schema.org Book'a eşlenir.
    author: Mapped[str | None] = mapped_column(String(200), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(200), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dimensions: Mapped[str | None] = mapped_column(String(40), nullable=True)
    publication_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edition: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cover_type: Mapped[str | None] = mapped_column(String(40), nullable=True)

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_categories.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'DRAFT'")
    )

    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # DIGITAL teslimat: yüklenen dosyanın object key'i + gösterim adı.
    digital_asset_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    digital_asset_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    rating_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    rating_sum: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    created_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    category: Mapped["ProductCategory | None"] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order, ProductImage.id",
    )
    reviews: Mapped[list["ProductReview"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_products_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_products_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_products_status", "status"),
        Index("ix_products_category", "category_id"),
        Index("ix_products_tutor", "tutor_id"),
        CheckConstraint(
            "compare_at_price IS NULL OR compare_at_price > price",
            name="ck_products_compare_price",
        ),
    )


class ProductImage(Base, TimestampMixin):
    """Ürün galeri görseli (One-to-Many). Object storage'a yüklenir; URL tutulur."""

    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    product: Mapped["Product"] = relationship(back_populates="images")


class ProductReview(Base, TimestampMixin, SoftDeleteMixin):
    """Ürün değerlendirmesi — satın-alma-gated (yalnız o ürünü PAID siparişte alan
    müşteri puanlayabilir; LibraryReview'dan farkı bu kapı). Ürün başına müşteri
    başına tek aktif kayıt. ``product.rating_sum/rating_count`` serviste güncellenir."""

    __tablename__ = "product_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    product: Mapped["Product"] = relationship(back_populates="reviews")
    client: Mapped["Client"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "rating BETWEEN 1 AND 5", name="ck_product_reviews_rating_range"
        ),
        Index(
            "uq_product_reviews_client_active",
            "product_id",
            "client_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_product_reviews_product", "product_id"),
    )


class Order(Base, TimestampMixin, SoftDeleteMixin):
    """Mağaza siparişi. Ödeme bilgisi gömülüdür (ExamRegistration/Payment deseni;
    Order 1:1 ödeme — doğrudan satış, escrow değil). Tutarlar (subtotal/shipping/
    total) **sunucuda** hesaplanır. Kargo adresi sipariş anında snapshot'lanır
    (ClientAddress sonradan silinse de sipariş bozulmaz)."""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=text("'PENDING'")
    )

    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    shipping_fee: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    # Kupon indirimi (sipariş anında snapshot; total = subtotal - discount + shipping).
    discount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    coupon_id: Mapped[int | None] = mapped_column(
        ForeignKey("coupons.id", ondelete="SET NULL"), nullable=True
    )
    coupon_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )

    # ── Gömülü ödeme ──
    payment_status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paid_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refunded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Kargo adresi snapshot (yalnız fiziksel kalem varsa dolu) ──
    has_physical: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    ship_recipient: Mapped[str | None] = mapped_column(String(150), nullable=True)
    ship_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ship_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    ship_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ship_district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tracking_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    client: Mapped["Client"] = relationship()
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderItem.id",
    )
    returns: Mapped[list["OrderReturn"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderReturn.id",
    )

    __table_args__ = (Index("ix_orders_status", "status"),)


class OrderItem(Base, TimestampMixin):
    """Sipariş kalemi. Ürün bilgisi snapshot'lanır (ürün sonradan değişse/silinse de
    sipariş tutarlı kalır). Eğitmen dijital kaleminde komisyon bölüşümü (sipariş PAID
    olunca ``commission.split`` ile) doldurulur; platform kaleminde NULL."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(250), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    seller_type: Mapped[str] = mapped_column(String(10), nullable=False)
    tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("tutors.id", ondelete="SET NULL"), nullable=True
    )
    # Dijital teslimat snapshot'ı (indirme ürün değişse de çalışsın).
    digital_asset_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    digital_asset_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Eğitmen payı (yalnız seller_type=TUTOR); platform kaleminde NULL.
    commission_rate: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    commission_amount: Mapped[float | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    tutor_earning: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    order: Mapped["Order"] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        Index("ix_order_items_tutor", "tutor_id"),
        Index("ix_order_items_product", "product_id"),
    )


class Coupon(Base, TimestampMixin, SoftDeleteMixin):
    """İndirim kuponu (admin küratörlüğünde). Yüzde veya sabit TL indirim; minimum
    sepet, geçerlilik penceresi, global (``max_uses``) ve kullanıcı-başı
    (``per_user_limit``) kullanım sınırı. Kullanım PAID olunca ``CouponRedemption``
    ile sayılır; iptal/iade'de geri salınır."""

    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    discount_type: Mapped[str] = mapped_column(String(10), nullable=False)
    discount_value: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    min_subtotal: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    per_user_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True, server_default=text("1")
    )
    used_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    valid_from: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    valid_until: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    redemptions: Mapped[list["CouponRedemption"]] = relationship(
        back_populates="coupon", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("discount_value > 0", name="ck_coupons_discount_positive"),
        # Aktif (silinmemiş) kuponlarda kod benzersiz.
        Index(
            "uq_coupons_code_active",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class CouponRedemption(Base, TimestampMixin):
    """Kupon kullanım kaydı (kullanıcı-başı/global sınır denetimi için)."""

    __tablename__ = "coupon_redemptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    coupon_id: Mapped[int] = mapped_column(
        ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )

    coupon: Mapped["Coupon"] = relationship(back_populates="redemptions")


class OrderReturn(Base, TimestampMixin):
    """Sipariş iade talebi (RMA). Yalnız kargolanmış/teslim edilmiş **fiziksel**
    sipariş için (dijitalde cayma istisnası — iade yok). Müşteri gerekçe yazar
    (PENDING); admin onaylar (→ sağlayıcı iadesi + stok geri + sipariş REFUNDED)
    veya reddeder. Sipariş başına tek **açık** (PENDING) talep (kısmi unique index)."""

    __tablename__ = "order_returns"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    order: Mapped["Order"] = relationship(back_populates="returns")

    __table_args__ = (
        Index("ix_order_returns_status", "status"),
        # Sipariş başına yalnız tek açık (bekleyen) iade talebi.
        Index(
            "uq_order_returns_open",
            "order_id",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
    )


class StockNotification(Base, TimestampMixin):
    """Stok-bitince bildirim aboneliği. Tükenen fiziksel ürüne abone olunur; stok
    0→>0 olunca abonelere e-posta atılır (``notified_at`` dolar = tüketildi). Anonim
    de abone olabilir (yalnız e-posta). Ürün+e-posta başına tek bekleyen kayıt."""

    __tablename__ = "stock_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
    )
    notified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "uq_stock_notif_pending",
            "product_id",
            "email",
            unique=True,
            postgresql_where=text("notified_at IS NULL"),
        ),
    )
