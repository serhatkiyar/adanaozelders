"""Maliyet ve marj hesabı — SAF, `Decimal`.

## D-3: maliyet nereden gelir

Rapor §2.6 bunu 100 üründe ölçtü ve panel üzerinden elle doğruladı:

    varsayilan = kirilim[id] içindeki `varsayilan == True` kayıt   (hep PEŞİN)
    maliyet_haric = varsayilan.net
    maliyet_dahil = maliyet_haric × (1 + kdv)

Zarftaki `fiyatlar[id].net` maliyet DEĞİLDİR: 99/100 üründe varsayılan
kırılımdan ortalama **%10,1 pahalı**. Onu kullanan bir uygulama her üründe
yaklaşık %10 yanlış marj gösterir ve zararına satışları "kârlı" sanır.

## Yuvarlama

Tek kural: **HALF_UP, bir kez, en sonda**. Brüt, API'nin verdiği tam
hassasiyetli net üzerinden hesaplanır. Önce net yuvarlanıp sonra çarpılsaydı
kalem başına bir kuruş kayar; 11.915 kalemlik bir katalogda marj raporu
görünür biçimde kayar.
"""
from __future__ import annotations

import dataclasses
from decimal import ROUND_HALF_UP, Decimal

from core.suppliers.base import SupplierPrice

KURUS = Decimal("0.01")


def _kurusla(x: Decimal) -> Decimal:
    return x.quantize(KURUS, rounding=ROUND_HALF_UP)


@dataclasses.dataclass(frozen=True, slots=True)
class CostResult:
    net: Decimal | None
    gross: Decimal | None
    breakdown_name: str | None
    flags: tuple[str, ...]


@dataclasses.dataclass(frozen=True, slots=True)
class Margin:
    absolute: Decimal | None
    percent: Decimal | None
    #: Maliyet BİLİNMİYORSA `False`. "Zararına değil" demek değildir — veri
    #: yokken kırmızı rozet basmak yöneticiyi yanlış yönlendirir.
    below_cost: bool


def compute_cost(price: SupplierPrice) -> CostResult:
    """Varsayılan kırılımdan KDV dahil/hariç maliyet."""
    varsayilan = price.default_breakdown
    if varsayilan is None:
        # Maliyet HESAPLANAMAZ. Uydurmak (ör. zarftaki net'e düşmek) zararına
        # satışı görünmez yapardı — bayrakla ve boş bırak.
        return CostResult(None, None, None, ("KIRILIM_YOK",))

    oran = price.vat_rate if price.vat_rate is not None else Decimal("0")
    net_ham = varsayilan.net
    brut_ham = net_ham * (Decimal("1") + oran)
    return CostResult(
        net=_kurusla(net_ham),
        gross=_kurusla(brut_ham),
        breakdown_name=varsayilan.name,
        flags=(),
    )


def margin(sale_price: Decimal, cost_gross: Decimal | None) -> Margin:
    """Brüt marj: (satış − maliyet) / satış.

    Sınır `>=`: maliyeti satış fiyatına EŞİT ürün de zararınadır. Eşitlikte
    kâr sıfırdır ama komisyon, kargo ve iade maliyeti yöneticinin tarafında
    hâlâ vardır; "sıfır kâr"ı uyarısız geçirmek zararı sessizleştirir.
    """
    if cost_gross is None:
        return Margin(None, None, False)
    if sale_price <= 0:
        return Margin(None, None, True)
    mutlak = _kurusla(sale_price - cost_gross)
    yuzde = _kurusla((sale_price - cost_gross) / sale_price * Decimal("100"))
    return Margin(mutlak, yuzde, cost_gross >= sale_price)
