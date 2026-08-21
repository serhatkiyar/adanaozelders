"""Karantina bayrakları — SAF.

Rapor §3.1'in kod karşılığı. Bayrak **engellemez**, işaretler: 11.915 ürünün
9.334'ü uyarısızdı, kalan 2.581'i "satılamaz" değil "önce bak" demektir. Karar
yöneticinindir; bizim işimiz kararın önüne veriyi koymak.

Neden bayrak listesi sabit bir sözlük (`models/supplier.QUARANTINE_FLAGS`):
panel her kodu Türkçe bir uyarıya çeviriyor. Serbest metin olsaydı yeni bir
bayrak ekranda ham kod olarak görünür ve yönetici ne demek olduğunu bilemezdi.
"""
from __future__ import annotations

from decimal import Decimal

from core.suppliers.barcode import validate_barcode
from core.suppliers.base import SupplierFavorite, SupplierPrice
from core.suppliers.pricing import CostResult

#: Kitap kategorisinin kökü. Türkiye'de basılı kitapta KDV %0 normaldir;
#: kırtasiyede değildir (raporda 253 şüpheli kayıt sayıldı).
_KITAP_ONEKI = "KİTAP"

#: Fiyat ve stok satış birimi cinsindendir. "Adet" dışındaki her birim, ürün
#: adında belirtilmediğinde müşteriyi yanıltır: 153 TL "12 defterin fiyatı"dır.
_ADET = "adet"


def favorite_flags(fav: SupplierFavorite) -> tuple[str, ...]:
    """Ürün kaydının kendisinden çıkan bayraklar (fiyat gerekmez)."""
    bayraklar: list[str] = []

    if fav.barcode is None or not str(fav.barcode).strip():
        bayraklar.append("BARKOD_YOK")
    elif not validate_barcode(fav.barcode).valid:
        bayraklar.append("BARKOD_BOZUK")

    if fav.unit_name and fav.unit_name.strip().lower() != _ADET:
        bayraklar.append("BIRIM_ADET_DEGIL")

    if not fav.has_image:
        bayraklar.append("GORSEL_YOK")

    if fav.vat_rate is not None and fav.vat_rate == 0:
        yol = (fav.category_path or "").upper()
        if not yol.startswith(_KITAP_ONEKI):
            bayraklar.append("KDV_SIFIR_SUPHELI")

    return tuple(bayraklar)


def price_flags(price: SupplierPrice, cost: CostResult) -> tuple[str, ...]:
    """Fiyat yanıtından çıkan bayraklar."""
    bayraklar: list[str] = list(cost.flags)

    varsayilan = price.default_breakdown
    sifir_taban = price.base is not None and price.base == 0
    sifir_net = varsayilan is not None and varsayilan.net == 0
    if sifir_taban or sifir_net:
        bayraklar.append("SIFIR_FIYAT")

    if price.currency_id is not None and price.currency_id != 1:
        # Döviz fiyatını TL sanmak, ürünü maliyetinin çok altına satmaktır.
        bayraklar.append("DOVIZ_TL_DEGIL")

    if (
        varsayilan is not None
        and price.base is not None
        and varsayilan.net > price.base
        and not price.campaign
    ):
        # Rapordaki KANARYA/KARTAL bloknot hatası: liste 150,00 / peşin 239,52.
        bayraklar.append("NET_TABANDAN_YUKSEK")

    return tuple(dict.fromkeys(bayraklar))


def link_flags(
    *, multiple_match: bool = False, product_already_linked: bool = False
) -> tuple[str, ...]:
    """Eşleştirme aşamasında doğan bayraklar."""
    bayraklar: list[str] = []
    if multiple_match:
        bayraklar.append("COKLU_ESLESME")
    if product_already_linked:
        bayraklar.append("URUN_ZATEN_BAGLI")
    return tuple(bayraklar)


def merge_flags(*gruplar: tuple[str, ...]) -> list[str]:
    """Bayrakları sırayı koruyarak birleştirir ve tekilleştirir."""
    birlesik: dict[str, None] = {}
    for grup in gruplar:
        for b in grup:
            birlesik[b] = None
    return list(birlesik)


def stock_flags(*, is_favorite: bool) -> tuple[str, ...]:
    """Favoriden çıkmış kayıt işaretlenir; SİLİNMEZ.

    Kayıt geçmiş bağı ve maliyeti taşıyor — yönetici "bunu tekrar favoriye
    alayım mı" kararını buna bakarak veriyor. Ama vitrin uygunluğundan düşer
    (veri artık tazelenmiyor)."""
    return () if is_favorite else ("FAVORI_DISI",)


def _decimal_or_none(x) -> Decimal | None:
    return None if x is None else Decimal(str(x))
