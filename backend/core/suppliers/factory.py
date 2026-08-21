"""Sağlayıcı fabrikası — `core/payments/factory.py` deseni.

`lru_cache` bilinçli olarak YOK: istemci tedarikçi satırından (token, base_url,
timeout) kuruluyor ve o satır panelden değişebiliyor. Önbelleğe alınmış bir
istemci, token güncellendikten sonra ESKİ token'la denemeye devam eder ve
yönetici "değiştirdim ama hâlâ 401" derdi.
"""
from __future__ import annotations

from core.suppliers.base import SupplierClient
from core.suppliers.yildirim import YildirimClient


def build_client(supplier) -> SupplierClient:
    """`Supplier` satırından çalışan bir istemci üretir.

    `provider` bilinmiyorsa SESSİZ geçmez: bilinmeyen bir sağlayıcı adı,
    senkronun hiç koşmaması demektir ve panelde "hiç veri gelmedi" diye
    görünürdü.
    """
    if supplier.provider == "yildirim":
        return YildirimClient(
            token=supplier.api_token, base_url=supplier.base_url
        )
    raise ValueError(f"bilinmeyen tedarikçi sağlayıcısı: {supplier.provider!r}")
