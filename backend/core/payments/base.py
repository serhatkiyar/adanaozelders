from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass(slots=True)
class BuyerInfo:
    """Hosted ödeme (Checkout Form / 3DS) başlatmak için alıcı bilgisi.

    iyzico ``buyer`` alanlarına karşılık gelir. TCKN (``identity_number``)
    iyzico'da zorunludur; toplanmadığı sürece sandbox'ta dummy ile geçilir
    (TODO(prod): ödeme adımında gerçek TCKN iste).
    """

    id: str
    name: str
    surname: str
    email: str
    ip: str = "127.0.0.1"
    identity_number: str | None = None
    city: str = "Adana"
    address: str = "Ceyhan, Adana"


@dataclass(slots=True)
class ChargeResult:
    """Bir tahsilat denemesinin sonucu.

    ``redirect_url`` doluysa (prod 3DS/Checkout) kullanıcı oraya yönlendirilmeli;
    sonuç callback ile kesinleşir (``provider_ref`` bu aşamada oturum token'ıdır).
    Fake sağlayıcıda anında ``success=True`` döner.
    """

    success: bool
    provider_ref: str | None = None
    redirect_url: str | None = None
    error: str | None = None


@dataclass(slots=True)
class CheckoutResult:
    """Callback sonrası sağlayıcıdan SUNUCU tarafında doğrulanan ödeme sonucu.

    ``reference`` charge'a verilen referanstır (hangi varlığa ait olduğunu söyler);
    ``provider_ref`` iade için kullanılacak işlem kimliğidir (paymentTransactionId).
    """

    success: bool
    reference: str | None = None
    provider_ref: str | None = None
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
        self,
        *,
        amount: Decimal,
        currency: str,
        booking_id: int,
        description: str,
        reference: str = "",
        buyer: BuyerInfo | None = None,
    ) -> ChargeResult:  # pragma: no cover - arayüz
        raise NotImplementedError

    @abstractmethod
    async def refund(
        self, *, provider_ref: str | None, amount: Decimal
    ) -> bool:  # pragma: no cover - arayüz
        raise NotImplementedError
