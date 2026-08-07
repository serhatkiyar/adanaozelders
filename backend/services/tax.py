"""KDV ayrıştırma — saf fonksiyonlar (pytest'li).

Türkiye'de perakende fiyatlar **KDV dahil** gösterilir; ürün fiyatı brüt tutardır.
Fatura ise matrah (net) ve vergiyi ayrı gösterir. Bu modül brüt tutardan içteki
vergiyi çıkarır:

    vergi = brüt × oran / (1 + oran)
    matrah = brüt − vergi

## Oranlar VERİDİR, kod değildir

Bu modülde hiçbir oran, hiçbir muafiyet ve hiçbir kategori kuralı GÖMÜLÜ
DEĞİLDİR. Oran ürün bazında ``Product.tax_rate``'te tutulur; sipariş anında
``OrderItem.tax_rate``/``tax_amount``'a snapshot'lanır — ürünün oranı sonradan
değişse bile fatura sipariş anındaki oranla kesilmelidir. Kargonun oranı
``settings.SHIPPING_TAX_RATE``'ten gelir ve ayarlanmamışsa **hesaplanmaz**
(sessizce %0 sayılmaz).

Hangi ürüne hangi oranın uygulanacağı bir mevzuat kararıdır; bu kod yalnız
aritmetiği yapar. Uygunluk kullanıcının sorumluluğundadır ve mali müşavir
onayı gerektirir (bkz. ``docs/ip5-kdv-fatura-sozlesme.md``).

## Kuruş sözleşmesi

Tek yuvarlama standardı **ROUND_HALF_UP** (projenin para standardı, İP-2a/M5).
Kupon indirimi satırlara ``returns.allocate_discount_shares`` ile
**en-büyük-artık** yöntemiyle bir kez dağıtılır; vergi her satırda
``brüt − pay`` üzerinden hesaplanır. Matrah TÜRETİLİR (``net = brüt − vergi``),
bağımsız yuvarlanmaz — ikinci bir yuvarlama ikinci bir kuruş artığı üretirdi.
Sonuç değişmezi: ``Σ(matrah) + Σ(vergi) == orders.total``.
"""
from __future__ import annotations

import dataclasses
from decimal import ROUND_HALF_UP, Decimal

from services.returns import allocate_discount_shares

CENT = Decimal("0.01")

#: Oran anahtarının metin biçimi — ``Numeric(5,4)`` ile birebir ("0.2000").
#: Sabit basamak seçildi: "0.2" ve "0.20" aynı oranın iki anahtarı olsaydı
#: kırılımda aynı oran İKİ satır olarak görünebilirdi.
RATE_QUANT = Decimal("0.0001")


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


# ── Sipariş kırılımı (İP-5) ──────────────────────────────────────────────────


def rate_key(rate: Decimal | float | str | None) -> str:
    """Oranın kırılımdaki metin anahtarı — daima 4 basamak ("0.2000")."""
    return format(Decimal(str(rate or 0)).quantize(RATE_QUANT), "f")


@dataclasses.dataclass(frozen=True)
class OrderTax:
    """Bir siparişin vergi kırılımı — sipariş anında hesaplanır ve SAKLANIR.

    ``complete=False`` ise kırılım EKSİKTİR (bugün tek sebebi: kargo ücreti
    alınıyor ama ``SHIPPING_TAX_RATE`` ayarlanmamış). Eksik kırılım sessizce
    tamamlanmış gibi davranmaz: ``net_total + tax_total`` sipariş toplamına
    eşit OLMAZ ve fatura ucu böyle bir siparişi reddeder.
    """

    #: Kalem sırasına göre satır vergileri (indirim payı düşülmüş brütten).
    line_taxes: list[Decimal]
    #: Kalem sırasına göre satırlara düşen kupon payları.
    discount_shares: list[Decimal]
    #: Kargonun içindeki vergi; oran belirsizse None ("hesaplanamadı").
    shipping_tax: Decimal | None
    #: Oran bazında [{"rate", "base", "tax"}] — fatura satırlarının kaynağı.
    breakdown: list[dict]
    net_total: Decimal
    tax_total: Decimal
    complete: bool


def order_breakdown(
    *,
    lines: list[dict],
    discount: Decimal,
    shipping_fee: Decimal,
    shipping_tax_rate: Decimal | None,
) -> OrderTax:
    """Siparişin oran bazında matrah/vergi kırılımı (saf).

    ``lines``: ``{"unit_price", "quantity", "tax_rate"}`` — kalem SIRASI
    korunur (çağıran satır vergilerini bu sırayla snapshot'lar).

    Aritmetik sözleşmesi (docs/ip5-kdv-fatura-sozlesme.md §4):

    1. Satır brütü = ``unit_price × quantity`` (kuruşa yuvarlanır).
    2. Kupon indirimi satırlara **bir kez**, en-büyük-artıkla dağıtılır
       (``returns.allocate_discount_shares``). İP-2a'nın iade yolunda
       kullandığı desenin AYNISIDIR — iki farklı dağıtım, aynı siparişin
       satışında ve iadesinde farklı kuruş üretirdi.
    3. Satır vergisi ``brüt − pay`` üzerinden hesaplanır (S-2): indirim
       KDV dahil fiyatı düşürdüğü için içindeki vergiyi de düşürür.
    4. Matrah TÜRETİLİR: ``base = (brüt − pay) − vergi``. Bağımsız
       yuvarlanmaz; ikinci yuvarlama ikinci kuruş artığı demektir.
    5. Kargo kendi oranıyla (S-3) aynı biçimde ayrıştırılır.

    Bu sıra sayesinde ``Σ base + Σ tax`` tam olarak
    ``subtotal − discount + shipping`` eder; ayrıca bir "artık düzeltmesi"
    gerekmez.
    """
    grosses = [
        _q(Decimal(str(ln["unit_price"])) * int(ln["quantity"])) for ln in lines
    ]
    shares = allocate_discount_shares(grosses, Decimal(str(discount or 0)))

    # Aynı oran birden çok satırdan gelebilir; kırılım oran bazında toplanır.
    toplu: dict[str, dict] = {}
    line_taxes: list[Decimal] = []

    def _ekle(rate: Decimal, base: Decimal, vergi: Decimal) -> None:
        anahtar = rate_key(rate)
        kayit = toplu.setdefault(
            anahtar, {"rate": anahtar, "base": Decimal("0.00"), "tax": Decimal("0.00")}
        )
        kayit["base"] += base
        kayit["tax"] += vergi

    for ln, brut, pay in zip(lines, grosses, shares, strict=True):
        rate = Decimal(str(ln.get("tax_rate") or 0))
        net_brut = brut - pay
        vergi = tax_from_gross(net_brut, rate)
        _ekle(rate, net_brut - vergi, vergi)
        line_taxes.append(vergi)

    kargo = _q(Decimal(str(shipping_fee or 0)))
    complete = True
    shipping_tax: Decimal | None
    if kargo <= 0:
        # Sıfır kargonun vergisi her oranda sıfırdır → belirsizlik doğmaz,
        # ayar boş olsa bile kırılım TAMDIR.
        shipping_tax = Decimal("0.00")
    elif shipping_tax_rate is None:
        # Ayar boş: hesaplama YAPILMAZ ve kargo kırılıma girmez. Sessizce %0
        # yazmak, mevzuat kararı verilmeden kalıcı bir iddia kaydetmek olurdu.
        shipping_tax = None
        complete = False
    else:
        oran = Decimal(str(shipping_tax_rate))
        shipping_tax = tax_from_gross(kargo, oran)
        _ekle(oran, kargo - shipping_tax, shipping_tax)

    breakdown = [toplu[k] for k in sorted(toplu)]
    return OrderTax(
        line_taxes=line_taxes,
        discount_shares=list(shares),
        shipping_tax=shipping_tax,
        breakdown=breakdown,
        net_total=sum((s["base"] for s in breakdown), Decimal("0.00")),
        tax_total=sum((s["tax"] for s in breakdown), Decimal("0.00")),
        complete=complete,
    )


def breakdown_to_json(breakdown: list[dict]) -> list[dict]:
    """Kırılımı JSONB'ye yazılabilir hâle getirir (Decimal → metin).

    Metin seçildi: JSON'da sayı olarak yazmak değeri float'a çevirir ve
    kuruş kaybı kalıcılaşır.
    """
    return [
        {"rate": s["rate"], "base": str(_q(s["base"])), "tax": str(_q(s["tax"]))}
        for s in breakdown
    ]


def refund_breakdown(refund_lines: list[dict]) -> OrderTax:
    """İADE EDİLEN tutarların oran bazında matrah/vergi kırılımı (saf).

    ``refund_lines``: ``{"amount", "tax_rate"}`` — ``amount`` iade edilen NET
    tutardır (kupon payı düşülmüş; İP-2a sözleşmesi: ``refund_amount =
    Σ items.amount + shipping_refund``).

    Bu kırılım SAKLANMAZ, türetilir — ama girdileri snapshot'tır
    (``order_items.tax_rate`` + ``order_return_items.amount``), yani ürünün
    güncel oranına bakmaz ve tarihsel olarak kararlıdır.
    """
    toplu: dict[str, dict] = {}
    for ln in refund_lines:
        rate = Decimal(str(ln.get("tax_rate") or 0))
        brut = _q(Decimal(str(ln["amount"])))
        vergi = tax_from_gross(brut, rate)
        anahtar = rate_key(rate)
        kayit = toplu.setdefault(
            anahtar, {"rate": anahtar, "base": Decimal("0.00"), "tax": Decimal("0.00")}
        )
        kayit["base"] += brut - vergi
        kayit["tax"] += vergi
    breakdown = [toplu[k] for k in sorted(toplu)]
    return OrderTax(
        line_taxes=[],
        discount_shares=[],
        shipping_tax=None,
        breakdown=breakdown,
        net_total=sum((s["base"] for s in breakdown), Decimal("0.00")),
        tax_total=sum((s["tax"] for s in breakdown), Decimal("0.00")),
        complete=True,
    )
