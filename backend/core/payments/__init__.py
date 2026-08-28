"""Sağlayıcıdan bağımsız ödeme katmanı.

Geliştirmede dış hesap/anahtar GEREKMEZ: ``PAYMENT_PROVIDER=fake`` tüm escrow
akışını anında başarıyla simüle eder. Üretimde aynı arayüzle ``iyzico``'ya geçilir
(yalnız .env değişir). İş mantığı (escrow/komisyon) ``services/payment_service``'te.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from core.payments.base import (
    BuyerInfo,
    ChargeResult,
    CheckoutResult,
    PaymentProvider,
    SubMerchantInfo,
    SubMerchantResult,
)
from core.payments.factory import get_payment_provider

if TYPE_CHECKING:  # döngüsel import yok; yalnız tip için
    from models.client import Client
    from models.tutor import Tutor

__all__ = [
    "BuyerInfo",
    "ChargeResult",
    "CheckoutResult",
    "PaymentProvider",
    "SubMerchantInfo",
    "SubMerchantResult",
    "get_payment_provider",
    "buyer_from_client",
    "buyer_from_tutor",
]


def buyer_from_client(client: "Client", *, ip: str | None = None) -> BuyerInfo:
    """Ödeyen öğrenciden hosted-checkout alıcı bilgisi üretir (3 ödeme yüzeyi ortak)."""
    return BuyerInfo(
        id=f"client-{client.id}",
        name=client.first_name or "Ad",
        surname=client.last_name or "Soyad",
        email=client.email,
        ip=ip or "127.0.0.1",
    )


def buyer_from_tutor(tutor: "Tutor", *, ip: str | None = None) -> BuyerInfo:
    """Ödeyen EĞİTMENDEN alıcı bilgisi (ilan öne çıkarma satın alması).

    Ayrı bir fonksiyon: `Tutor` ve `Client` ayrı tablolardır, ortak bir taban
    sınıfları yoktur ve `id` önekinin ayrışması sağlayıcı tarafında iki farklı
    kişiyi aynı alıcı sanmayı imkânsız kılar.
    """
    return BuyerInfo(
        id=f"tutor-{tutor.id}",
        name=tutor.first_name or "Ad",
        surname=tutor.last_name or "Soyad",
        email=tutor.email,
        ip=ip or "127.0.0.1",
    )
