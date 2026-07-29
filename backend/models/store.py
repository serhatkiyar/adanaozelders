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
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
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
from models.mixins import ModeratableMixin, SoftDeleteMixin, TimestampMixin


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
    """Siparişin ödeme durumu (sipariş yaşam döngüsü ``OrderStatus``'ten ayrıdır).

    ``REFUNDING`` iki fazlı iadenin niyet (intent) durumudur: sağlayıcıya iade
    çağrısı yapılmadan ÖNCE commit edilir, böylece süreç HTTP çağrısı sırasında
    ölse bile kayıt sarkan REFUNDING olarak kalır ve reconciler devralır.
    Onsuz, sağlayıcıda para iade edilip commit düşerse sipariş PAID görünür,
    stok geri yüklenmez ve yeniden denendiğinde ikinci iade gönderilirdi.
    """

    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUNDING = "REFUNDING"
    REFUNDED = "REFUNDED"


class DeliveryPref(str, enum.Enum):
    """Müşterinin teslimat talimatı (Hepsijet paritesi). Sipariş üzerinde yaşar —
    durak "deneme"dir, talimat kalıcıdır; kurye ekranı stop.order'dan okur.
    KAPIYA/KOMSUYA'da teslim OTP'siz foto kanıtla (proof=PHOTO) kapanır.
    ERTESI_GUN ve adres değişikliği tercih değil AKSİYONDUR (ayrı uçlar)."""

    ADRESIMDEYIM = "ADRESIMDEYIM"
    KAPIYA_BIRAK = "KAPIYA_BIRAK"
    KOMSUYA_BIRAK = "KOMSUYA_BIRAK"
    BENI_ARA = "BENI_ARA"


class ReturnStatus(str, enum.Enum):
    """İade TALEBİNİN durumu (paranın durumu ayrı: ``ReturnRefundStatus``).

    ``CAYMA`` türündeki talepler doğrudan APPROVED açılır — satıcının ret
    yetkisi yoktur (bkz. ReturnType).
    """

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class ReturnType(str, enum.Enum):
    """İadenin hukuki dayanağı — onay akışını belirler.

    ``CAYMA``: Mesafeli Sözleşmeler Yönetmeliği m.9 uyarınca tüketici, teslimden
    itibaren 14 gün içinde **hiçbir gerekçe göstermeden ve cezai şart ödemeden**
    cayabilir. Satıcı bunu REDDEDEMEZ; yalnızca yönetmelik m.15'teki istisnalar
    (dijital içerik, kişiye özel üretim, hijyen ürünleri…) uygulanır. Bu yüzden
    talep otomatik onaylanır ve iade süreci hemen başlar.

    ``AYIPLI``: Tüketicinin Korunması Hakkında Kanun m.8-11 (ayıplı mal). Süre
    daha uzundur ve satıcının ürünü inceleme hakkı vardır → admin onay akışı.

    ``DIGER``: yanlış ürün, eksik gönderim vb. → admin onay akışı.

    ÖNEMLİ: Eski akış tek tipti ve admin CAYMA taleplerini de reddedebiliyordu;
    bu, koşulsuz cayma hakkının ihlaliydi.
    """

    CAYMA = "CAYMA"
    AYIPLI = "AYIPLI"
    DIGER = "DIGER"


class ReturnRefundStatus(str, enum.Enum):
    """İade talebine bağlı PARANIN durumu (iki fazlı; bkz. services/escrow.py).

    Talebin durumundan ayrıdır: bir talep APPROVED olabilir ama para henüz
    sağlayıcıda kesinleşmemiş olabilir. Kısmi iade mümkün olduğundan sipariş
    tek başına "iade edildi mi?" sorusunu cevaplayamaz — bu yüzden para durumu
    TALEP üzerinde izlenir ve bir siparişte birden çok kısmi iade olabilir.
    """

    NONE = "NONE"
    REFUNDING = "REFUNDING"
    REFUNDED = "REFUNDED"


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
    # NOT: Fiyat Etiketi Yönetmeliği indirim duyurusunda son 30 günün EN DÜŞÜK
    # fiyatının esas alınmasını ister; serbest girilen bir "eski fiyat" denetimde
    # sorun çıkarır. Gerçek referans `product_price_history`'den türetilmelidir.
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    # KDV oranı (0.00–1.00). Türkiye'de basılı kitap %0, kırtasiye ve dijital
    # ürün %20'dir; tek oran varsayımıyla yasal fatura kesilemez. Fiyatlar KDV
    # DAHİL gösterilir (perakende zorunluluğu), bu oran faturadaki matrah/vergi
    # ayrıştırması için tutulur.
    tax_rate: Mapped[float] = mapped_column(
        Numeric(5, 4), nullable=False, server_default=text("0")
    )
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
        # Başlık üzerinde trigram: mağaza araması `search_vector @@ tsquery OR
        # title % :q` şeklinde çalışır. TSVECTOR index'i tek başına OR'un ikinci
        # kolunu karşılamadığı için planlayıcı tüm ürünleri tarıyordu; iki GIN
        # index birlikte BitmapOr'a izin verir. Yazım hatasına toleransı da bu
        # kol sağlar ("matematık" → "matematik").
        Index(
            "ix_products_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        Index("ix_products_status", "status"),
        # Yönetim ürün listesi ve "yeni eklenenler" sıralaması.
        Index(
            "ix_products_created_desc",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
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


class ProductReview(Base, TimestampMixin, SoftDeleteMixin, ModeratableMixin):
    """Ürün değerlendirmesi — satın-alma-gated (yalnız o ürünü PAID siparişte alan
    müşteri puanlayabilir; LibraryReview'dan farkı bu kapı). Ürün başına müşteri
    başına tek aktif kayıt. ``product.rating_sum/rating_count`` serviste güncellenir."""

    __tablename__ = "product_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    # index: "bu müşteri bu ürüne yorum yapmış mı" ve müşterinin yorum listesi.
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
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
    #: Bu siparişten şimdiye dek iade edilen TOPLAM tutar (kısmi iadeler dahil).
    #: Kısmi iade sonrası sipariş PAID kalır — mal kısmen müşterededir — bu
    #: yüzden "iade edildi mi?" sorusu tek başına payment_status'ten okunamaz.
    refunded_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    # ── İki fazlı iade niyeti (bkz. services/escrow.py) ──
    # REFUNDING'e geçiş bu damgayla birlikte COMMIT edilir; sağlayıcı çağrısı
    # sonra yapılır. Sarkan kayıtları reconciler bu iki alandan bulur.
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
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
    # Harita pin'i (ClientAddress.location_lat/lng snapshot'ı) — kendi-filo
    # teslimat rotası için otorite; adres metni tarif/yedek.
    ship_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    ship_lng: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    # Kendi-filo bölge snapshot'ı (sipariş anında delivery_promise.in_delivery_zone):
    # True=Adana Merkez (Cıncık Teslimat), False=bölge dışı (dış kargo kuyruğu),
    # None=belirlenemedi (pin+il/ilçe yok). Adres değişirse yeniden hesaplanır.
    ship_in_zone: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Söz verilen teslim günü (yerel takvim günü) — ödeme kesinleşince 16:00
    # cutoff kuralıyla hesaplanır (delivery_promise.compute_promised_date).
    promised_delivery_date: Mapped[datetime.date | None] = mapped_column(
        Date, nullable=True, index=True
    )
    # Müşteri teslimat talimatı (DeliveryPref) + notu (KOMSUYA_BIRAK'ta komşu
    # adı/daire zorunlu). Erteleme sayacı kötüye kullanım sınırı içindir (max 2).
    delivery_pref: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'ADRESIMDEYIM'")
    )
    delivery_pref_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    postpone_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Başarısız teslim DENEMESİ sayacı (kurye/sistem kaynaklı FAILED; müşteri
    # ertelemesi RESCHEDULED'dır, SAYILMAZ). Üç-deneme kuralının (Faz 5) ve
    # ilk-denemede-teslim KPI'ının hammaddesi.
    failed_delivery_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # Hazırlama istasyonu (Faz 2, PDS O1): depo görevlisi paketi toplayıp etiketi
    # basınca damgalanır. Yalnız hazırlanmış (prepared_at NOT NULL) fiziksel
    # sipariş tura eklenebilir — hazırlanmamış paket sahaya çıkamaz. Teslim
    # başarısız olup sipariş PAID'e dönerse sıfırlanır (paket depoya geri döner).
    prepared_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    prepared_by: Mapped[str | None] = mapped_column(String(60), nullable=True)
    tracking_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Teslim anı (DELIVERED geçişinde order_fsm damgalar) — iade penceresinin
    # (RETURN_WINDOW_DAYS) başlangıcı ve "son iade tarihi" bilgisinin dayanağı.
    delivered_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Oturumsuz (SMS'le paylaşılan) kargo takip token'ı — tahmin edilemez, tekil.
    # tracking_no (ELDEN-R{run}-S{stop}) sıralı/enumerate edilebilir olduğundan public
    # takipte KULLANILMAZ; bu token Collection.share_token desenini izler.
    track_token: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True,
        default=lambda: uuid.uuid4().hex,
    )

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

    __table_args__ = (
        Index("ix_orders_status", "status"),
        # Dağıtım kuyruğu sorguları (eligible/outsourced/kapasite sayımı):
        # açık fiziksel siparişler söz gününe göre — kısmi index, orders
        # tablosu (dijital dahil) büyüse de kuyruk sorgusu index'te kalır.
        Index(
            "ix_orders_fulfillment_queue",
            "promised_delivery_date",
            postgresql_where=text(
                "status = 'PAID' AND payment_status = 'PAID' "
                "AND has_physical AND deleted_at IS NULL"
            ),
        ),
        # Admin sipariş listesi (created_at DESC LIMIT n) — bu index olmadan
        # 50.000 satırın tamamı okunup sıralanıyordu (ölçüm: 140 ms).
        Index(
            "ix_orders_created_desc",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Müşterinin "siparişlerim" listesi: sahibine göre en yeniden eskiye.
        Index(
            "ix_orders_client_created",
            "client_id",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class OrderStatusHistory(Base, TimestampMixin):
    """Sipariş durum geçiş denetim kaydı. ``order_fsm.transition_order`` her geçerli
    geçişte bir satır yazar (eski→yeni durum, kim değiştirdi, gerekçe) — "bu sipariş
    neden/ne zaman şu duruma geçti" sorusunun kalıcı cevabı. audit_logs admin-aksiyon
    odaklı olduğundan (aktör = admin) sipariş yaşam döngüsü ayrı tabloda tutulur;
    aktör 'system:payment'/'courier'/'admin'/'client' gibi serbest metindir."""

    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    old_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    new_status: Mapped[str] = mapped_column(String(12), nullable=False)
    changed_by: Mapped[str] = mapped_column(String(60), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


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
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
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

    # KDV snapshot'ı: ürünün oranı sonradan değişse bile FATURA sipariş anındaki
    # oranla kesilmelidir. `unit_price` KDV DAHİL tutardır; `tax_amount` o
    # tutarın içindeki vergiyi gösterir (matrah = satır toplamı − tax_amount).
    tax_rate: Mapped[float] = mapped_column(
        Numeric(5, 4), nullable=False, server_default=text("0")
    )
    tax_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )

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
    # index: iade/iptal yolu kuponu siparişten geri almak için buradan arar.
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
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
    #: Cayma hakkında gerekçe ZORUNLU DEĞİLDİR (koşulsuzdur); yine de müşteri
    #: isterse yazabilir. Ayıplı/diğer taleplerde servis katmanı zorunlu kılar.
    reason: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    #: Hukuki dayanak — onay akışını belirler (bkz. ReturnType).
    type: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'DIGER'")
    )
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PENDING'")
    )
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Para (iki fazlı iade; talep bazında izlenir) ──
    #: Bu talep için iade edilecek/edilen tutar. Kısmi iadede seçilen kalemlerin
    #: toplamı, tam iadede sipariş toplamıdır (kargo dahil).
    refund_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    refund_status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'NONE'")
    )
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    #: Sağlayıcıdaki iade işlem kimliği (kısmi iadede tam-tutar idempotency'si
    #: geçersizdir; her iade ayrı izlenmelidir).
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    refunded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Tüm sipariş mi iade edildi (kargo dahil) yoksa bazı kalemler mi?
    is_partial: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    order: Mapped["Order"] = relationship(back_populates="returns")
    items: Mapped[list["OrderReturnItem"]] = relationship(
        back_populates="order_return", cascade="all, delete-orphan"
    )

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


class OrderReturnItem(Base):
    """Kısmi iadede hangi kalemden kaç adet iade edildiği.

    Önceden iade daima TÜM sipariş tutarıydı: 3 kitaplık siparişten 1 kitap
    iade edilince ya tamamı geri ödeniyordu (doğrudan zarar) ya da talep
    reddediliyordu — ki cayma hakkında reddetmek de yasal değil.
    """

    __tablename__ = "order_return_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    return_id: Mapped[int] = mapped_column(
        ForeignKey("order_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Bu satırın iade tutarı (birim fiyat × adet, KDV dahil) — sipariş anındaki
    #: fiyattan hesaplanır ve snapshot'lanır.
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    order_return: Mapped["OrderReturn"] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_return_items_quantity"),
        # Aynı kalem bir talepte iki kez yer alamaz.
        Index(
            "uq_order_return_item",
            "return_id",
            "order_item_id",
            unique=True,
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
        ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True
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


class Collection(Base, TimestampMixin, SoftDeleteMixin):
    """Müşteri koleksiyonu (Trendyol "Listelerim"). Favorilerden ayrı, kalıcı (DB).
    ``share_token`` ile public paylaşım linki üretilir; içerik ``collection_items``
    üzerinden ürünlere bağlanır (ürün silinirse FK CASCADE ile öğe düşer)."""

    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    share_token: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, index=True,
        default=lambda: uuid.uuid4().hex,
    )

    client: Mapped["Client"] = relationship()
    items: Mapped[list["CollectionItem"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionItem.created_at.desc()",
    )


class CollectionItem(Base, TimestampMixin):
    """Koleksiyondaki ürün. Koleksiyon başına ürün tekildir (unique index)."""

    __tablename__ = "collection_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )

    collection: Mapped["Collection"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()

    __table_args__ = (
        Index(
            "uq_collection_item", "collection_id", "product_id", unique=True
        ),
    )


class ProductPriceHistory(Base):
    """Ürün fiyat değişikliği kaydı — indirim duyurusunun yasal dayanağı.

    Fiyat Etiketi Yönetmeliği, indirimli satış duyurusunda indirimden ÖNCEKİ
    30 gün içindeki EN DÜŞÜK fiyatın esas alınmasını ister. Önceden fiyat
    ``update_product`` içinde yerinde eziliyordu ve hiçbir iz kalmıyordu; buna
    karşılık ürün sayfasında serbestçe girilen bir ``compare_at_price`` üzeri
    çizili gösteriliyordu. Bu, Ticaret Bakanlığı denetiminde doğrudan ceza
    kalemidir.

    Satırlar SİLİNMEZ (soft-delete yok): geçmiş fiyat kanıtıdır.
    """

    __tablename__ = "product_price_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    #: Değişikliği yapan admin (sistem/seed kaynaklıysa NULL).
    changed_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )
    changed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        # "Son 30 günün en düşüğü" sorgusu: ürün + tarih aralığı.
        Index("ix_product_price_history_lookup", "product_id", "changed_at"),
    )
