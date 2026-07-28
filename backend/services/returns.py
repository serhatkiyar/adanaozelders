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
"""
from __future__ import annotations

import datetime
from decimal import ROUND_HALF_UP, Decimal

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
    """Seçim siparişin TAMAMINI kapsıyor mu (her kalemin tüm adedi)?"""
    if not lines:
        return False
    return all(int(ln["refund_quantity"]) >= int(ln["quantity"]) for ln in lines)


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
