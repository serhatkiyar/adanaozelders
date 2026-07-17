from __future__ import annotations

import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


class RefundState(str, enum.Enum):
    """Sağlayıcı tarafındaki iade durumunun sunucu-sorgusu sonucu.

    Reconciler için: REFUNDED pozitif kanıttır (finalize edilir); NOT_REFUNDED ve
    UNKNOWN "iade yok" KANITI DEĞİLDİR — sınırlı retry, sağlayıcının aşırı-iade
    reddine yaslanarak yapılır (bkz. services/escrow.py).
    """

    REFUNDED = "REFUNDED"
    NOT_REFUNDED = "NOT_REFUNDED"
    UNKNOWN = "UNKNOWN"


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
    address: str = "Adana, Türkiye"


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
    ``paid_price`` sağlayıcının GERÇEKTE tahsil ettiği tutardır — varlık tutarıyla
    eşleşmesi complete_checkout'ta doğrulanır (C3).
    """

    success: bool
    reference: str | None = None
    provider_ref: str | None = None
    paid_price: Decimal | None = None
    error: str | None = None


@dataclass(slots=True)
class SubMerchantInfo:
    """Alt üye işyeri (sub-merchant) oluşturmak için para alan tarafın bilgisi.

    PERSONAL (şahıs) tipi: TCKN + IBAN + iletişim. iyzico bu veriyle MERNIS/IBAN/MASAK
    kontrolünü KENDİ yapar ve alt üyeyi onaylar/ret eder (kimlik doğrulama onun
    düzenleyici sorumluluğu). Biz yalnız toplayıp iletir, sonucu saklarız.
    """

    external_id: str  # bizim stabil referans: "tutor:{id}" / "library:{id}"
    name: str  # yasal/iletişim adı (hesap adıyla aynı olmalı — A6)
    email: str
    gsm: str
    iban: str
    identity_number: str  # TCKN (yalnız sağlayıcıya iletilir, biz son4 tutarız)
    address: str = "Adana, Türkiye"
    city: str = "Adana"


@dataclass(slots=True)
class SubMerchantResult:
    """Alt üye oluşturma/güncelleme sonucu. ``status`` = PENDING | ACTIVE | REJECTED."""

    success: bool
    sub_merchant_key: str | None = None
    status: str = "PENDING"
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

    async def refund_state(
        self, *, provider_ref: str | None, reference: str | None = None
    ) -> RefundState:  # pragma: no cover - varsayılan
        """Sağlayıcı tarafında iade gerçekleşmiş mi? (reconciler pozitif-kanıt sorgusu)

        Varsayılan UNKNOWN: destek vermeyen sağlayıcıda reconciler sınırlı-retry
        yoluna düşer. Emin olunamayan her durumda UNKNOWN dönülmeli.
        """
        return RefundState.UNKNOWN

    # ── Pazaryeri: alt üye işyeri (sub-merchant) ──
    # Varsayılan: desteklenmiyor (sağlayıcı override eder). Fake anında ACTIVE döner,
    # iyzico gerçek entegrasyonu (Ağustos) override edecek.
    async def create_submerchant(
        self, info: "SubMerchantInfo"
    ) -> "SubMerchantResult":  # pragma: no cover - varsayılan
        return SubMerchantResult(
            success=False, error="Bu sağlayıcı alt üye işyeri desteklemiyor"
        )

    async def update_submerchant(
        self, sub_merchant_key: str, info: "SubMerchantInfo"
    ) -> "SubMerchantResult":  # pragma: no cover - varsayılan
        return SubMerchantResult(
            success=False, error="Bu sağlayıcı alt üye işyeri desteklemiyor"
        )
