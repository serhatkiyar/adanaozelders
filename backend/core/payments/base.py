from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass(slots=True)
class ChargeResult:
    """Bir tahsilat denemesinin sonucu.

    ``redirect_url`` doluysa (prod 3DS/Checkout) kullanıcı oraya yönlendirilmeli;
    sonuç callback ile kesinleşir. Fake sağlayıcıda anında ``success=True`` döner.
    """

    success: bool
    provider_ref: str | None = None
    redirect_url: str | None = None
    error: str | None = None


class PaymentProvider(ABC):
    """Ödeme sağlayıcısı soyutlaması (e-posta katmanıyla aynı desen).

    Geliştirmede ``FakePaymentProvider`` (dış hesap gerektirmez), üretimde
    ``IyzicoProvider`` aynı arayüzü uygular. Seçim ``PAYMENT_PROVIDER`` ile yapılır;
    iş mantığı (escrow, komisyon) sağlayıcıdan bağımsızdır.
    """

    name: str = "base"

    @abstractmethod
    async def charge(
        self, *, amount: Decimal, currency: str, booking_id: int, description: str
    ) -> ChargeResult:  # pragma: no cover - arayüz
        raise NotImplementedError

    @abstractmethod
    async def refund(
        self, *, provider_ref: str | None, amount: Decimal
    ) -> bool:  # pragma: no cover - arayüz
        raise NotImplementedError
