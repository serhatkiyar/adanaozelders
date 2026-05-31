"""Sağlayıcıdan bağımsız ödeme katmanı.

Geliştirmede dış hesap/anahtar GEREKMEZ: ``PAYMENT_PROVIDER=fake`` tüm escrow
akışını anında başarıyla simüle eder. Üretimde aynı arayüzle ``iyzico``'ya geçilir
(yalnız .env değişir). İş mantığı (escrow/komisyon) ``services/payment_service``'te.
"""
from core.payments.base import ChargeResult, PaymentProvider
from core.payments.factory import get_payment_provider

__all__ = ["ChargeResult", "PaymentProvider", "get_payment_provider"]
