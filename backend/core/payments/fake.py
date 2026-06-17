from __future__ import annotations

import logging
import secrets
from decimal import Decimal

from core.payments.base import (
    BuyerInfo,
    ChargeResult,
    PaymentProvider,
    SubMerchantInfo,
    SubMerchantResult,
)

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

    async def create_submerchant(self, info: SubMerchantInfo) -> SubMerchantResult:
        key = f"fake-sm-{info.external_id}-{secrets.token_urlsafe(6)}"
        logger.info("FakePayment submerchant ACTIVE ext=%s key=%s", info.external_id, key)
        return SubMerchantResult(success=True, sub_merchant_key=key, status="ACTIVE")

    async def update_submerchant(
        self, sub_merchant_key: str, info: SubMerchantInfo
    ) -> SubMerchantResult:
        logger.info("FakePayment submerchant update OK key=%s", sub_merchant_key)
        return SubMerchantResult(
            success=True, sub_merchant_key=sub_merchant_key, status="ACTIVE"
        )
