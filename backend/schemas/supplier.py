"""Tedarikçi senkronu — istek/yanıt şemaları.

## D-5: token şemada YOKTUR

`SupplierOut` bir `api_token` alanı taşımaz. Alan yoksa sızıntı da olamaz —
bu, "uç 403 döndürüyor" güvencesinden daha güçlüdür: yetki kontrolü bir gün
yanlış yazılabilir, olmayan alan yanlış yazılamaz. Panel token'ın **girili
olup olmadığını** (`has_token`) ve **ne zaman dolacağını** bilir; değerini
asla görmez. Sözleşme testi: `tests/acceptance/test_supplier_contract.py`.
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.supplier import MIN_PRICE_INTERVAL_SECONDS, MIN_STOCK_INTERVAL_SECONDS


class SupplierOut(BaseModel):
    """Panelin gördüğü tedarikçi durumu."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    name: str
    is_enabled: bool
    base_url: str

    #: Token'ın DEĞERİ değil, VARLIĞI. Panel "girilmemiş" uyarısını buna bakar.
    has_token: bool
    #: 30 günlük token sessizce ölürse stok bilgisi bayatlar ve kimse fark
    #: etmez; panel "N gün sonra dolar" uyarısını buradan üretir.
    token_expires_at: datetime.datetime | None = None

    stock_interval_seconds: int
    price_interval_seconds: int
    next_stock_sync_at: datetime.datetime | None = None
    next_price_sync_at: datetime.datetime | None = None

    last_stock_sync_ok_at: datetime.datetime | None = None
    last_price_sync_ok_at: datetime.datetime | None = None
    last_error: str | None = None
    last_error_at: datetime.datetime | None = None
    consecutive_failures: int = 0
    cooldown_until: datetime.datetime | None = None
    last_sync_stats: dict | None = None

    #: Panelin "kaç ürün bağlı / kaç tanesi eşleşmemiş" şeridi. Sayılar
    #: sunucuda hesaplanır: istemcinin tüm listeyi çekip sayması, 11.915
    #: satırlık bir katalogda kabul edilemez.
    linked_count: int = 0
    unmatched_count: int = 0


class SupplierSettingsIn(BaseModel):
    """Kısmi güncelleme (`exclude_unset`) + ZORUNLU gerekçe.

    Gerekçe zorunlu çünkü kayıt `audit_logs`'a düşüyor ve "kim, ne zaman,
    NEDEN" üçlüsünün üçüncüsü olmadan denetim kaydı bir zaman damgasından
    ibaret kalır (`ReasonDialog` deseni).
    """

    is_enabled: bool | None = None
    name: str | None = Field(default=None, min_length=2, max_length=120)
    stock_interval_seconds: int | None = Field(
        default=None, ge=MIN_STOCK_INTERVAL_SECONDS, le=86_400
    )
    price_interval_seconds: int | None = Field(
        default=None, ge=MIN_PRICE_INTERVAL_SECONDS, le=604_800
    )
    #: Gönderilmezse MEVCUT token korunur. Boş dizgi de "silme" ANLAMINA
    #: GELMEZ (istemci boş kutuyu hiç göndermez; yine de burada eleniyor):
    #: form her açıldığında kutu boştur, yalnız aralığı değiştiren yönetici
    #: token'ı sessizce silmemeli.
    api_token: str | None = Field(default=None, max_length=4000)
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("api_token")
    @classmethod
    def _bos_token_yok(cls, v: str | None) -> str | None:
        if v is None:
            return None
        temiz = v.strip()
        return temiz or None


class SyncIn(BaseModel):
    scope: Literal["stock", "price", "both"] = "stock"


class SyncReportOut(BaseModel):
    scope: str
    favorites: int = 0
    new: int = 0
    updated: int = 0
    unfavorited: int = 0
    auto_linked: int = 0
    priced: int = 0
    notified: int = 0


class LinkedProductBrief(BaseModel):
    """Bağlı ürünün panelde gösterilen özeti."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    sku: str | None = None
    price: str
    stock: int | None = None
    supplier_backed: bool = False


class SupplierProductOut(BaseModel):
    """Tedarikçi kataloğundaki tek satır (YÖNETİM yüzeyi)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: int
    external_code: str
    name: str
    brand: str | None = None
    category_path: str | None = None
    barcode: str | None = None
    barcode_valid: bool = False

    #: Birim adı OLMADAN stok sayısı yanıltıcıdır: "12,5" düzine 150 defterdir.
    unit_name: str | None = None
    #: Dizgi olarak döner — `Decimal` JSON'da float'a çevrilirse 12.5 sorun
    #: çıkarmaz ama 0.1 gibi değerler kuruş hatası üretir (para/stok disiplini).
    stock_qty: str
    stockless: bool = True

    list_price: str | None = None
    cost_net: str | None = None
    cost_gross: str | None = None
    cost_breakdown_name: str | None = None
    vat_rate: Decimal | None = None
    currency_ok: bool = True
    campaign: bool = False
    quarantine_flags: list[str] = []
    image_url: str | None = None

    product_id: int | None = None
    product: LinkedProductBrief | None = None
    link_source: str | None = None
    linked_at: datetime.datetime | None = None

    is_favorite: bool = True
    unfavorited_at: datetime.datetime | None = None
    stock_synced_at: datetime.datetime | None = None
    price_synced_at: datetime.datetime | None = None


class ProductSupplierOut(BaseModel):
    """Ürün listesinde gösterilen tedarikçi özeti — **YALNIZ ADMIN** (D-6).

    Public `ProductSearchOut` bu bloğu ASLA doldurmaz: maliyet ve marj ticari
    sırdır ve rakip de müşteri olabilir.
    """

    supplier_product_id: int
    external_code: str
    unit_name: str | None = None
    stock_qty: str
    cost_net: str | None = None
    cost_gross: str | None = None
    margin_absolute: str | None = None
    margin_percent: str | None = None
    below_cost: bool = False
    link_source: str | None = None
    is_favorite: bool = True
    quarantine_flags: list[str] = []
    stock_synced_at: datetime.datetime | None = None
    price_synced_at: datetime.datetime | None = None


class LinkIn(BaseModel):
    product_id: int
    reason: str = Field(min_length=3, max_length=500)


class UnlinkIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
