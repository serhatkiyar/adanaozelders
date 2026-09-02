"""Müşteri-yüzü sipariş numarası üretimi (saf, pytest'li).

``core``'da yaşar çünkü ``models.store.Order`` kolon **default**'u olarak bunu
çağırır ve model katmanı ``services``'ten import edemez (mimari sınır) — kimlik
üretimi ``uuid4`` gibi altyapısal bir primitiftir, iş kuralı değildir.

Neden gerek var: ekranlarda bugüne kadar ham ``#{order.id}`` yazıyordu ve sıralı
olduğu için "kaç sipariş aldılar" sorusunu dışarıya cevaplıyordu. ``tracking_no``
da yerine geçemez — ``ELDEN-R{run}-S{stop}`` biçimindedir ve her başarısız
teslimat denemesinde ``None``'lanıp yeniden atanır, kalıcı referans değildir.
"""
from __future__ import annotations

import re
import secrets

#: Müşteriye gösterilen biçim: ``4827-1930-5612`` — Amazon'un 3-7-7 sipariş
#: numarası gibi gruplanmış; telefonda okunması ve destekte aranması kolay.
ORDER_NO_RE = re.compile(r"\d{4}-\d{4}-\d{4}")

_GROUPS = 3
_GROUP_LEN = 4


def generate_order_no() -> str:
    """Rastgele, sıralı olmayan sipariş numarası üretir.

    Uzay 10^12: N sipariş varken bir INSERT'ün çakışma olasılığı N/10^12 —
    milyon siparişte bile 10^-6. Son söz yine de ``orders.order_no`` üzerindeki
    unique index'indir; entropi kolaylık, index güvencedir.
    """
    return "-".join(
        f"{secrets.randbelow(10**_GROUP_LEN):0{_GROUP_LEN}d}" for _ in range(_GROUPS)
    )
