"""KDV ayrıştırma — saf fonksiyonlar (pytest'li).

Türkiye'de perakende fiyatlar **KDV dahil** gösterilir; ürün fiyatı brüt tutardır.
Fatura ise matrah (net) ve vergiyi ayrı gösterir. Bu modül brüt tutardan içteki
vergiyi çıkarır:

    vergi = brüt × oran / (1 + oran)
    matrah = brüt − vergi

Oranlar (2026): basılı kitap %0, kırtasiye %20, dijital ürün/hizmet %20.
Oran ürün bazında ``Product.tax_rate``'te tutulur; sipariş anında
``OrderItem.tax_rate``/``tax_amount``'a snapshot'lanır — ürünün oranı sonradan
değişse bile fatura sipariş anındaki oranla kesilmelidir.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    """Para birimi kuruşuna yuvarla (ROUND_HALF_UP — projenin para standardı)."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def tax_from_gross(gross: Decimal, rate: Decimal) -> Decimal:
    """KDV DAHİL tutarın içindeki vergi.

    ``rate`` orandır (0.20 = %20), yüzde değil. Negatif/aşırı oranlar reddedilir
    çünkü sessizce yanlış fatura üretmek, hata vermekten kötüdür.
    """
    gross = Decimal(str(gross))
    rate = Decimal(str(rate))
    if rate < 0 or rate >= 1:
        raise ValueError(f"KDV oranı 0 ≤ oran < 1 olmalı: {rate}")
    if gross <= 0 or rate == 0:
        return Decimal("0.00")
    return _q(gross * rate / (Decimal("1") + rate))


def net_from_gross(gross: Decimal, rate: Decimal) -> Decimal:
    """KDV hariç matrah."""
    return _q(Decimal(str(gross)) - tax_from_gross(gross, rate))


def line_tax(unit_price: Decimal, quantity: int, rate: Decimal) -> Decimal:
    """Bir sipariş satırının toplam KDV'si.

    Vergi SATIR TOPLAMI üzerinden hesaplanır (birim başına hesaplayıp çarpmak,
    kuruş yuvarlamasını miktar kadar büyütür: 3 × 0,005 ≠ 0,02).
    """
    gross = Decimal(str(unit_price)) * int(quantity)
    return tax_from_gross(gross, rate)


def totals_by_rate(lines: list[dict]) -> dict[str, Decimal]:
    """Fatura için oran bazında KDV kırılımı.

    Her satır: ``{"unit_price", "quantity", "tax_rate"}``. Dönen sözlüğün
    anahtarı oranın metin hâlidir ("0.20"), değeri o orandaki toplam vergidir.
    Farklı oranlar (kitap %0 + kırtasiye %20) aynı siparişte bulunabilir ve
    fatura bunları ayrı satırlarda göstermek zorundadır.
    """
    out: dict[str, Decimal] = {}
    for ln in lines:
        rate = Decimal(str(ln.get("tax_rate") or 0))
        tax = line_tax(ln["unit_price"], ln["quantity"], rate)
        key = format(rate.normalize(), "f")
        out[key] = out.get(key, Decimal("0.00")) + tax
    return {k: _q(v) for k, v in out.items()}
