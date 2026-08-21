"""Tedarikçi sağlayıcı soyutlaması — sözleşme ve veri taşıyıcıları.

`core/payments`, `core/mail`, `core/sms` ile aynı desen: ABC + somut sınıflar +
`build_client` fabrikası. Amaç geliştirmede dış hesap gerektirmemek
(`FakeSupplierClient`) ve sağlayıcı değişse bile iş mantığına dokunmamak.

## Hata sınıflandırması neden bu kadar ayrıntılı

Panelde yöneticinin okuyacağı tek şey `last_error` metnidir ve verdiği karar
buna bağlıdır:

* `SupplierAuthError`   → **token'ı yenile** (tekrar denemek işe yaramaz)
* `SupplierBadRequest`  → **kod hatası**, bize bildir (retry kotayı yakar)
* `SupplierUnavailable` → **bekle**, geçicidir (devre kesici devreye girer)
* `SupplierBadResponse` → **bot koruması / panel değişmiş** olabilir

Hepsi tek `SupplierError`'a toplansaydı panel "senkron başarısız" derdi ve
yönetici 30 günlük ölü bir token'ı günlerce bekleyebilirdi.
"""
from __future__ import annotations

import abc
import dataclasses
import datetime
from decimal import Decimal


class SupplierError(Exception):
    """Tedarikçi katmanının tüm hatalarının kökü."""


class SupplierAuthError(SupplierError):
    """401/403 — token geçersiz veya süresi dolmuş. Yeniden denenmez."""


class SupplierBadRequest(SupplierError):
    """400 — istek biçimi yanlış. KALICIDIR; yeniden denenmez (rapor §2.11)."""


class SupplierUnavailable(SupplierError):
    """502/503/504/429/timeout — geçici. Denemeler tükendikten sonra atılır."""


class SupplierBadResponse(SupplierError):
    """Yanıt JSON değil ya da beklenen şekilde değil.

    En sık nedeni Cloudflare challenge sayfasıdır (HTTP 200 + HTML). Bunu
    `SupplierUnavailable` saymak "sunucu düştü" teşhisi üretir ve yönetici bot
    korumasını hiç düşünmez.
    """


@dataclasses.dataclass(frozen=True, slots=True)
class SupplierUnit:
    """Satış birimi. Fiyat ve stok BU birim cinsindendir."""

    name: str
    multiplier: Decimal
    is_default: bool


@dataclasses.dataclass(frozen=True, slots=True)
class SupplierFavorite:
    """Favori listesindeki tek ürün (`GET /favoriler/urunler` kaydı)."""

    external_id: int
    code: str
    name: str
    brand: str | None
    list_price: Decimal | None
    #: ORAN (0.20), yüzde değil — dönüşüm sınırda yapılır.
    vat_rate: Decimal | None
    min_order: Decimal | None
    has_image: bool
    stock_status: str | None
    category_path: str | None
    opened_at: datetime.datetime | None
    stockless: bool
    #: KESİRLİ olabilir (ölçümde 12.5). `Decimal`, `int` DEĞİL.
    stock_qty: Decimal
    unit_name: str | None
    unit_multiplier: Decimal | None
    barcode: str | None


@dataclasses.dataclass(frozen=True, slots=True)
class PriceBreakdown:
    """Bir ödeme tipinin fiyat kırılımı (PEŞİN / KREDİ KARTI / SEZON)."""

    sub_account_id: int
    name: str
    is_default: bool
    #: KDV HARİÇ net. Maliyetin tek doğru kaynağı budur (D-3).
    net: Decimal
    discounts: tuple[Decimal, ...]
    order: int


@dataclasses.dataclass(frozen=True, slots=True)
class SupplierPrice:
    """`POST /fiyat` yanıtındaki tek ürün."""

    external_id: int
    base: Decimal | None
    vat_rate: Decimal | None
    currency_id: int | None
    campaign: bool
    #: Zarftaki (`fiyatlar[id]`) net. **MALİYET DEĞİLDİR** — 100 üründe ölçüldü,
    #: varsayılan kırılımdan ortalama %10,1 pahalı. Yalnız karşılaştırma ve
    #: teşhis için saklanır; hesaba GİRMEZ.
    envelope_net: Decimal | None
    breakdowns: tuple[PriceBreakdown, ...]

    @property
    def default_breakdown(self) -> PriceBreakdown | None:
        """Varsayılan (her zaman PEŞİN) kırılım — maliyetin kaynağı.

        `None` dönerse maliyet HESAPLANAMAZ; uydurmak yerine `KIRILIM_YOK`
        bayrağı konur (zararına satış görünmez olmasın).
        """
        for k in self.breakdowns:
            if k.is_default:
                return k
        return None


class SupplierClient(abc.ABC):
    """Bir tedarikçi panelinden veri çekmenin sözleşmesi."""

    @abc.abstractmethod
    async def fetch_favorites(self) -> list[SupplierFavorite]:
        """Favori listesinin TAMAMI (sayfalama yok)."""

    @abc.abstractmethod
    async def fetch_prices(self, external_ids: list[int]) -> dict[int, SupplierPrice]:
        """Verilen ürünlerin fiyat kırılımı. Batch bölme uygulamanın işidir."""

    @abc.abstractmethod
    async def refresh_token(self) -> tuple[str, datetime.datetime | None]:
        """Kayan pencere token yenilemesi → (yeni token, bitiş zamanı)."""
