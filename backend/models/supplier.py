"""Tedarikçi (B2B toptancı) senkron katmanı — veri modeli.

Sözleşme: `docs/tedarikci-senkron-sozlesme.md`.

## Neden ayrı bir katman (D-1)

Tedarikçinin stoğu **bizim stoğumuz değildir**. `products.stock` rafımızdaki
fiziksel maldır; sayım oturumu onu sayar, hasar defteri ondan düşer, paketleme
onu toplar ve `stock_movements` her değişimini kaydeder. Yıldırım'ın deposundaki
mal bunların hiçbirine tabi değildir — oraya yazmak sayımı her turda fark
üretmeye, defteri de yalancı olmaya iter.

Bu yüzden tedarikçi stoğu kendi tablosunda durur ve vitrine yalnız bir
**yüklem** üzerinden karışır (`core/stock_policy.satilabilir_yuklemi`).

## Neden ayarlar burada, `.env`'de değil

Kullanıcı senkron sıklığını panelden değiştirebilmeli ve değişiklik yeniden
başlatma istememeli. Projede bugün çalışma zamanı ayarı için tek desen boolean
`feature_flags`; sayısal/metinsel ayar için desen yoktu. Tedarikçi kaydının
kendisi o ayarları taşıyor — tablo zaten sağlayıcı başına tek satır.

Devre kesici (`consecutive_failures`, `cooldown_until`) de burada, süreç-içi
değil: `core/routing._State` bilinçli olarak süreç-içidir çünkü yalnız "bu
süreç boşuna beklemesin" kararını verir. Burada durum **panelde görünmek**
zorunda (yönetici neden senkronun durduğunu bilmeli) ve replikalar arasında
paylaşılmalı.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.crypto import EncryptedText
from core.database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

#: Desteklenen sağlayıcılar. Kontrollü sözlük + DB CHECK: `provider` bir
#: fabrika anahtarıdır (`core/suppliers/factory.py`), serbest metin olursa
#: yazım hatası "hiçbir istemci bulunamadı" diye SESSİZ bir arıza üretir.
SUPPLIER_PROVIDERS = ("yildirim",)

#: Bağın nasıl kurulduğu. `AUTO` senkronun barkod eşleşmesi, `MANUAL`
#: yöneticinin kararıdır — senkron `MANUAL` bağı EZEMEZ.
LINK_SOURCES = ("AUTO", "MANUAL")

#: Karantina bayrakları (rapor §3.1 + eşleştirme tarafındakiler). Serbest metin
#: değil sabit sözlük: panel her bayrağı Türkçe bir uyarıya çeviriyor ve
#: bilinmeyen bir kod ekranda ham görünürdü.
QUARANTINE_FLAGS = (
    "KIRILIM_YOK",
    "SIFIR_FIYAT",
    "DOVIZ_TL_DEGIL",
    "KDV_SIFIR_SUPHELI",
    "NET_TABANDAN_YUKSEK",
    "BARKOD_BOZUK",
    "BARKOD_YOK",
    "BIRIM_ADET_DEGIL",
    "GORSEL_YOK",
    "COKLU_ESLESME",
    "URUN_ZATEN_BAGLI",
    "FAVORI_DISI",
)

#: Alt sınırlar. Hem şemada (`SupplierSettingsIn`) hem DB CHECK'inde: ham SQL
#: ve seed de kaçamamalı. 30 sn'nin altı, zayıf origin'i döver (rapor §2.11:
#: keşif sırasında 11 sn ve 4 sn süren 502'ler gözlendi).
MIN_STOCK_INTERVAL_SECONDS = 30
MIN_PRICE_INTERVAL_SECONDS = 3600


class Supplier(Base, TimestampMixin, SoftDeleteMixin):
    """Bir B2B toptancı hesabı: kimlik bilgisi + senkron ayarları + son durum."""

    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    base_url: Mapped[str] = mapped_column(String(255), nullable=False)

    # ── Kimlik bilgisi (D-5) ──
    # Şifreli ve GENİŞLİK SINIRSIZ; gerekçe `core/crypto.EncryptedText`.
    # Env'de token YOKTUR: sır panelden girilir, tek yerde yaşar ve rotasyonu
    # deploy gerektirmez.
    api_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    token_updated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: JWT `exp` claim'i (imza DOĞRULANMADAN okunur — bizim imzamız değil).
    #: Panelde "N gün sonra dolar" uyarısı bundan üretilir; 30 günlük bir
    #: token sessizce ölürse stok bilgisi bayatlar ve kimse fark etmez.
    token_expires_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    token_refreshed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Senkron ayarları ──
    stock_interval_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("60")
    )
    price_interval_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("21600")
    )
    next_stock_sync_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    next_price_sync_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Son durum (panelde görünür) ──
    last_stock_sync_ok_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_price_sync_ok_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Panelde GÖSTERİLİR → token asla buraya yazılmaz
    #: (`supplier_sync_service._sanitize_error`).
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_stats: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ── Devre kesici ──
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    cooldown_until: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    products: Mapped[list["SupplierProduct"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "provider IN ('" + "', '".join(SUPPLIER_PROVIDERS) + "')",
            name="ck_suppliers_provider",
        ),
        CheckConstraint(
            f"stock_interval_seconds >= {MIN_STOCK_INTERVAL_SECONDS}",
            name="ck_suppliers_stock_interval",
        ),
        CheckConstraint(
            f"price_interval_seconds >= {MIN_PRICE_INTERVAL_SECONDS}",
            name="ck_suppliers_price_interval",
        ),
        CheckConstraint(
            "consecutive_failures >= 0", name="ck_suppliers_failure_count"
        ),
        # Sağlayıcı başına TEK aktif satır: iki Yıldırım kaydı olsaydı hangi
        # token'ın kullanılacağı belirsiz kalır ve iki döngü aynı satırları
        # upsert etmeye çalışırdı.
        Index(
            "uq_suppliers_provider_active",
            "provider",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class SupplierProduct(Base, TimestampMixin):
    """Tedarikçi kataloğunun bizdeki izdüşümü + mağaza ürünüyle bağı."""

    __tablename__ = "supplier_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(
        ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False
    )

    # ── Tedarikçideki kimlik ──
    external_id: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Tedarikçinin kendi stok kodu ("ÇINARDEF 11003"). Rapor §3.3 bunu tekil
    #: anahtar olarak öneriyor; biz `external_id`'yi kullanıyoruz (tamsayı,
    #: index'i ucuz) ama kod insan tarafında aranabilir olmalı.
    external_code: Mapped[str] = mapped_column(String(64), nullable=False)

    name: Mapped[str] = mapped_column(String(250), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category_path: Mapped[str | None] = mapped_column(String(300), nullable=True)

    #: Ham barkod ve doğrulama sonucu AYRI tutulur: geçersiz barkod da
    #: saklanmalı (yönetici tedarikçiye bildirebilsin), ama eşleştirmeye
    #: girmemeli. Tek kolonda tutmak "geçersizi sil" ya da "geçersizle eşleştir"
    #: ikilemine sokardı.
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    barcode_valid: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # ── Satış birimi ──
    # Stok ve fiyat BU birim cinsindendir. "12,5" tek başına 12,5 adet mi 12,5
    # düzine mi söylemez; birim adı olmadan sayı yanıltıcıdır (rapor §1.5).
    unit_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    unit_multiplier: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 3), nullable=True
    )
    min_order: Mapped[Decimal | None] = mapped_column(Numeric(10, 3), nullable=True)

    # ── Stok (D-4) ──
    # NUMERIC, INTEGER DEĞİL: ölçümde 12.5 gözlendi. Tamsayıya yuvarlamak,
    # tedarikçide 12,5 düzine varken 12 düzine varmış gibi davranmaktır.
    stock_qty: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, server_default=text("0")
    )
    #: Tedarikçinin kendi "stoksuz" bayrağı. `stock_qty == 0` ile birebir aynı
    #: olduğu 300 üründe doğrulandı — türev alan olarak saklanır ki sapma
    #: gözlenirse fark edilsin.
    stockless: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    stock_status: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # ── Fiyat / maliyet (D-3) ──
    list_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    #: ORAN (0.20 = %20) — `Product.tax_rate` ile aynı birim. API yüzde verir,
    #: dönüşüm sınırda yapılır (`core/suppliers/yildirim.py`).
    vat_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    #: VARSAYILAN kırılımın (her zaman PEŞİN) net'i — KDV hariç.
    cost_net: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cost_gross: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cost_breakdown_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    currency_ok: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    campaign: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    quarantine_flags: Mapped[list[str]] = mapped_column(
        ARRAY(String(40)), nullable=False, server_default=text("'{}'::varchar[]")
    )
    image_url: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # ── Mağaza ürünüyle bağ ──
    # SET NULL bilinçli: `tests/integration/db_guard.purge_products` ürünleri
    # FİZİKSEL siliyor ve RESTRICT her tedarikçi testini kırardı. Yetim kalan
    # satır da bilgi taşır ("bu ürün silinmiş, bağ çözüldü").
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    link_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    linked_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    linked_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )

    # ── Favori durumu ──
    # Kayıt SİLİNMEZ: geçmiş bağ ve maliyet, yöneticinin "bunu tekrar
    # favoriye alayım mı" kararına dayanak. Yalnız uygunluktan düşer.
    is_favorite: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    unfavorited_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_seen_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    stock_synced_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    price_synced_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    opened_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    supplier: Mapped["Supplier"] = relationship(back_populates="products")

    __table_args__ = (
        CheckConstraint(
            "link_source IS NULL OR link_source IN ('"
            + "', '".join(LINK_SOURCES)
            + "')",
            name="ck_supplier_products_link_source",
        ),
        # Bağlı bir satır NASIL bağlandığını söylemek ZORUNDA: "product_id var,
        # kaynak yok" hâli panelde "kim bağladı" sorusunu cevapsız bırakır ve
        # senkronun MANUAL bağı ezip ezemeyeceğini belirsizleştirir.
        #
        # TERSİ (kaynak var, ürün yok) bilinçli olarak SERBEST. İlk sürüm çift
        # yönlü eşitlik (`(product_id IS NULL) = (link_source IS NULL)`)
        # yazıyordu ve migration testi onu kırdı: ürün FİZİKSEL silinince FK'nin
        # `ON DELETE SET NULL`'ı yalnız `product_id`'yi NULL'lar, `link_source`
        # 'AUTO' kalır ve DELETE kısıt ihlaliyle reddedilir.
        #
        # Trigger'la iki kolonu birlikte temizlemek de ÇÖZMEZ:
        # `db_guard.purge_products` (test izolasyonunun aracı) silmeden önce
        # `ALTER TABLE products DISABLE TRIGGER USER` yapıyor — kullanıcı
        # trigger'ı susar ama FK sistem trigger'ı ve CHECK çalışmaya devam eder.
        # Yani sıkı kısıt, ürünü fiziksel silen HER yolu bloklardı.
        #
        # Yetim etiketin zararı yok: "bağlı" sorgusu her yerde
        # `product_id IS NOT NULL` ile kuruluyor (`uq_supplier_products_link`
        # kısmi index'i dahil) ve API katmanı `product_id` boşken `link_source`
        # DÖNDÜRMEZ. `auto_link` de böyle bir satırı yeniden bağlayıp etiketi
        # tazeler.
        CheckConstraint(
            "product_id IS NULL OR link_source IS NOT NULL",
            name="ck_supplier_products_link_pairing",
        ),
        CheckConstraint("stock_qty >= 0", name="ck_supplier_products_stock_sign"),
        Index(
            "uq_supplier_products_external",
            "supplier_id",
            "external_id",
            unique=True,
        ),
        Index("ix_supplier_products_code", "supplier_id", "external_code"),
        Index(
            "ix_supplier_products_barcode",
            "barcode",
            postgresql_where=text("barcode IS NOT NULL"),
        ),
        # Bir mağaza ürünü aynı tedarikçide EN FAZLA bir satıra bağlı olabilir:
        # iki satır bağlı olsaydı "tedarikçi stoğu" sorusunun iki cevabı olurdu.
        Index(
            "uq_supplier_products_link",
            "supplier_id",
            "product_id",
            unique=True,
            postgresql_where=text("product_id IS NOT NULL"),
        ),
        # Vitrin yükleminin EXISTS'i bunu kullanır (her katalog sorgusunda).
        Index(
            "ix_supplier_products_available",
            "product_id",
            postgresql_where=text(
                "product_id IS NOT NULL AND is_favorite AND stock_qty >= 1"
            ),
        ),
    )
