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
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import Computed, FetchedValue

from core.database import Base
from core.order_no import generate_order_no
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

    ``MANUAL_REVIEW`` (İP-2a/PK-δ): otomatik deneme tavanı (`REFUND_MAX_ATTEMPTS`)
    dolduğunda kayıt REFUNDING'de BIRAKILMAZ — sessiz `logger.error` tek başına
    "müşterinin parası askıda" durumunu görünmez kılıyordu. Bu durum ne kesin
    başarısızlık ne kesin iadedir: otomatik reconciler bir daha sağlayıcıya
    göndermez, kayıt admin kuyruğundan sorgulanabilir, `REFUNDED` yalnız gerçek
    sağlayıcı başarısından sonra yazılır.
    """

    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUNDING = "REFUNDING"
    REFUNDED = "REFUNDED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


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

    ``MANUAL_REVIEW`` (İP-2a/PK-δ): otomatik deneme tavanı dolan sarkan iade.
    Bkz. ``OrderPaymentStatus.MANUAL_REVIEW``.
    """

    NONE = "NONE"
    REFUNDING = "REFUNDING"
    REFUNDED = "REFUNDED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


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
        ForeignKey("product_categories.id", ondelete="RESTRICT"), nullable=True
    )
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # Kategorinin VARSAYILAN KDV oranı (0 ≤ oran < 1) — admin ürün formunun
    # ön-doldurma kaynağı. NULL = varsayılan yok (bugünkü davranış birebir).
    #
    # ⚠️ DEĞERLER MALİ MÜŞAVİR ONAYI BEKLİYOR: kodda/migration'da/seed'de
    # hiçbir oran YAZILMAZ; kolon NULL doğar, oranlar onay sonrası admin
    # panelinden girilir. Sunucu bu koldan ASLA oran türetmez —
    # `Product.tax_rate` ürün başına zorunlu VERİDİR ve tek otoritedir
    # (bkz. schemas/store.py::_TAX_RATE_FIELD_ARGS notu). Miras kuralı
    # (yaprak NULL → yaprağa en yakın dolu ata) `inherited_default_tax_rate`
    # ile SUNUM anında çözülür, kolona yazılmaz.
    default_tax_rate: Mapped[float | None] = mapped_column(
        Numeric(5, 4), nullable=True
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
        # Sınır: oran birimi ORAN'dır (0.20 = %20), yüzde değil — Product
        # tarafındaki sözleşmeyle aynı. Sayısal bir ORAN DEĞERİ içermez.
        CheckConstraint(
            "default_tax_rate IS NULL "
            "OR (default_tax_rate >= 0 AND default_tax_rate < 1)",
            name="ck_product_categories_default_tax",
        ),
    )


#: Varyant eksen adlarının KONTROLLÜ sözlüğü. Serbest metin bilinçli olarak
#: yasak: aynı kavram "Renk"/"renk"/"Colour" diye üç ada bölünürse mağaza
#: filtreleri (facet) ve varyant seçici birbirini bulamaz. Sözlük kodda bir
#: sabittir (tablo veya PG enum değil) çünkü:
#:   * eksen eklemek bir ŞEMA/ÜRÜN KARARIDIR, operasyon verisi değil — tablo
#:     olsaydı admin CRUD yüzeyi açılır ve serbest büyüme geri gelirdi;
#:   * PG enum'u `ALTER TYPE ... ADD VALUE` ister ve yeniden adlandırma/silme
#:     pratikte yoktur — sabit + CHECK aynı DB garantisini verir, migration'ı
#:     sıradan bir constraint değişikliğidir;
#:   * sabit, Pydantic şemasında ve frontend'de tek kaynaktan doğrulanabilir.
#: Yeni eksen = bu tuple'a ekle + CHECK'i yenileyen migration (bilinçli adım).
VARIANT_AXES: tuple[str, ...] = (
    "Renk",
    "Ebat",
    "Uç Kalınlığı",
    "Çizgi Tipi",
    "Yaprak Sayısı",
    "Kapak Tipi",
    "Gramaj",
    "Paket Adedi",
)

#: CHECK gövdelerinde kullanılan SQL listesi ('Renk','Ebat',…).
_AXES_SQL = ", ".join(f"'{a}'" for a in VARIANT_AXES)


class VariantGroup(Base, TimestampMixin, SoftDeleteMixin):
    """Varyant grubu — aynı ürünün alış seçenekleri (Trendyol deseni).

    Her varyant `products` tablosunda TAM TEŞEKKÜLLÜ bir üründür (kendi SKU'su,
    barkodu, stoğu, fiyatı, defter zinciri); grup yalnız "bunlar aynı ürünün
    seçenekleridir" bilgisini ve eksen ADLARINI taşır. Eksen DEĞERLERİ üründe
    (`option1_value`/`option2_value`) durur. Varyant adı ayrı kolonda DEĞİL,
    ürün `title`'ında yaşar ("Fosforlu Kalem - Sarı"): sipariş kalemi snapshot'ı
    (`OrderItem.title`) böylece kendiliğinden doğru kalır, ayrıca seçenek
    snapshot'ı gerekmez.
    """

    __tablename__ = "variant_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Grubun ortak adı (varyant seçicinin başlığı) — üyelerin title'ından ayrı.
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    #: 1. eksenin adı (VARIANT_AXES sözlüğünden; CHECK ile zorlanır).
    option1_name: Mapped[str] = mapped_column(String(30), nullable=False)
    #: 2. eksen opsiyonel; doluysa 1.'den farklı bir sözlük adı olmalı.
    option2_name: Mapped[str | None] = mapped_column(String(30), nullable=True)

    products: Mapped[list["Product"]] = relationship(
        back_populates="variant_group",
        order_by="Product.variant_sort, Product.id",
    )

    __table_args__ = (
        CheckConstraint(
            f"option1_name IN ({_AXES_SQL})",
            name="ck_variant_groups_opt1_axis",
        ),
        CheckConstraint(
            f"option2_name IS NULL OR option2_name IN ({_AXES_SQL})",
            name="ck_variant_groups_opt2_axis",
        ),
        # Aynı eksen iki kez seçilemez ("Renk × Renk" anlamsız kombinasyon).
        CheckConstraint(
            "option2_name IS NULL OR option2_name <> option1_name",
            name="ck_variant_groups_axes_distinct",
        ),
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
    # Yalnız PHYSICAL: kalan stok. DIGITAL'de NULL — bu "stoğu 0" DEĞİL,
    # "stok takip edilmiyor" demektir (bkz. services/stock_ledger.py).
    #
    # DİKKAT: bu alana doğrudan atama yapılmaz. Tek yazıcı
    # `services/stock_ledger.py::apply_movement`'tır; her değişim aynı
    # transaction'da bir `stock_movements` satırı üretir. Kural bir kabul
    # testiyle (AST) korunur: tests/acceptance/test_stock_ledger_contract.py
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # İşletmede duran ama SATILAMAZ miktar (kırık, ıslak, baskı hatalı…).
    # `stock`'un NULL semantiğine bağlıdır: dijital üründe stok takip
    # edilmediği için hasarlı kova da YOKTUR (NULL), "0 hasarlı" DEĞİL.
    # İkisinin eşleşmesi `ck_products_damaged_pairing` CHECK'iyle ve
    # `products_damaged_pairing` trigger'ıyla korunur — trigger, kolonu bilmeyen
    # her yazıcıda (ürün oluşturma, CSV içe aktarma, seed, ham SQL) değeri
    # otomatik doğru kurar. Bu yüzden ORM tarafında `FetchedValue`.
    # Tek yazıcı `services/stock_ledger.py`'dir; `stock` ile aynı disiplin.
    damaged_stock: Mapped[int | None] = mapped_column(
        Integer, nullable=True, server_default=FetchedValue()
    )

    # ── Stok kalemi kimliği ──
    # `sku` = BİZİM stok kalemi kimliğimiz. Değeri `(kind, id)`'nin fonksiyonudur
    # (`FZK-000042` / `DIJ-000007`) ve **BEFORE INSERT trigger'ı** tarafından
    # yazılır (`products_sku_autofill`) — verilen değer EZİLİR, taklit edilemez.
    # Bu yüzden ORM tarafında `FetchedValue`: SQLAlchemy değeri sunucudan okur.
    # `sku` ve `kind` bir BEFORE UPDATE trigger'ıyla değiştirilemez kılınmıştır
    # (`products_identity_immutable`) — SKU immutable olmalı ve öneği `kind`'e
    # bağlı olduğu için `kind` de sabit kalmak zorunda.
    sku: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=FetchedValue()
    )
    # `barcode` = ELİMİZDEKİ FİZİKSEL KALEMİN ÜZERİNDE OKUNAN dizgi (EAN-13/UPC).
    # `isbn`'den ayrıdır ve ondan ASLA otomatik kopyalanmaz:
    #   • kitap olmayan üründe (kalem, defter) EAN var, ISBN yok;
    #   • set/paket ürünün kendi barkodu içindeki kitapların ISBN'inden farklı;
    #   • ISBN-10 basımlarda kapaktaki barkod ISBN'in EAN-13 dönüşümüdür;
    #   • bazı baskılar promosyon barkodu taşır.
    # ISBN'i barkoda kopyalamak, "okuttum, eşleşti" güvenini yanlış bir
    # eşleşmeye dayandırırdı. Yalnız insan girdisiyle dolar.
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
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
        ForeignKey("product_categories.id", ondelete="RESTRICT"), nullable=True
    )

    # ── Varyant üyeliği (Faz 1) ──
    # RESTRICT bilinçli (SET NULL değil): grup silinirken FK yalnız bu kolonu
    # NULL'lar, option değerleri kalır ve satır `ck_products_variant_orphan`'a
    # çarpardı — yani SET NULL zaten çalışamazdı. Grubu çözmek servis işidir
    # (üyeleri tek tek gruptan çıkar, sonra grubu soft-delete et).
    variant_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("variant_groups.id", ondelete="RESTRICT"), nullable=True
    )
    #: Grubun 1./2. ekseni için BU ürünün değeri ("Kırmızı", "A4"). Eksen ADI
    #: grupta durur; değer serbest metindir (değer sözlüğü yok — "Kırmızı" ile
    #: "Bordo" ürün kararıdır, facet karışması eksen adında yaşanır).
    option1_value: Mapped[str | None] = mapped_column(String(60), nullable=True)
    option2_value: Mapped[str | None] = mapped_column(String(60), nullable=True)
    #: Varyant seçicideki el sırası (grup içinde; grupsuz üründe anlamsız, 0).
    variant_sort: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'DRAFT'")
    )

    # ── Tedarikçiden temin (Yıldırım B2B) ──
    # "Kendi stoğum bitince tedarikçinin stoğu vitrinde satılabilir sayılsın."
    # Bir MERCHANDISING kararıdır, bağın kendisi değil: bağ çözülüp yeniden
    # kurulunca kaybolmamalı ve "temin açık ama hiçbir tedarikçiye bağlı değil"
    # uyarısı ancak böyle ifade edilebilir. Uygunluk yüklemi
    # `core/stock_policy.satilabilir_yuklemi`; stok verisi `supplier_products`.
    #
    # `stock` sözleşmesine DOKUNMAZ: tedarikçi stoğu asla `stock`'a yazılmaz
    # (`docs/tedarikci-senkron-sozlesme.md` D-1).
    supplier_backed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
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

    # ISBN ve SKU vektörde: barkod okuyucu ISBN'i klavye girdisi olarak yazar
    # ve müşteri de yönetici de kitabı numarasıyla arayabilmeli. Tam eşleşme
    # yolu ayrıdır (`store_service._arama_kolu`): 13 haneli saf rakam dizisi
    # trigram'a DÜŞMEZ, çünkü komşu ISBN başka bir kitaptır.
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', tr_normalize("
            "coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || "
            "coalesce(author, '') || ' ' || coalesce(publisher, '') || ' ' || "
            "coalesce(isbn, '') || ' ' || coalesce(sku, '')))",
            persisted=True,
        ),
        nullable=True,
    )

    category: Mapped["ProductCategory | None"] = relationship(back_populates="products")
    variant_group: Mapped["VariantGroup | None"] = relationship(
        back_populates="products"
    )
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
        # ISBN tam eşleşmesi (`_arama_kolu`'nun 13 hane dalı) bu index'i
        # kullanır. Önek (`LIKE 'x%'`) dalı kullanamaz — bilinçli sadelik,
        # gerekçesi migration dosyasında.
        Index("ix_products_isbn", "isbn"),
        Index("ix_products_status", "status"),
        # Vitrin yüklemi her katalog sorgusunda `supplier_backed`'e bakar;
        # ürünlerin büyük çoğunluğu `false` olduğu için kısmi index planlayıcıya
        # ucuz bir kısa devre verir.
        Index(
            "ix_products_supplier_backed",
            "supplier_backed",
            postgresql_where=text("supplier_backed AND deleted_at IS NULL"),
        ),
        # Yönetim ürün listesi ve "yeni eklenenler" sıralaması.
        Index(
            "ix_products_created_desc",
            text("created_at DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_products_category", "category_id"),
        Index("ix_products_tutor", "tutor_id"),
        # SKU'da TAM unique (slug'ın aksine kısmi DEĞİL): SKU `id`'nin
        # fonksiyonu olduğu için silinmiş bir satırla çakışması imkânsız ve tam
        # unique daha güçlü bir garanti verir. Trigger'ı düşen bir ortamda son
        # savunma olarak da kalır.
        Index("uq_products_sku", "sku", unique=True),
        # Barkod: yalnız dolu ve silinmemiş satırlarda tekil.
        Index(
            "uq_products_barcode_active",
            "barcode",
            unique=True,
            postgresql_where=text("barcode IS NOT NULL AND deleted_at IS NULL"),
        ),
        CheckConstraint(
            "compare_at_price IS NULL OR compare_at_price > price",
            name="ck_products_compare_price",
        ),
        CheckConstraint(
            "status <> 'ACTIVE' OR category_id IS NOT NULL",
            name="ck_products_active_category",
        ),
        # Hasarlı kova, satılabilir kovanın takip semantiğine bağlıdır: stok
        # takip edilmiyorsa (dijital) hasarlı da izlenmez. "Takip edilmiyor" ile
        # "sıfır hasarlı" farklı iki gerçektir ve karıştırılmaz.
        CheckConstraint(
            "(stock IS NULL) = (damaged_stock IS NULL)",
            name="ck_products_damaged_pairing",
        ),
        # Kırpma yasağının hasarlı kovadaki karşılığı.
        CheckConstraint(
            "damaged_stock IS NULL OR damaged_stock >= 0",
            name="ck_products_damaged_sign",
        ),
        # ── Varyant değişmezleri (Faz 1) ──
        # Gruba giren ürün rafta fiziksel olarak ayırt edilmek zorundadır:
        # barkodsuz iki varyant hazırlama/sayım ekranında birbirine karışır
        # (F26 sınıfı hata). Kural DB'de — CSV/seed/ham SQL de kaçamaz.
        CheckConstraint(
            "variant_group_id IS NULL OR barcode IS NOT NULL",
            name="ck_products_variant_barcode",
        ),
        # Gruptaki ürün 1. eksende bir değer TAŞIMAK zorunda; değersiz üye
        # varyant seçicide adsız bir şık olurdu.
        CheckConstraint(
            "variant_group_id IS NULL OR option1_value IS NOT NULL",
            name="ck_products_variant_opt1",
        ),
        # 2. eksen değeri 1.'siz olamaz (eksenler sıralı dolar).
        CheckConstraint(
            "option2_value IS NULL OR option1_value IS NOT NULL",
            name="ck_products_variant_opt2",
        ),
        # Grupsuz üründe option değeri olamaz: gruptan çıkarılan ürünün
        # değerleri de temizlenmek ZORUNDA kalır — bayat "Kırmızı" etiketi
        # taşıyan bağımsız ürün kalmaz.
        CheckConstraint(
            "variant_group_id IS NOT NULL "
            "OR (option1_value IS NULL AND option2_value IS NULL)",
            name="ck_products_variant_orphan",
        ),
        # Aynı kombinasyon grupta iki kez yazılamaz. NULLS NOT DISTINCT (PG 15+)
        # şart: tek eksenli grupta option2 hep NULL'dur ve PG varsayılanı
        # NULL'ları farklı saydığından tekillik sessizce devre dışı kalırdı.
        # Kısmi: silinmişler ve grupsuz ürünler (üçlüsü tamamen NULL) dışarıda.
        Index(
            "uq_products_variant_combo",
            "variant_group_id",
            "option1_value",
            "option2_value",
            unique=True,
            postgresql_nulls_not_distinct=True,
            postgresql_where=text(
                "deleted_at IS NULL AND variant_group_id IS NOT NULL"
            ),
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
    #: Müşteriye gösterilen KALICI sipariş numarası ("4827-1930-5612").
    #: `id` sıralıdır (sipariş hacmini sızdırır), `tracking_no` ise teslimat
    #: denemesine bağlıdır ve her başarısızlıkta değişir — ikisi de müşteri
    #: referansı olamaz. Üretim: `core.order_no.generate_order_no`.
    order_no: Mapped[str] = mapped_column(
        String(14),
        nullable=False,
        unique=True,
        index=True,
        default=generate_order_no,
    )
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

    # ── KDV kırılımı (İP-5) — sipariş anında hesaplanır ve SAKLANIR ──
    #
    # Anlık değerdir, görünüm DEĞİLDİR: ürünün oranı sonradan değişse bile
    # fatura sipariş anındaki oranla kesilmelidir. Bu yüzden okuma anında
    # yeniden hesaplanmaz (bkz. services/tax.py::order_breakdown).
    #
    # Hepsi NULL edilebilir ve varsayılanları YOKTUR. `0` ile `NULL` burada
    # farklı şeylerdir: `tax_total = 0` "vergi yok" demektir (ör. tamamen %0
    # oranlı sepet), `NULL` ise "kırılım hesaplanmadı" — İP-5 öncesi
    # siparişlerin ve geriye dönük hesaplanmayanların (S-4) durumu budur.
    # Sessizce 0 yazmak, hesaplanmamış bir vergiyi hesaplanmış göstermek olurdu.
    net_total: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    tax_total: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    #: Oran bazında [{"rate": "0.2000", "base": "...", "tax": "..."}] — tutarlar
    #: METİN olarak tutulur; JSON sayısı float'a çevirir ve kuruş kaybı kalıcılaşır.
    tax_breakdown: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    #: Kargoya uygulanan oran (settings.SHIPPING_TAX_RATE snapshot'ı).
    #: `NULL` + `shipping_fee > 0` → kırılım EKSİK: ayar henüz girilmemiş.
    #: Kaç siparişin bu durumda olduğu `GET /store/admin/tax-health` ile sayılır.
    shipping_tax_rate: Mapped[float | None] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    shipping_tax_amount: Mapped[float | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'TRY'")
    )

    # ── Gömülü ödeme ──
    # Uzunluk 20: `MANUAL_REVIEW` (13 karakter) String(10)'a sığmıyordu.
    payment_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'PENDING'")
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
    #: **Rezerve edilmiş** (claim edilmiş) toplam iade tutarı — para tavanının
    #: TEK otoritesi (İP-2a/M1).
    #:
    #: `refunded_amount` yalnız sağlayıcı BAŞARISINDAN sonra artar; oysa tavan
    #: kararı sağlayıcı çağrısından ÖNCE verilmek zorundadır. İkisi aynı kolondan
    #: okunursa iki eşzamanlı iade de "hiç iade yok" görüp tam tutarı ister ve
    #: sağlayıcıya ödenenden fazlası gider (İP2A-03/04). Bu kolon niyet anında,
    #: `refund_reserved + tutar <= total` koşullu UPDATE'iyle artırılır: koşul
    #: satır kilidi altında yeniden değerlendirildiği için tek kazanan olur.
    #:
    #: Değişmezler: `refunded_amount <= refund_reserved <= total`.
    #: Kalan iade edilebilir tutar `total - refund_reserved`'dır (refunded değil).
    refund_reserved: Mapped[float] = mapped_column(
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

    # Mağaza vitrini son-tıklama katkısı. İstemciden kimlikler değil, sunucu
    # imzalı ve süreli token gelir; servis doğruladıktan sonra snapshot'lanır.
    source_page_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("store_landing_page_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_block_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
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
        # Para raporu dönem filtresi (services/revenue_service.py). Kısmi:
        # ödenmemiş siparişler ciroya girmez, indekste yer kaplamasın.
        Index(
            "ix_orders_paid_at",
            "paid_at",
            postgresql_where=text("paid_at IS NOT NULL AND deleted_at IS NULL"),
        ),
        # Vergi kırılımı EKSİK siparişleri sayan kuyruk (`GET /store/admin/
        # tax-health`). Kısmi: sağlıklı siparişler indekste yer kaplamasın —
        # `SHIPPING_TAX_RATE` girildikten sonra bu küme küçülüp boşalmalıdır.
        #
        # Tanım `migrations/versions/ip5_siparis_vergi_kirilimi.py` ile
        # BİREBİR aynı olmak zorunda (ad, kolon, predikat): ayrışırsa
        # `alembic check` "remove_index" görür ve CI kırılır — ayrıca bir
        # sonraki `--autogenerate` bu index'i DROP eden migration üretir.
        Index(
            "ix_orders_tax_breakdown_missing",
            "created_at",
            postgresql_where=text(
                "deleted_at IS NULL AND ("
                "tax_breakdown IS NULL "
                "OR (shipping_fee > 0 AND shipping_tax_rate IS NULL))"
            ),
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

    # ── Tedarikçiden karşılanan adet (D-8) ──
    # Ödeme anında, ürün satırı KİLİTLİYKEN hesaplanır: `quantity` kadar malın
    # kaç tanesi rafımızda yoktu ve tedarikçiden getirilecek?
    #
    # İki yerde belirleyicidir:
    #   • `SALE` hareketi yalnız `quantity - supplier_quantity` kadar yazılır
    #     (rafa hiç girmemiş mal deftere giremez);
    #   • iptal/tam iadede geri yükleme tavanı bu adedi DÜŞER — düşmezse hiç
    #     satılmamış mal için stok artışı üretilir.
    #
    # Ayrıca operasyonel: admin bu kalemi Yıldırım'a sipariş edecek.
    supplier_quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    order: Mapped["Order"] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        # Tedarikçi payı sipariş adedini AŞAMAZ ve negatif olamaz.
        CheckConstraint(
            "supplier_quantity >= 0 AND supplier_quantity <= quantity",
            name="ck_order_items_supplier_qty",
        ),
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
    #: Talebe düşen KARGO iadesi payı. ``refund_amount`` bunu İÇERİR; kalem
    #: satırları içermez. Böylece dekont özdeşliği tek cümleyle ifade edilebilir
    #: (İP2A-15): ``refund_amount = Σ items.amount + shipping_refund``.
    shipping_refund: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    # Uzunluk 20: `MANUAL_REVIEW` (13 karakter) String(10)'a sığmıyordu.
    refund_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'NONE'")
    )
    refund_requested_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refund_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    #: Sağlayıcıdaki **tahsilat** işlem kimliği (iyzico `paymentTransactionId`)
    #: — iade bu kimlik üzerinden yapılır. Siparişin `provider_ref`'inden
    #: niyet anında kopyalanır: kısmi iadede tam-tutar idempotency'si geçersiz
    #: olduğundan her talep kendi referansını TAŞIMAK ZORUNDADIR, aksi hâlde
    #: reconciler sarkan talebi `provider_ref=None` ile dener ve iyzico anında
    #: reddeder (İP2A-02). İade idempotency'si bu kolonda DEĞİL, talebin kendi
    #: `refund_status` claim'inde + eşzamanlılık kilidinde yaşar.
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    refunded_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Tüm sipariş mi iade edildi (kargo dahil) yoksa bazı kalemler mi?
    is_partial: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # ── Fiziksel kabul (İP-2a/PK-α) ──
    #: Malın işletmeye ULAŞTIĞI ve muayeneden geçtiği an. Para durumundan
    #: BAĞIMSIZDIR: iade parası sağlayıcı başarısıyla kesinleşir, stok ise
    #: yalnız burası dolunca döner. Damga tek seferliktir — ikinci kabul
    #: çağrısı idempotent no-op'tur (ikinci stok hareketi ÜRETMEZ).
    received_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Kabulü yapan (admin e-postası/kullanıcı adı) — denetim izi.
    received_by: Mapped[str | None] = mapped_column(String(120), nullable=True)

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
    #: Bu satırın **NET** iade tutarı (birim fiyat × adet − satıra düşen kupon
    #: payı, KDV dahil) — sipariş anındaki fiyattan hesaplanır ve snapshot'lanır.
    #: Brüt yazıldığı sürece kuponlu siparişte müşteriye gösterilen döküm
    #: talebin gerçek iadesiyle tutmuyordu (İP2A-15).
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    # ── Fiziksel kabul sonucu (İP-2a/PK-α) ──
    #: Depoda teslim alınıp SAĞLAM bulunan adet → satılabilir (SALEABLE) kovaya.
    accepted_quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    #: Teslim alınıp HASARLI bulunan adet → hasarlı (DAMAGED) kovaya.
    #: Kabul edilmeyen (hiç gelmeyen) adet ikisine de girmez ve stoğa DÖNMEZ.
    damaged_quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    order_return: Mapped["OrderReturn"] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_return_items_quantity"),
        # Kabul edilen adet, iade edilmek üzere BEYAN EDİLEN adedi aşamaz;
        # aksi hâlde depo, satılmamış kitabı iade kanalından stoğa sokabilirdi.
        CheckConstraint(
            "accepted_quantity >= 0 AND damaged_quantity >= 0 "
            "AND accepted_quantity + damaged_quantity <= quantity",
            name="ck_order_return_items_received",
        ),
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


class StockMovementType(str, enum.Enum):
    """Stok hareketinin türü.

    Yeni tür eklemek gerekçe sözlüğünü ve admin yüzeyindeki etiketleri de
    güncellemeyi gerektirir; sessizce büyümemesi için sayısı kabul testiyle
    sabitlenmiştir.
    """

    #: Defter devreye alınırken var olan bakiye (migration). Stoğu 0 olan ürün
    #: de satır alır — zincirin tabanı her takip edilen ürün için var olmalı.
    OPENING_BALANCE = "OPENING_BALANCE"
    #: Ürün oluşturma / CSV içe aktarmada girilen ilk stok.
    INITIAL = "INITIAL"
    #: Sipariş PAID olunca düşüm (ürün başına toplanmış).
    SALE = "SALE"
    #: İptal / tam iade → geri yükleme.
    SALE_CANCEL = "SALE_CANCEL"
    #: Kısmi iade kabulü → geri yükleme (iade SATIRI bazlı).
    RETURN = "RETURN"
    #: Admin düzeltmesi. Gerekçe ZORUNLU; mutlak atama değil, delta yazılır.
    ADMIN_ADJUSTMENT = "ADMIN_ADJUSTMENT"

    # ── F29: sayım ve hasarlı stok ──
    #: Sayım oturumunun uygulanması. Veriyi fiziğe hizalar; fiziksel mevcudu
    #: DEĞİŞTİRMEZ. Kaynağı `stock_count_lines`.
    COUNT_ADJUSTMENT = "COUNT_ADJUSTMENT"
    #: Satılabilir → hasarlı. Aynı transaction'da İKİ satır yazılır.
    DAMAGE_TRANSFER = "DAMAGE_TRANSFER"
    #: Hasarlı → satılabilir (kurtarıldı). Yine iki satır.
    DAMAGE_RECOVERY = "DAMAGE_RECOVERY"
    #: Hasarlı kovadan imha — işletmeden fiziksel çıkış (tek satır).
    DAMAGE_DISPOSAL = "DAMAGE_DISPOSAL"
    #: Seçilen kovadan tedarikçiye fiziksel çıkış (tek satır).
    SUPPLIER_RETURN = "SUPPLIER_RETURN"


class StockBucket(str, enum.Enum):
    """Defter zincirinin ikinci boyutu: miktarın hangi kovada durduğu.

    Zincir değişmezi ``qty_after[i] == qty_after[i-1] + qty_delta[i]`` F29'dan
    itibaren `(product_id, bucket)` başına geçerlidir. `SALEABLE` zincirinin son
    değeri `products.stock`'a, `DAMAGED` zincirininki `products.damaged_stock`'a
    eşittir.

    **Boş hasarlı kova geçerlidir:** hiç `DAMAGED` hareketi olmayan bir üründe
    `damaged_stock = 0` doğru kabul edilir; migration gereksiz sıfır açılış
    satırı ÜRETMEZ. Bakiye sıfırdan farklıyken hareket yoksa bu bir bulgudur.
    """

    SALEABLE = "SALEABLE"
    DAMAGED = "DAMAGED"


#: `ADMIN_ADJUSTMENT` için geçerli gerekçe kodları (DB CHECK'iyle de zorlanır).
ADMIN_ADJUSTMENT_REASONS = frozenset(
    {"SAYIM_FARKI", "HASAR", "KAYIP", "HATALI_GIRIS", "TEDARIK", "DIGER"}
)


class StockMovement(Base):
    """`products.stock`'un DEĞİŞTİRİLEMEZ defteri (append-only).

    ## Neden var

    Stok altı ayrı yerde değişiyordu ve hiçbiri iz bırakmıyordu: "bu kitabın
    stoğu neden 3?" sorusunun cevabı yoktu. Aynı serviste **fiyat** değişimi
    `product_price_history`'ye yazılıyordu; stok için karşılığı yoktu.

    ## Sözleşme

    * **Append-only.** UPDATE ve DELETE `stock_movements_immutable()` trigger'ı
      tarafından reddedilir. Soft-delete YOKTUR ve olmamalıdır — gizlenebilen
      bir defter satırı, defter değildir (`audit_logs` ile aynı duruş).
    * **Tek yazıcı:** `services/stock_ledger.py`. `products.stock`'a doğrudan
      atama yapılmaz; kural AST kabul testiyle korunur.
    * **`qty_after`**, hareketin uygulandığı transaction'da `products.stock`'a
      GERÇEKTEN yazılan değerdir (ERPNext *Stock Ledger Entry* deseni). Zincir
      değişmezi: ``qty_after[i] == qty_after[i-1] + qty_delta[i]``.
    * **`idempotency_key`** ticari kaynaktan deterministik türetilir. Aynı
      anahtar + aynı payload → mevcut hareket döner (retry'ın doğru cevabı);
      aynı anahtar + farklı payload → çatışma hatası. Sessiz yutma yok.
    * **Negatif bakiye yazılmaz.** Yetersizlikte hareket hiç oluşmaz ve stok
      değişmez (`InsufficientStock`); kırpma (``max(0, …)``) YASAKTIR.

    ## `actor_id` neden FK değil

    İki sebep: (1) `audit_logs.actor_id` deseninin aynısı — defter satırı,
    aktörün yaşam döngüsünden bağımsız olarak okunabilir kalmalı; (2) FK
    `ON DELETE SET NULL` bir **UPDATE**'tir ve değiştirilemezlik trigger'ına
    çarpardı.
    """

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        # RESTRICT: ürün soft-delete edilir (`store_service.delete_product`), bu
        # yüzden pratikte hiç tetiklenmez; niyeti belgeler — defter yetim kalamaz.
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    #: Hareketin geçtiği kova (`StockBucket`). Defter F29'dan itibaren iki
    #: zincir taşır ve `qty_after` **kendi kovası** içinde zincirlenir.
    #:
    #: **VARSAYILANI YOKTUR — ne ORM'de ne sunucuda.** Bilerek: varsayılan
    #: kalsaydı `bucket` göndermeyen bir yazıcı (ham SQL, seed, hatalı kod) bir
    #: DAMAGED hareketi SESSİZCE SALEABLE olarak yazardı ve defter iki kovayı da
    #: yalan söylerdi. Varsayılan yalnızca migration backfill'i için vardı ve
    #: `f29a_bucket_default_kaldir` ile kaldırıldı; eksik `bucket` artık NOT NULL
    #: ihlaliyle **gürültülü** biçimde patlar.
    #:
    #: Tek yazıcı `services/stock_ledger.py` değeri her satırda AÇIKÇA verir;
    #: kural bir AST sözleşme testiyle korunur.
    bucket: Mapped[str] = mapped_column(String(10), nullable=False)

    #: İşaretli, UYGULANAN gerçek değişim. Sıfır yalnız OPENING_BALANCE'ta.
    qty_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Bu hareketten sonraki bakiye (= aynı transaction'da yazılan stok).
    qty_after: Mapped[int] = mapped_column(Integer, nullable=False)

    movement_type: Mapped[str] = mapped_column(String(20), nullable=False)
    #: Her hareket kendini açıklar → NOT NULL. Sistem tipleri sabit kod taşır.
    reason_code: Mapped[str] = mapped_column(String(30), nullable=False)

    # ── Ticari kaynak (polimorfik → FK yok) ──
    #: "order" · "order_return" · "product" · "migration"
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Satır bazlı kaynak — kısmi iadede `order_return_items.id`. Aynı üründen
    #: iki iade satırı İKİ geçerli harekettir; ayrımı bu alan taşır.
    ref_line_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    #: Deterministik idempotency anahtarı. `ADMIN_ADJUSTMENT`'ta NULL — her elle
    #: düzeltme ayrı bir olaydır ve doğal anahtarı yoktur (PG'de NULL'lar unique
    #: index'te birbirinden farklı sayılır).
    idempotency_key: Mapped[str | None] = mapped_column(String(160), nullable=True)

    #: "SYSTEM" | "ADMIN" (ileride genişletilebilir).
    actor_type: Mapped[str] = mapped_column(String(10), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: `audit_logs.request_id` ile korelasyon: defter NE olduğunu, audit KİMİN
    #: hangi istekle yaptığını anlatır.
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint(
            "movement_type IN ('OPENING_BALANCE','INITIAL','SALE','SALE_CANCEL',"
            "'RETURN','ADMIN_ADJUSTMENT','COUNT_ADJUSTMENT','DAMAGE_TRANSFER',"
            "'DAMAGE_RECOVERY','DAMAGE_DISPOSAL','SUPPLIER_RETURN')",
            name="ck_stock_movements_type",
        ),
        CheckConstraint(
            "bucket IN ('SALEABLE','DAMAGED')", name="ck_stock_movements_bucket"
        ),
        # Hasarlı kovada YALNIZ hasar ve sayım hareketleri olabilir: bir satış
        # ya da iade hasarlı kovaya düşerse defter iki kovayı da yalan söyler.
        CheckConstraint(
            "bucket = 'SALEABLE' OR movement_type IN ('COUNT_ADJUSTMENT',"
            "'DAMAGE_TRANSFER','DAMAGE_RECOVERY','DAMAGE_DISPOSAL',"
            "'SUPPLIER_RETURN','OPENING_BALANCE')",
            name="ck_stock_movements_bucket_type",
        ),
        CheckConstraint(
            "actor_type IN ('SYSTEM','ADMIN')", name="ck_stock_movements_actor_t"
        ),
        CheckConstraint(
            "actor_type <> 'ADMIN' OR actor_id IS NOT NULL",
            name="ck_stock_movements_actor_id",
        ),
        # Sıfır delta yalnız açılış bakiyesinde: 0 stoklu ürünün de zincir
        # tabanı olmalı. Diğer türlerde gürültü satırı yazılmaz.
        CheckConstraint(
            "qty_delta <> 0 OR movement_type = 'OPENING_BALANCE'",
            name="ck_stock_movements_delta",
        ),
        # Kırpma yasak olduğu için bu artık gerçek bir değişmez.
        CheckConstraint("qty_after >= 0", name="ck_stock_movements_after"),
        # Ticari kaynağı olan her hareket kaynağını taşımak zorundadır. Sayım ve
        # hasar hareketleri de bu sınıfa girer: kaynakları `stock_count_lines`
        # ve `stock_damage_events` satırlarıdır.
        CheckConstraint(
            "movement_type NOT IN ('SALE','SALE_CANCEL','RETURN',"
            "'COUNT_ADJUSTMENT','DAMAGE_TRANSFER','DAMAGE_RECOVERY',"
            "'DAMAGE_DISPOSAL','SUPPLIER_RETURN') "
            "OR (ref_type IS NOT NULL AND ref_id IS NOT NULL)",
            name="ck_stock_movements_ref",
        ),
        CheckConstraint(
            "movement_type <> 'RETURN' OR ref_line_id IS NOT NULL",
            name="ck_stock_movements_refline",
        ),
        CheckConstraint(
            "movement_type <> 'ADMIN_ADJUSTMENT' OR reason_code IN "
            "('SAYIM_FARKI','HASAR','KAYIP','HATALI_GIRIS','TEDARIK','DIGER')",
            name="ck_stock_movements_adjust",
        ),
        # Sayım farkı yön bilgisi taşır; elle düzeltmenin sözlüğüyle karışmaz.
        CheckConstraint(
            "movement_type <> 'COUNT_ADJUSTMENT' OR reason_code IN "
            "('SAYIM_FAZLA','SAYIM_EKSIK')",
            name="ck_stock_movements_count_reason",
        ),
        CheckConstraint(
            "movement_type NOT IN ('DAMAGE_TRANSFER','DAMAGE_RECOVERY',"
            "'DAMAGE_DISPOSAL','SUPPLIER_RETURN') OR reason_code IN "
            "('KIRIK','ISLAK','BASKI_HATASI','MUSTERI_IADESI_HASARLI','DIGER')",
            name="ck_stock_movements_damage_reason",
        ),
        # "DIGER" tek başına hiçbir şey açıklamaz; açıklamayı not taşır.
        CheckConstraint(
            "reason_code <> 'DIGER' OR (note IS NOT NULL AND length(btrim(note)) > 0)",
            name="ck_stock_movements_note",
        ),
        # Geçmiş ekranı ve zincir doğrulaması (ürün + kova + kronolojik sıra).
        # Kova kolonu öne alındı: `verify_ledger` ve "son bakiye" sorguları
        # F29'dan itibaren kova başına çalışır.
        Index(
            "ix_stock_movements_product",
            "product_id",
            "bucket",
            text("created_at DESC"),
            text("id DESC"),
        ),
        # "Bu siparişin/iadenin stok etkisi". UNIQUE DEĞİL: bir sipariş çok
        # ürün, bir iade çok satır taşır → referans başına çok geçerli hareket.
        Index("ix_stock_movements_ref", "ref_type", "ref_id"),
        Index("uq_stock_movements_idem", "idempotency_key", unique=True),
    )
