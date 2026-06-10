from __future__ import annotations

import logging
import secrets
from decimal import Decimal

from core.payments.base import BuyerInfo, ChargeResult, PaymentProvider

logger = logging.getLogger("ceyhan.payments")


class FakePaymentProvider(PaymentProvider):
    """Gerçek tahsilat YAPMAZ; her zaman başarı döner.

    iyzico/PayTR hesabı olmadan tüm escrow akışını (öde → emanet → release/refund)
    localhost'ta uçtan uca denemeyi sağlar. Geliştirme/test varsayılanı.
    """

    name = "fake"

    async def charge(
        self,
        *,
        amount: Decimal,
        currency: str,
        booking_id: int,
        description: str,
        reference: str = "",
        buyer: BuyerInfo | None = None,
    ) -> ChargeResult:
        ref = f"fake-{booking_id}-{secrets.token_urlsafe(8)}"
        logger.info(
            "FakePayment charge OK booking=%s amount=%s %s ref=%s",
            booking_id,
            amount,
            currency,
            ref,
        )
        return ChargeResult(success=True, provider_ref=ref)

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        logger.info("FakePayment refund OK ref=%s amount=%s", provider_ref, amount)
        return True
