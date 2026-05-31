from __future__ import annotations

from functools import lru_cache

from core.config import settings
from core.payments.base import PaymentProvider
from core.payments.fake import FakePaymentProvider
from core.payments.iyzico import IyzicoProvider


@lru_cache
def get_payment_provider() -> PaymentProvider:
    """``PAYMENT_PROVIDER`` ayarına göre sağlayıcı seçer (singleton)."""
    provider = (settings.PAYMENT_PROVIDER or "fake").strip().lower()
    if provider == "iyzico":
        return IyzicoProvider()
    return FakePaymentProvider()
