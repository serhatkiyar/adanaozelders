from __future__ import annotations

import logging
from decimal import Decimal

from core.config import settings
from core.payments.base import ChargeResult, PaymentProvider

logger = logging.getLogger("ceyhan.payments")


class IyzicoProvider(PaymentProvider):
    """iyzico adaptörü (üretim hedefi).

    Anahtarlar `.env`'den gelir, SDK lazy import edilir (yalnız bu sağlayıcı
    seçiliyken gerekir). Gerçek akış Checkout Form / 3D Secure'dür: ``charge`` bir
    ödeme oturumu başlatıp kullanıcının yönlendirileceği ``redirect_url``
    (paymentPageUrl) döndürür; sonuç bir callback'te ``CheckoutForm.retrieve`` ile
    doğrulanır ve ``provider_ref=paymentId`` yazılır.

    Burada üretim iskeleti bırakıldı — anahtar/SDK yokken NET hata döner; bu yüzden
    geliştirmede ``PAYMENT_PROVIDER=fake`` kullanılır. Tamamlamak için aşağıdaki
    TODO'lar doldurulur (e-postadaki console→SMTP→SES yolunun aynısı).
    """

    name = "iyzico"

    def _require_config(self) -> None:
        if not (settings.IYZICO_API_KEY and settings.IYZICO_SECRET_KEY):
            raise RuntimeError(
                "iyzico anahtarları tanımsız (IYZICO_API_KEY / IYZICO_SECRET_KEY)."
            )

    async def charge(
        self, *, amount: Decimal, currency: str, booking_id: int, description: str
    ) -> ChargeResult:
        try:
            import iyzipay  # noqa: F401 — yalnız iyzico seçiliyken gerekir
        except ImportError:
            logger.error("iyzipay SDK kurulu değil (pip install iyzipay).")
            return ChargeResult(success=False, error="iyzico SDK kurulu değil")
        self._require_config()
        # TODO(prod): iyzipay.CheckoutFormInitialize.create(...) ile ödeme oturumu
        #   başlat; dönen paymentPageUrl'i redirect_url olarak ver. Callback'te
        #   CheckoutForm.retrieve ile doğrula, provider_ref=paymentId yaz.
        logger.warning("IyzicoProvider.charge iskelet — prod entegrasyonu tamamlanmalı.")
        return ChargeResult(success=False, error="iyzico entegrasyonu tamamlanmadı")

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        # TODO(prod): iyzipay.Refund.create(paymentTransactionId=provider_ref, ...)
        logger.warning("IyzicoProvider.refund iskelet — prod entegrasyonu tamamlanmalı.")
        return False
