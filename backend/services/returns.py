"""İade tutarı hesabı ve cayma hakkı kuralları — saf fonksiyonlar (pytest'li).

Yasal çerçeve:
- **Cayma hakkı** (Mesafeli Sözleşmeler Yönetmeliği m.9): teslimden itibaren
  14 gün, koşulsuz, gerekçesiz. Satıcı reddedemez.
- **Cayma istisnaları** (m.15): dijital içerik ifa edilmişse iade edilemez;
  projede dijital ürün zaten iade dışıdır.
- **Kargo bedeli** (m.12): tüm siparişten cayılırsa satıcı, teslimat masrafı
  dahil TÜM ödemeyi iade eder. Kısmi iadede mal müşteride kaldığı için kargo
  bedeli iade edilmez.
- **İndirim dağıtımı**: kupon indirimi sipariş geneline uygulanır; kısmi iadede
  yalnız iade edilen kalemlere düşen pay geri verilir, aksi halde müşteri
  indirimin tamamını cebe indirip malın bir kısmını elinde tutar.

## Kuruş sözleşmesi (İP-2a/M5, İP2A-14)

Tek yuvarlama standardı: **ROUND_HALF_UP**. Satır payları bağımsız
yuvarlandığında toplam sipariş indirimiyle tutmaz (3×100 TL + 20 TL kupon →
3 × 6,67 = 20,01) ve N parçalı iadenin toplamı tek seferlik iadeden sapar.
Bu yüzden indirim **bir kez, sipariş genelinde** ``allocate_discount_shares``
ile en-büyük-artık (largest remainder) yöntemiyle satırlara dağıtılır: paylar
kuruşu kuruşuna sipariş indirimine eşitlenir, artık kuruşlar deterministik
sırayla (en büyük ondalık artık, eşitlikte satır sırası) dağıtılır.

Satır İÇİNDEKİ kısmi adet iadelerinde pay ``line_discount_portion`` ile
kümülatif hesaplanır: bir satırın tüm adedi iade edildiğinde dağıtılan pay
TAM OLARAK o satırın payı olur, ara adımlar bu toplama yuvarlanır. Böylece
"parça parça iade" ile "tek seferde iade" aynı kuruşu üretir.
"""
from __future__ import annotations

import datetime
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")

#: Cayma hakkı süresi (gün) — teslimden itibaren.
WITHDRAWAL_WINDOW_DAYS = 14


def _q(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def withdrawal_deadline(
    delivered_at: datetime.datetime | None,
) -> datetime.datetime | None:
    """Cayma hakkının son günü. Teslim damgası yoksa None (henüz başlamamıştır)."""
    if delivered_at is None:
        return None
    return delivered_at + datetime.timedelta(days=WITHDRAWAL_WINDOW_DAYS)


def within_withdrawal_window(
    delivered_at: datetime.datetime | None, now: datetime.datetime
) -> bool:
    """Cayma hakkı süresi içinde mi?

    Henüz teslim edilmemiş sipariş için de cayılabilir (m.9: sözleşmenin
    kurulmasından teslime kadar da cayma mümkündür) → True.
    """
    deadline = withdrawal_deadline(delivered_at)
    if deadline is None:
        return True
    return now <= deadline


def line_refund_amount(
    unit_price: Decimal, quantity: int, *, refund_quantity: int
) -> Decimal:
    """Bir kalemden ``refund_quantity`` adet iade edilirse tutar (KDV dahil)."""
    if refund_quantity <= 0 or refund_quantity > quantity:
        raise ValueError(
            f"İade adedi 1..{quantity} arasında olmalı: {refund_quantity}"
        )
    return _q(Decimal(str(unit_price)) * refund_quantity)


def allocate_discount(
    line_gross: Decimal, order_subtotal: Decimal, order_discount: Decimal
) -> Decimal:
    """Sipariş genelindeki indirimin bu satıra düşen payı.

    Orantısal dağıtım: satır brütü / sipariş ara toplamı. Ara toplam sıfırsa
    (teorik) pay da sıfırdır.
    """
    subtotal = Decimal(str(order_subtotal))
    if subtotal <= 0:
        return Decimal("0.00")
    share = Decimal(str(line_gross)) / subtotal
    return _q(Decimal(str(order_discount)) * share)


def allocate_discount_shares(
    line_grosses: list[Decimal], order_discount: Decimal
) -> list[Decimal]:
    """Sipariş indirimini satırlara **kuruşu kuruşuna** dağıtır (saf).

    ``sum(sonuç) == min(order_discount, sum(line_grosses))`` — her zaman.
    Orantısal payların tek tek yuvarlanması bu eşitliği bozar (İP2A-14):
    3 × 100 TL satırda 20 TL indirim → 3 × 6,67 = 20,01 ≠ 20,00. En-büyük-artık
    yöntemi önce tabana yuvarlar, kalan kuruşları en büyük ondalık artığı olan
    satırlara verir; eşitlikte satır SIRASI belirler (deterministik).
    """
    grosses = [Decimal(str(g)) for g in line_grosses]
    toplam = sum(grosses, Decimal("0"))
    hedef = min(Decimal(str(order_discount)), toplam)
    if hedef <= 0 or toplam <= 0:
        return [Decimal("0.00") for _ in grosses]

    taban: list[Decimal] = []
    artik: list[tuple[Decimal, int]] = []
    for i, g in enumerate(grosses):
        tam = hedef * g / toplam
        alt = tam.quantize(CENT, rounding=ROUND_DOWN)
        taban.append(alt)
        artik.append((tam - alt, i))

    dagitilan = sum(taban, Decimal("0"))
    kalan_kurus = int(((hedef - dagitilan) / CENT).to_integral_value(ROUND_HALF_UP))
    # En büyük artık önce; eşit artıkta küçük index önce (deterministik).
    for _, i in sorted(artik, key=lambda t: (-t[0], t[1]))[: max(kalan_kurus, 0)]:
        taban[i] += CENT
    return taban


def line_discount_portion(
    line_share: Decimal, quantity: int, *, already: int, take: int
) -> Decimal:
    """Bir satırın indirim payından ``take`` adede düşen kısım (saf).

    ``already`` = bu satırdan DAHA ÖNCE iade edilmiş adet. Kümülatif tanım
    (``pay(k) = round(share * k / n)``, ``pay(n) = share``) sayesinde satırın
    tüm adedi hangi sırayla/parçayla iade edilirse edilsin dağıtılan toplam
    pay tam olarak ``line_share`` olur — son kuruş kaybolmaz, iki kez de
    verilmez.
    """
    if quantity <= 0 or take <= 0:
        return Decimal("0.00")
    share = Decimal(str(line_share))

    def _kumulatif(k: int) -> Decimal:
        if k >= quantity:
            return share
        if k <= 0:
            return Decimal("0.00")
        return _q(share * k / quantity)

    return _kumulatif(already + take) - _kumulatif(already)


def compute_refund(
    *,
    lines: list[dict],
    order_subtotal: Decimal,
    order_discount: Decimal,
    order_shipping: Decimal,
    is_full_order: bool,
) -> Decimal:
    """İade edilecek toplam tutar.

    ``lines``: ``{"unit_price", "quantity", "refund_quantity"}`` listesi.
    ``is_full_order``: siparişin TAMAMI iade ediliyorsa kargo bedeli de eklenir
    (m.12); kısmi iadede eklenmez.
    """
    gross = Decimal("0.00")
    for ln in lines:
        gross += line_refund_amount(
            ln["unit_price"], ln["quantity"], refund_quantity=ln["refund_quantity"]
        )
    gross = _q(gross)

    discount_share = allocate_discount(gross, order_subtotal, order_discount)
    amount = gross - discount_share
    if is_full_order:
        amount += Decimal(str(order_shipping))
    # Negatife düşmesin (aşırı indirim + yuvarlama).
    return _q(max(amount, Decimal("0.00")))


def is_full_return(lines: list[dict]) -> bool:
    """Seçim, verilen satır listesinin TAMAMINI kapsıyor mu (her satırın tüm adedi)?

    ⚠️ Bu **saf** yardımcı yalnız kendisine verilen satırlara bakar. Siparişin
    tamamının kapsanıp kapsanmadığı sorusu için `covers_whole_order` kullanın —
    yalnız buna bakmak İP2A-05'in ta kendisiydi: 2 kalemli siparişte bir kalemi
    tam adediyle iade eden müşteri "tam sipariş iadesi" sayılıp kargo bedelini
    de alıyor ve kupon serbest bırakılıyordu.
    """
    if not lines:
        return False
    return all(int(ln["refund_quantity"]) >= int(ln["quantity"]) for ln in lines)


def covers_whole_order(
    *, remaining_by_item: dict[int, int], selection_by_item: dict[int, int]
) -> bool:
    """Seçim, siparişte müşteride KALAN her adedi kapsıyor mu? (saf)

    ``remaining_by_item``: kalem → henüz iade edilmemiş adet (önceki taleplerin
    adetleri düşülmüş). Gerçek "tam iade" tanımı budur: seçimden sonra
    müşteride iade edilebilir hiçbir adet kalmıyorsa (m.12) kargo bedeli de
    iade edilir ve kupon serbest bırakılır.

    Parça parça yapılan iadelerin toplamı da tek seferlik tam iadeye eşitlenir:
    siparişi boşaltan SON talep "tam" sayılır ve kargoyu o alır.
    """
    kalan = {k: int(v) for k, v in remaining_by_item.items() if int(v) > 0}
    if not kalan:
        return False
    for item_id, adet in kalan.items():
        if int(selection_by_item.get(item_id, 0)) < adet:
            return False
    return True


def remaining_refundable(
    order_total: Decimal, already_refunded: Decimal
) -> Decimal:
    """Bu siparişten daha ne kadar iade edilebilir.

    Birden çok kısmi iade mümkün olduğundan toplam, sipariş tutarını AŞAMAZ —
    aşırı iade sağlayıcıda reddedilir ve mutabakatı bozar.
    """
    left = Decimal(str(order_total)) - Decimal(str(already_refunded))
    return _q(max(left, Decimal("0.00")))


def auto_approved(return_type: str) -> bool:
    """Bu tür talep otomatik onaylanır mı?

    Cayma hakkı koşulsuzdur: satıcının ret yetkisi yoktur, dolayısıyla admin
    onayı beklemek de hukuken savunulamaz. Ayıplı mal ve diğer talepler
    inceleme gerektirir.
    """
    return return_type == "CAYMA"
