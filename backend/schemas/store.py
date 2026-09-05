"""Mağaza Pydantic şemaları (ürün/kategori/değerlendirme/sipariş).

Fiyatlar dışarıya **string** olarak sunulur (frontend money.ts Decimal parse eder;
Library.study_hourly_price deseni). Tutar otoritesi sunucudadır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ── Kategori ───────────────────────────────────────────────────────────────────────


class ProductCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    parent_id: int | None = None
    icon_url: str | None = None
    sort_order: int = 0
    is_active: bool = True
    product_count: int | None = None
    #: Kategorinin KENDİ varsayılan KDV oranı (NULL = yok). Değerler mali
    #: müşavir onayı bekliyor — kod hiçbir oran YAZMAZ, admin girer.
    default_tax_rate: Decimal | None = None
    #: Miras ÇÖZÜLMÜŞ varsayılan (yaprak NULL → yaprağa en yakın dolu ata).
    #: Yalnız SUNUM/ön-doldurma içindir; ürün oluşturmada sunucu bundan oran
    #: türetmez (`Product.tax_rate` zorunlu veridir).
    effective_tax_rate: Decimal | None = None


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: int | None = None
    icon_url: str | None = Field(default=None, max_length=500)
    sort_order: int = 0
    is_active: bool = True
    #: Sınırlar ürün oranıyla aynı sözleşme (aşağıda `_TAX_RATE_FIELD_ARGS` —
    #: burada henüz tanımlı olmadığından değerler tekrarlanır; birim ORAN).
    default_tax_rate: Decimal | None = Field(
        default=None, ge=0, lt=1, max_digits=5, decimal_places=4
    )


class ProductCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: int | None = None
    icon_url: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None
    is_active: bool | None = None
    #: `None` göndermek varsayılanı TEMİZLER (exclude_unset ayrımı serviste).
    default_tax_rate: Decimal | None = Field(
        default=None, ge=0, lt=1, max_digits=5, decimal_places=4
    )


# ── Ürün ─────────────────────────────────────────────────────────────────────────


class ProductImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    caption: str | None = None
    alt_text: str | None = None
    sort_order: int = 0


class ProductImageReorderIn(BaseModel):
    """Galeri sırası — id dizisinin SIRASI yeni sort_order'dır.

    Kısmi dizi kabul edilir: dizide olmayan görseller sona, mevcut göreli
    sıralarını koruyarak eklenir. Böylece iki yönetici aynı anda çalışırken
    biri yeni görsel yüklemişse o görsel sessizce KAYBOLMAZ.
    """

    image_ids: list[int] = Field(min_length=1)


class ProductImagePatchIn(BaseModel):
    """Görsel üstverisi. Alan verilmezse dokunulmaz; boş dize NULL'a çevrilir."""

    alt_text: str | None = Field(default=None, max_length=200)
    caption: str | None = Field(default=None, max_length=200)


# `ProductSupplierOut` ileri referans: `schemas/supplier.py` bu modülü import
# ETMEZ (tek yön), döngü yok.
from schemas.supplier import ProductSupplierOut  # noqa: E402


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
    #: KDV oranı (ORAN, 0.20 = %20). Admin düzenleme formu mevcut değeri bundan
    #: okur; katalog kartında gösterilmez ama şemanın tek kaynağı burasıdır.
    tax_rate: Decimal | None = None
    currency: str
    cover_url: str | None = None
    in_stock: bool = True
    #: Kalan adet. `in_stock` yalnız 0/0-değil ayrımı yapar ve "X kitabından
    #: kaç adet var" sorusunu cevaplayamaz — yönetim listesi bunu modal
    #: açmadan gösterebilmeli.
    #:
    #: DİJİTALDE `None`, 0 DEĞİL: dijital ürün tükenmez ve 0 yazmak listede
    #: "Tükendi" rozeti bastırırdı.
    stock: int | None = None
    category_id: int | None = None
    rating_count: int = 0
    rating_average: float | None = None
    bayesian_score: float | None = None
    status: str | None = None
    # Kitapta yazar kartta da gösterilir (başlığın altı).
    author: str | None = None
    # Künye satırı (yazar · yayınevi · ISBN) yönetim listesinde başlığın
    # altında görünür: kitapçının bir başlığı ayırt etmek için baktığı üç alan
    # bunlar. Vitrin kartı yalnız yazarı kullanır, fazlası kartı kalabalıklaştırır.
    publisher: str | None = None
    isbn: str | None = None
    #: Stok kalemi kimliği (`FZK-000042`). Yönetim tarafında aranabilir ve
    #: etiket/sayım ekranlarında ürünü teyit etmeye yarar.
    sku: str | None = None
    #: Marka / üretici. Kitapta `publisher`dan AYRIDIR ve onun yerine geçmez.
    brand: str | None = None
    # ── Varyant üyeliği (Faz 2) ──
    # Yanıtta dönmek zorunda: admin formu mevcut değerleri buradan okur ve
    # vitrin (Faz 4) kardeş seçiciyi bu alanlarla kurar.
    variant_group_id: int | None = None
    option1_value: str | None = None
    option2_value: str | None = None
    variant_sort: int = 0
    barcode: str | None = None
    #: Kartın temsil ettiği grup üye sayısı (tekil üründe 1). >1 iken kart
    #: "grup kartıdır": `in_stock` grubun durumudur ve fiyat gösterimi
    #: `group_min_price` ile "X TL'den başlayan" olur.
    variant_count: int = 1
    group_min_price: str | None = None
    # ── Tedarikçiden temin (Yıldırım B2B) ──
    #: Karşılanma kaynağı: OWN (raftan) · SUPPLIER (tedarikçiden getirilir) ·
    #: NONE (tükendi) · DIGITAL. **Public'te güvenlidir** — teslim süresi
    #: farkını gizlemek, tutulamayacak bir söz vermek olurdu.
    fulfillment: str = "OWN"
    #: "Tedarikçiden temin" anahtarının MEVCUT değeri.
    #:
    #: Yanıtta dönmek ZORUNDA: yönetim formu düzenleme modunda checkbox'ı bu
    #: alandan ön-doldurur. Dönmezse kutu her açılışta boş görünür ve kaydeden
    #: yönetici `supplier_backed: false` gönderir — yani AÇIK olan anahtarı
    #: farkında olmadan KAPATIR ve ürün vitrinde sessizce "tükendi"ye düşer.
    #: (`tax_rate`'in yanıtta dönme gerekçesiyle aynı sınıf; orada da kısmi
    #: PATCH oranı sıfırlıyordu.)
    supplier_backed: bool = False
    #: Maliyet/marj bloğu — **YALNIZ ADMIN yollarında doldurulur** (D-6).
    #: Şema ortak olduğu için alan burada durur; public yanıtta `None` kalır ve
    #: bunu bir PG testi (`test_supplier_storefront_pg`) gövdeyi tarayarak
    #: doğrular: "alan var ama boş" ile "alan hiç yok" arasındaki fark, bir
    #: gün yanlışlıkla doldurulduğunda ortaya çıkar.
    supplier: "ProductSupplierOut | None" = None


class ProductVariantMemberPublicOut(BaseModel):
    """Detay sayfası kardeş seçicisindeki tek varyant (public)."""

    id: int
    slug: str
    title: str
    option1_value: str | None = None
    option2_value: str | None = None
    variant_sort: int = 0
    #: Tükenen kardeş listede KALIR ama işaretlenir — seçici onu gizleseydi
    #: müşteri "bu renk hiç yokmuş" sanırdı; "tükendi" ayrı bir bilgidir.
    in_stock: bool = True
    price: str
    #: Kardeşin kendi kapağı. Seçici üzerine gelindiğinde/odaklanıldığında
    #: önizleme ve `ProductGroup.hasVariant` markup'ı bunu ister.
    cover_url: str | None = None
    sku: str | None = None


class VariantSwatchOut(BaseModel):
    """Bir eksen DEĞERİNİN renk örneği (yönetilen nitelik sözlüğünden).

    Eşleşme eksen ADI ↔ nitelik tanımı adı, değer ↔ nitelik değeri etiketi
    üzerinden kurulur. Eşleşme yoksa liste boş kalır ve seçici metin butonuna
    düşer — sözlük doldurulmadan da bozulmaz.
    """

    axis_name: str
    value: str
    hex: str | None = None
    image_url: str | None = None


class ProductVariantsPublicOut(BaseModel):
    """Detaydaki varyant bloğu: eksen ADLARI gruptan gelir (VARIANT_AXES)."""

    group_id: int
    title: str
    option1_name: str
    option2_name: str | None = None
    members: list[ProductVariantMemberPublicOut] = []
    #: Eksen değerlerinin renk örnekleri (yalnız tanımlı olanlar).
    swatches: list[VariantSwatchOut] = []


class ProductAttributeChipOut(BaseModel):
    """Ürün künyesinde gösterilen tek nitelik ("Kağıt Cinsi: 80 gr")."""

    definition_name: str
    label: str
    sort_order: int = 0


class ProductDetailOut(ProductSearchOut):
    description: str | None = None
    stock: int | None = None
    weight_grams: int | None = None
    digital_asset_name: str | None = None
    # Kitap künyesi (dolu olanlar detayda "Ürün Özellikleri" tablosunda gösterilir).
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
    #: Varyant grubundaysa kardeş seçici verisi; grupsuzda None (görsel
    #: değişimi ek iş İSTEMEZ: seçici kardeşin SAYFASINA gider ve görseller
    #: zaten ürün başınadır).
    variants: ProductVariantsPublicOut | None = None
    #: Üstü çizili gösterilebilecek YASAL referans fiyat.
    #:
    #: `compare_at_price` SERBEST girilen bir alandır ve indirim iddiasının
    #: dayanağı olamaz. Bu alan fiyat geçmişinden türetilir: pencere içindeki
    #: en düşük fiyat, ancak güncel fiyattan yüksekse dolar. Vitrin üstü çizili
    #: fiyatı BUNDAN okur.
    legal_compare_price: str | None = None
    #: Referansın hangi pencereden türetildiği (gün) — vitrin "son N günün en
    #: düşük fiyatı" ibaresini bu sayıdan yazar, kendi sabitini taşımaz.
    price_reference_days: int | None = None
    #: Yönetilen ürün nitelikleri (EAV). Admin bunları uzun süredir YAZABİLİYOR
    #: ama public detay yanıtına hiç girmiyorlardı: kırtasiye ürününde künye
    #: tablosu yalnız kitap alanlarından besleniyor ve boş çıkıyordu.
    attributes: list[ProductAttributeChipOut] = []


#: KDV oranı alanının ORTAK tanımı — üç yazıcı şema (admin oluşturma/güncelleme
#: ve eğitmen ürünü) aynı sınırı paylaşır. Tek yerde tanımlı olması, birinin
#: sınırı gevşetip diğerlerinin sıkı kalmasını engeller.
#:
#: Birim ORAN'dır (0.20 = %20), yüzde DEĞİL: `models.store.Product.tax_rate`
#: `Numeric(5,4)` ve `services/tax.py` `0 ≤ oran < 1` bekler. Yüzde yazan bir
#: istemci (20) bu yüzden 422 alır — %2000'lik sessiz bir fatura hatası
#: üretmektense isteği reddetmek doğrudur.
#:
#: Oran VERİDİR: hangi ürüne hangi oranın uygulanacağı bir mevzuat kararıdır ve
#: kodda hiçbir varsayılan/kategori kısayolu YOKTUR (bkz. sözleşme §2 S-5).
_TAX_RATE_FIELD_ARGS = {"ge": 0, "lt": 1, "max_digits": 5, "decimal_places": 4}


class _VariantMemberFields(BaseModel):
    """Ürünün varyant üyeliği alanları (ProductCreate/ProductUpdate ortak).

    `barcode` burada: bugüne dek hiçbir yazma şemasında yoktu (yalnız insan
    girdisiyle dolar kuralı gereği elle yönetiliyordu) ama gruplu ürün DB
    CHECK'i ile barkod TAŞIMAK ZORUNDA — alan API'ye açılmadan varyant
    oluşturulamazdı. Grupsuz üründe de gönderilebilir (opsiyonel kimlik).
    """

    variant_group_id: int | None = None
    option1_value: str | None = Field(default=None, min_length=1, max_length=60)
    option2_value: str | None = Field(default=None, min_length=1, max_length=60)
    variant_sort: int | None = Field(default=None, ge=0)
    barcode: str | None = Field(default=None, min_length=4, max_length=32)


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


class ProductCreate(_BookSpecFields, _VariantMemberFields):
    """Admin ürün oluşturma (varsayılan PLATFORM/fiziksel). Eğitmen ürünleri ayrı
    seller ucundan gelir (kind=DIGITAL zorlanır)."""

    title: str = Field(min_length=1, max_length=250)
    description: str | None = None
    kind: str = Field(pattern="^(PHYSICAL|DIGITAL)$")
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    #: ZORUNLU — varsayılanı YOKTUR. Sessizce %0 yazmak, yanlış oranla satılan
    #: ve yanlış fatura kesilen bir ürün demektir; hata ancak muhasebede ortaya
    #: çıkar (P1-7'nin kök nedeni tam olarak `server_default 0`'dı).
    tax_rate: Decimal = Field(**_TAX_RATE_FIELD_ARGS)
    stock: int | None = Field(default=None, ge=0)
    weight_grams: int | None = Field(default=None, ge=0)
    #: Marka / üretici (kitapta yayınevinden AYRI).
    brand: str | None = Field(default=None, max_length=120)
    category_id: int | None = None
    status: str = Field(default="DRAFT", pattern="^(ACTIVE|HIDDEN|DRAFT)$")
    cover_url: str | None = Field(default=None, max_length=500)
    #: "Kendi stoğum bitince tedarikçi stoğu vitrinde satılabilir sayılsın."
    #: Yalnız PHYSICAL'de anlamlı (servis dijitalde 400 döner).
    supplier_backed: bool | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.compare_at_price is not None and self.compare_at_price <= self.price:
            raise ValueError("compare_at_price fiyattan büyük olmalı")
        if self.status == "ACTIVE" and self.category_id is None:
            raise ValueError("Aktif ürün için kategori zorunludur.")
        return self


class ProductUpdate(_BookSpecFields, _VariantMemberFields):
    title: str | None = Field(default=None, min_length=1, max_length=250)
    description: str | None = None
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    #: Gönderilmezse MEVCUT oran korunur (`exclude_unset`); gönderilirse aynı
    #: sınırlara tabidir. Kısmi PATCH'in oranı sessizce sıfırlaması, sessiz
    #: varsayılanla aynı sınıf hatadır.
    tax_rate: Decimal | None = Field(default=None, **_TAX_RATE_FIELD_ARGS)
    #: HEDEF (mutlak) stok. Delta sunucuda, ürün satırı kilitli iken hesaplanır;
    #: istemci delta göndermez (iki istemci aynı deltayı gönderirse hangisinin
    #: hangi tabana uygulandığı belirsiz kalırdı).
    stock: int | None = Field(default=None, ge=0)
    #: `stock` gönderildiğinde ZORUNLU (servis doğrular): stok neden değişti?
    #: Beyaz liste `models.store.ADMIN_ADJUSTMENT_REASONS`.
    stock_reason_code: str | None = Field(default=None, max_length=30)
    #: `stock_reason_code == "DIGER"` ise zorunlu.
    stock_note: str | None = Field(default=None, max_length=500)
    weight_grams: int | None = Field(default=None, ge=0)
    brand: str | None = Field(default=None, max_length=120)
    category_id: int | None = None
    status: str | None = Field(default=None, pattern="^(ACTIVE|HIDDEN|DRAFT|PENDING)$")
    cover_url: str | None = Field(default=None, max_length=500)
    #: Tedarikçiden temin anahtarı. Gönderilmezse mevcut değer korunur.
    supplier_backed: bool | None = None


class SellerProductCreate(BaseModel):
    """Eğitmen dijital ürün oluşturma (kind=DIGITAL + status=PENDING zorlanır)."""

    title: str = Field(min_length=1, max_length=250)
    description: str | None = None
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    compare_at_price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    #: Eğitmen dijital ürünü de fatura satırıdır → oran ZORUNLU (bkz.
    #: `ProductCreate.tax_rate`). Kolun ayrı olması muafiyet anlamına gelmez.
    tax_rate: Decimal = Field(**_TAX_RATE_FIELD_ARGS)
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


# ── Varyant grubu (Faz 2) ──────────────────────────────────────────────────────────


def _eksen_dogrula(ad: str | None) -> str | None:
    """Eksen adı kontrollü sözlükten olmalı (422 — DB CHECK'e inmeden).

    Sözlüğün tek kaynağı `models.store.VARIANT_AXES`; burada kopyası tutulmaz.
    """
    from models.store import VARIANT_AXES

    if ad is not None and ad not in VARIANT_AXES:
        raise ValueError(
            f"Eksen adı sözlükten seçilmeli: {', '.join(VARIANT_AXES)}"
        )
    return ad


class _VariantAxisFields(BaseModel):
    option1_name: str = Field(min_length=1, max_length=30)
    option2_name: str | None = Field(default=None, max_length=30)

    _v1 = field_validator("option1_name")(_eksen_dogrula)
    _v2 = field_validator("option2_name")(_eksen_dogrula)

    @model_validator(mode="after")
    def _eksenler_farkli(self):
        if self.option2_name is not None and self.option2_name == self.option1_name:
            raise ValueError("İki eksen aynı olamaz")
        return self


class VariantGroupCreate(_VariantAxisFields):
    title: str = Field(min_length=1, max_length=250)


class VariantGroupUpdate(BaseModel):
    """Kısmi güncelleme. `option2_name: None` göndermek ekseni KALDIRMAK
    demektir (exclude_unset ayrımı serviste yapılır); üyeler değer taşıyorsa
    servis 409 verir."""

    title: str | None = Field(default=None, min_length=1, max_length=250)
    option1_name: str | None = Field(default=None, max_length=30)
    option2_name: str | None = Field(default=None, max_length=30)

    _v1 = field_validator("option1_name")(_eksen_dogrula)
    _v2 = field_validator("option2_name")(_eksen_dogrula)


class VariantGroupOut(BaseModel):
    id: int
    title: str
    option1_name: str
    option2_name: str | None = None
    #: Gruba bağlı AKTİF (silinmemiş) ürün sayısı.
    member_count: int = 0


class VariantMemberOut(BaseModel):
    """Grup detayındaki kardeş satırı (admin varyant tablosu)."""

    id: int
    title: str
    option1_value: str | None = None
    option2_value: str | None = None
    variant_sort: int = 0
    price: str
    stock: int | None = None
    status: str | None = None
    cover_url: str | None = None
    sku: str | None = None
    barcode: str | None = None


class VariantGroupDetailOut(VariantGroupOut):
    members: list[VariantMemberOut] = []


class VariantConfigOut(BaseModel):
    """Varyant sözlükleri — frontend'in tek kaynağı (kopya sabit tutulmaz)."""

    axes: list[str]
    book_root_slugs: list[str]


class DeriveVariantIn(BaseModel):
    """Kaynak üründen yeni varyant türetme. Künye/fiyat/görsel kaynaktan
    kopyalanır; burada yalnız YENİ varyantı ayırt eden alanlar gelir."""

    option1_value: str = Field(min_length=1, max_length=60)
    option2_value: str | None = Field(default=None, min_length=1, max_length=60)
    #: Gruplu ürün barkodsuz olamaz (Faz 1 CHECK'i) — türetmede de zorunlu.
    barcode: str = Field(min_length=4, max_length=32)
    #: Verilmezse "{kaynak başlığın grupça ortak kökü yoksa kaynak başlık} - {değer}".
    title: str | None = Field(default=None, min_length=1, max_length=250)
    price: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    variant_sort: int | None = Field(default=None, ge=0)
    stock: int | None = Field(default=None, ge=0)


class VariantMatrixPreviewIn(BaseModel):
    """Eksen değerlerinden üretilecek kombinasyonların KURU ÇALIŞTIRMASI.

    Önizleme yazma yapmaz. Amacı, yöneticinin "oluştur"a basmadan önce kaç
    satır doğacağını, hangilerinin zaten var olduğunu ve hangi yazım ikizinin
    elendiğini görmesidir.
    """

    option1_values: list[str] = Field(min_length=1, max_length=200)
    option2_values: list[str] | None = Field(default=None, max_length=200)


class VariantMatrixCellOut(BaseModel):
    option1_value: str
    option2_value: str | None = None
    #: Doluysa bu kombinasyon grupta ZATEN var; üretimde atlanır.
    existing_product_id: int | None = None


class VariantMatrixPreviewOut(BaseModel):
    group_id: int
    option1_name: str
    option2_name: str | None = None
    cells: list[VariantMatrixCellOut]
    new_count: int
    existing_count: int
    #: Tek işlemde üretilebilecek tavan; istemci sayacı buna göre kilitler.
    limit: int


class VariantMatrixRowIn(BaseModel):
    """Üretilecek TEK varyant.

    ``barcode`` zorunludur ve uydurulamaz: gruplu ürün barkodsuz olamaz
    (`ck_products_variant_barcode`) çünkü rafta iki varyant ancak barkodla
    ayırt edilir. Sunucunun sahte bir EAN üretmesi, depo ve tedarikçi
    entegrasyonunu sessizce bozardı.
    """

    option1_value: str = Field(min_length=1, max_length=60)
    option2_value: str | None = Field(default=None, min_length=1, max_length=60)
    barcode: str = Field(min_length=4, max_length=32)
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    stock: int | None = Field(default=None, ge=0)


class VariantMatrixCreateIn(BaseModel):
    rows: list[VariantMatrixRowIn] = Field(min_length=1)


class VariantMatrixCreateOut(BaseModel):
    created: int
    product_ids: list[int]


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
    attribution_token: str | None = Field(default=None, max_length=1200)


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
    #: Müşteriye gösterilen kalıcı sipariş numarası ("4827-1930-5612"). Ekranlarda
    #: `id` yerine BU yazılır: `id` sıralıdır ve sipariş hacmini sızdırır.
    order_no: str
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
    ship_lat: float | None = None
    ship_lng: float | None = None
    # Söz verilen teslim günü (Cıncık Teslimat 16:00 cutoff) — dijital/eski
    # siparişlerde None. in_zone True=kendi filo, False=dış kargo, None=belirsiz.
    promised_delivery_date: datetime.date | None = None
    ship_in_zone: bool | None = None
    # Müşteri teslimat talimatı + erteleme sayacı (limit: order_service.POSTPONE_LIMIT).
    delivery_pref: str = "ADRESIMDEYIM"
    delivery_pref_note: str | None = None
    postpone_count: int = 0
    tracking_no: str | None = None
    # Oturumsuz kargo takip token'ı — site içi "Kargo Takip" butonu /kargo-takip/{token}
    # sayfasına bunu kullanarak gider (SMS linkiyle aynı sayfa).
    track_token: str | None = None
    # En güncel iade talebinin durumu (PENDING/APPROVED/REJECTED) — yoksa None.
    return_status: str | None = None
    # Teslim anı + son iade tarihi (teslim + 14 gün). Teslim edilmemiş/eski
    # siparişlerde None. Frontend "son iade tarihi" bilgisini bundan gösterir.
    delivered_at: datetime.datetime | None = None
    return_deadline: datetime.datetime | None = None
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
    #: Sepetteki kalemler için kapalı olan ödeme kolları (`services/payment_gates`).
    #: Boş değilse checkout başlatılmamalı — sebep `issues` içinde metin olarak da var.
    blocked_payment_branches: list[str] = []


class OrderShipIn(BaseModel):
    tracking_no: str | None = Field(default=None, max_length=100)


class AdminOrderActionIn(BaseModel):
    """Yönetici iptal/iade gerekçesi — **ZORUNLU**.

    Bu iki uç para hareketi başlatır; "bu iade/iptal neden yapıldı" sorusunun
    yapısal cevabı olmadan denetim izi eksik kalır. Gerekçe hem
    ``audit_logs.reason``'a hem ``order_status_history.reason``'a yazılır.

    Boş/yalnız-boşluk gerekçe reddedilir: zorunluluk tek bir boşluk karakteriyle
    atlatılabiliyorsa zorunluluk değildir. Değer **trim edilerek kanonik**
    saklanır (baştaki/sondaki boşluk denetim aramasını bozmasın).
    """

    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _kanonik_gerekce(cls, v: str) -> str:
        s = " ".join(v.split())
        if len(s) < 3:
            raise ValueError("Gerekçe en az 3 anlamlı karakter içermeli")
        return s


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


class OrderReturnItemIn(BaseModel):
    """İade edilecek kalem ve adedi (kısmi iade)."""

    order_item_id: int
    quantity: int = Field(ge=1)


class OrderReturnCreate(BaseModel):
    """İade talebi.

    ``type=CAYMA`` (Mesafeli Sözleşmeler Yönetmeliği m.9) koşulsuzdur: gerekçe
    ZORUNLU DEĞİLDİR ve talep otomatik onaylanır. Ayıplı/diğer taleplerde
    gerekçe istenir (servis katmanı doğrular).

    ``items`` boş bırakılırsa siparişin TAMAMI iade edilir (geriye dönük
    uyumluluk: eski istemci yalnız `reason` gönderiyordu).
    """

    type: str = Field(default="DIGER", pattern="^(CAYMA|AYIPLI|DIGER)$")
    reason: str = Field(default="", max_length=1000)
    items: list[OrderReturnItemIn] = Field(default_factory=list)


class OrderReturnResolve(BaseModel):
    admin_note: str | None = Field(default=None, max_length=1000)


class OrderReturnReceiveLine(BaseModel):
    """Depo kabul satırı: iade kaleminden kaç adet sağlam/hasarlı geldi."""

    return_item_id: int
    accepted_quantity: int = Field(default=0, ge=0)
    damaged_quantity: int = Field(default=0, ge=0)


class OrderReturnReceiveIn(BaseModel):
    """İade edilen malın fiziksel kabulü (PK-α).

    Kabul edilmeyen adet hiçbir stok kovasına girmez — "gelmedi" da geçerli
    bir sonuçtur ve sessizce stoğa yazılmamalıdır.
    """

    lines: list[OrderReturnReceiveLine] = Field(min_length=1)
    note: str | None = Field(default=None, max_length=500)


class OrderReturnItemOut(BaseModel):
    order_item_id: int
    title: str | None = None
    quantity: int
    amount: str
    #: Fiziksel kabul sonucu (PK-α). Toplamı `quantity`'yi aşamaz; ikisi de 0
    #: iken `received_at` doluysa "hiç gelmedi" demektir.
    accepted_quantity: int = 0
    damaged_quantity: int = 0


class OrderReturnOut(BaseModel):
    id: int
    order_id: int
    type: str = "DIGER"
    status: str
    reason: str
    admin_note: str | None = None
    created_at: datetime.datetime
    resolved_at: datetime.datetime | None = None
    # Para durumu talebin durumundan AYRIDIR (talep onaylı olabilir ama iade
    # sağlayıcıda henüz kesinleşmemiş olabilir).
    refund_status: str = "NONE"
    refund_amount: str = "0.00"
    #: Talebe düşen kargo payı. Dekont özdeşliği:
    #: ``refund_amount == Σ items[].amount + shipping_refund`` (İP2A-15).
    shipping_refund: str = "0.00"
    refunded_at: datetime.datetime | None = None
    is_partial: bool = False
    #: Malın fiziksel kabul anı (PK-α). Para durumundan bağımsızdır: dolu
    #: değilse iade parası ödenmiş olsa bile stok HENÜZ dönmemiştir.
    received_at: datetime.datetime | None = None
    items: list[OrderReturnItemOut] = Field(default_factory=list)
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
