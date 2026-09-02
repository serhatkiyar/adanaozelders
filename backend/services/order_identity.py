"""Siparişin teslimat (fulfillment) ilerlemesi — saf yardımcı (DB'siz, pytest'li).

``order.status`` para akışını taşır (PENDING→PAID→…→REFUNDED) ve tek kolonlu bir
FSM'dir; "siparişin bir kısmı teslim edildi" bilgisini ifade edemez. Shopify'ın
``displayFulfillmentStatus`` ekseninde yaptığı gibi teslimat ilerlemesi **ayrı
bir eksendir** ve kalem adetlerinden **türetilir** — hiçbir yerde elle set
edilmez, saklanmaz.

Numara üretimi burada değil ``core.order_no``dadır (model katmanı default'u).
"""
from __future__ import annotations

from collections.abc import Mapping


def fulfillment_state(
    ordered: Mapping[int, int],
    delivered: Mapping[int, int],
) -> str:
    """``NONE`` | ``PARTIAL`` | ``ALL`` — kalem adetlerinden türetilir.

    ``ordered``: sipariş kalemi id → sipariş edilen adet (yalnız fiziksel).
    ``delivered``: sipariş kalemi id → teslim EDİLMİŞ adet.

    Kalem yoksa ``NONE``: dijital siparişte teslim edilecek fiziksel bir şey
    yoktur, "hepsi teslim edildi" demek yanıltıcı olur. Bozuk veride (teslim >
    sipariş) ekran çökmez, tavan ``ALL``dur.
    """
    if not ordered:
        return "NONE"
    toplam_teslim = sum(
        min(delivered.get(item_id, 0), adet) for item_id, adet in ordered.items()
    )
    if toplam_teslim <= 0:
        return "NONE"
    return "ALL" if toplam_teslim >= sum(ordered.values()) else "PARTIAL"
