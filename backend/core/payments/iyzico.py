"""iyzico Checkout Form (Ödeme Formu) adaptörü — sandbox + üretim.

Akış: ``charge`` CF initialize ile bir ödeme oturumu açar ve kullanıcının
yönlendirileceği ``paymentPageUrl``'i (redirect_url) + oturum ``token``'ını
(provider_ref) döndürür. Ödeme bitince iyzico kullanıcının TARAYICISINI
``callbackUrl``'e POST eder (form alanı: ``token``); callback ucu
``retrieve_checkout`` ile sonucu sunucudan doğrular (kullanıcı girdisine
güvenilmez) ve ``parse_reference`` ile hangi varlığa ait olduğunu çözer.
Kart verisi hiçbir zaman bize uğramaz (PCI yükü iyzico'da); 3DS'i iyzico yürütür.

Kimlik doğrulama IYZWSv2 (HMAC-SHA256) ile elle yapılır — resmî SDK senkron ve
gereksiz; mevcut ``httpx`` bağımlılığı yeter. İmzada KULLANILAN gövde metni ile
GÖNDERİLEN gövde bayt bayt aynı olmalıdır (tek kez serialize edilir).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from decimal import Decimal

import httpx

from core.config import settings
from core.payments.base import (
    BuyerInfo,
    ChargeResult,
    CheckoutResult,
    PaymentProvider,
    RefundState,
    SubMerchantInfo,
    SubMerchantResult,
)

logger = logging.getLogger("adana.payments")

_INITIALIZE_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom"
_RETRIEVE_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail"
_REFUND_PATH = "/payment/refund"
_PAYMENT_DETAIL_PATH = "/payment/detail"

# Callback'te varlık çözümü için referans türleri (conversationId/basketId öneki).
_REFERENCE_KINDS = ("booking", "examreg", "studyres", "order")


def format_price(amount: Decimal | float | str) -> str:
    """iyzico fiyat alanı: nokta ondalıklı, 2 basamak ("500.00").

    price == sum(basketItems.price) eşitliği zorunlu olduğundan her yerde aynı
    formatlayıcı kullanılır.
    """
    return f"{Decimal(str(amount)):.2f}"


def parse_reference(reference: str | None) -> tuple[str, int] | None:
    """conversationId ("booking:12" | "examreg:5" | "studyres:7") → (tür, id).

    Tanınmayan/bozuk referansta None (saf — test edilebilir).
    """
    if not reference or ":" not in reference:
        return None
    kind, _, raw = reference.partition(":")
    kind = kind.strip().lower()
    if kind not in _REFERENCE_KINDS or not raw.isdigit():
        return None
    return kind, int(raw)


def build_auth_headers(
    *, api_key: str, secret_key: str, uri_path: str, body: str, random_key: str | None = None
) -> dict[str, str]:
    """IYZWSv2 yetkilendirme başlıkları (saf — test edilebilir).

    signature = HMAC-SHA256(secret, randomKey + uriPath + body) hex;
    Authorization = "IYZWSv2 " + b64("apiKey:..&randomKey:..&signature:..").
    """
    if random_key is None:
        random_key = str(int(time.time() * 1000)) + secrets.token_hex(4)
    payload = random_key + uri_path + body
    signature = hmac.new(
        secret_key.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    auth = f"apiKey:{api_key}&randomKey:{random_key}&signature:{signature}"
    return {
        "Authorization": "IYZWSv2 " + base64.b64encode(auth.encode()).decode(),
        "x-iyzi-rnd": random_key,
        "Content-Type": "application/json",
    }


def checkout_callback_url() -> str:
    """iyzico'nun ödeme sonunda tarayıcıyı POST edeceği backend ucu."""
    return (
        settings.BACKEND_BASE_URL.rstrip("/")
        + settings.API_V1_PREFIX
        + "/payments/iyzico/callback"
    )


class IyzicoProvider(PaymentProvider):
    name = "iyzico"

    def _require_config(self) -> None:
        if not (settings.IYZICO_API_KEY and settings.IYZICO_SECRET_KEY):
            raise RuntimeError(
                "iyzico anahtarları tanımsız (IYZICO_API_KEY / IYZICO_SECRET_KEY)."
            )

    async def _post(self, path: str, payload: dict) -> dict:
        body = json.dumps(payload)
        headers = build_auth_headers(
            api_key=settings.IYZICO_API_KEY or "",
            secret_key=settings.IYZICO_SECRET_KEY or "",
            uri_path=path,
            body=body,
        )
        async with httpx.AsyncClient(
            base_url=settings.IYZICO_BASE_URL, timeout=20.0
        ) as client:
            resp = await client.post(path, content=body, headers=headers)
            resp.raise_for_status()
            return resp.json()

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
        try:
            self._require_config()
        except RuntimeError as exc:
            return ChargeResult(success=False, error=str(exc))
        if buyer is None or not reference:
            return ChargeResult(
                success=False, error="Ödeme başlatılamadı (alıcı bilgisi eksik)"
            )

        price = format_price(amount)
        full_name = f"{buyer.name} {buyer.surname}".strip() or "Ad Soyad"
        payload = {
            "locale": "tr",
            "conversationId": reference,
            "price": price,
            "paidPrice": price,
            "currency": currency,
            "basketId": reference,
            "paymentGroup": "PRODUCT",
            "callbackUrl": checkout_callback_url(),
            "enabledInstallments": [1],
            "buyer": {
                "id": buyer.id,
                "name": buyer.name or "Ad",
                "surname": buyer.surname or "Soyad",
                "email": buyer.email,
                # iyzico'da zorunlu alan; TODO(prod): ödeme adımında gerçek TCKN topla.
                "identityNumber": buyer.identity_number or "11111111111",
                "registrationAddress": buyer.address,
                "ip": buyer.ip,
                "city": buyer.city,
                "country": "Turkey",
            },
            "billingAddress": {
                "contactName": full_name,
                "city": buyer.city,
                "country": "Turkey",
                "address": buyer.address,
            },
            "basketItems": [
                {
                    "id": reference,
                    "name": (description or "Hizmet")[:50],
                    "category1": "Egitim",
                    "itemType": "VIRTUAL",
                    "price": price,
                }
            ],
        }
        try:
            data = await self._post(_INITIALIZE_PATH, payload)
        except Exception:
            logger.exception("iyzico CF initialize çağrısı başarısız (ref=%s)", reference)
            return ChargeResult(success=False, error="Ödeme sağlayıcısına ulaşılamadı")
        if data.get("status") != "success" or not data.get("paymentPageUrl"):
            logger.warning(
                "iyzico CF initialize reddetti (ref=%s): %s",
                reference,
                data.get("errorMessage"),
            )
            return ChargeResult(
                success=False, error=data.get("errorMessage") or "Ödeme başlatılamadı"
            )
        # provider_ref = CF oturum token'ı; callback'te retrieve ile sonuca dönüşür.
        return ChargeResult(
            success=True,
            provider_ref=data.get("token"),
            redirect_url=data.get("paymentPageUrl"),
        )

    async def retrieve_checkout(self, *, token: str) -> CheckoutResult:
        """Callback token'ı ile ödemenin GERÇEK sonucunu iyzico'dan çeker."""
        try:
            self._require_config()
            data = await self._post(_RETRIEVE_PATH, {"locale": "tr", "token": token})
        except Exception:
            logger.exception("iyzico CF retrieve çağrısı başarısız")
            return CheckoutResult(success=False, error="Ödeme sonucu doğrulanamadı")
        reference = data.get("conversationId") or data.get("basketId")
        if data.get("status") != "success" or data.get("paymentStatus") != "SUCCESS":
            logger.info(
                "iyzico ödeme başarısız/yarım (ref=%s paymentStatus=%s): %s",
                reference,
                data.get("paymentStatus"),
                data.get("errorMessage"),
            )
            return CheckoutResult(
                success=False,
                reference=reference,
                error=data.get("errorMessage") or "Ödeme tamamlanmadı",
            )
        txs = data.get("itemTransactions") or []
        ptx = txs[0].get("paymentTransactionId") if txs else None
        provider_ref = str(ptx or data.get("paymentId") or "")
        paid_price: Decimal | None = None
        try:
            if data.get("paidPrice") is not None:
                paid_price = Decimal(str(data["paidPrice"]))
        except Exception:  # noqa: BLE001
            paid_price = None  # doğrulanamıyorsa None — çağıran eşleşme atlar
        logger.info(
            "iyzico ödeme OK ref=%s paymentId=%s ptx=%s paidPrice=%s",
            reference,
            data.get("paymentId"),
            ptx,
            data.get("paidPrice"),
        )
        return CheckoutResult(
            success=True,
            reference=reference,
            provider_ref=provider_ref or None,
            paid_price=paid_price,
        )

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        # provider_ref, başarılı ödemede yazılan paymentTransactionId'dir.
        if not provider_ref:
            logger.warning("iyzico refund: provider_ref yok, iade yapılamaz.")
            return False
        try:
            self._require_config()
            data = await self._post(
                _REFUND_PATH,
                {
                    "locale": "tr",
                    "paymentTransactionId": provider_ref,
                    "price": format_price(amount),
                    "currency": settings.PAYMENT_CURRENCY,
                    "ip": "127.0.0.1",
                },
            )
        except Exception:
            logger.exception("iyzico refund çağrısı başarısız (ref=%s)", provider_ref)
            return False
        ok = data.get("status") == "success"
        if not ok:
            logger.warning(
                "iyzico refund reddetti (ref=%s): %s",
                provider_ref,
                data.get("errorMessage"),
            )
        return ok

    async def refund_state(
        self, *, provider_ref: str | None, reference: str | None = None
    ) -> RefundState:
        """Reconciler pozitif-kanıt sorgusu: ilgili işlemde iade görünüyor mu?

        ``/payment/detail`` conversationId ile çekilir; ``provider_ref``
        (paymentTransactionId) eşleşen kalemde iade tutarı aranır. Yanıt şeması
        beklenenden farklıysa/erişilemezse UNKNOWN — asla yanlış pozitif kanıt
        üretme (UNKNOWN reconciler'da sınırlı-retry'a düşer, iade tetiklemez).
        """
        if not reference:
            return RefundState.UNKNOWN
        try:
            self._require_config()
            data = await self._post(
                _PAYMENT_DETAIL_PATH,
                {"locale": "tr", "paymentConversationId": reference},
            )
        except Exception:
            logger.exception("iyzico payment detail sorgusu başarısız (ref=%s)", reference)
            return RefundState.UNKNOWN
        if data.get("status") != "success":
            return RefundState.UNKNOWN
        for tx in data.get("itemTransactions") or []:
            if provider_ref and str(tx.get("paymentTransactionId")) != str(provider_ref):
                continue
            refunded = tx.get("refundedPrice")
            if refunded is None:
                return RefundState.UNKNOWN
            try:
                return (
                    RefundState.REFUNDED
                    if Decimal(str(refunded)) > 0
                    else RefundState.NOT_REFUNDED
                )
            except Exception:  # noqa: BLE001
                return RefundState.UNKNOWN
        return RefundState.UNKNOWN

    # ── Pazaryeri alt üye işyeri ── TODO(Ağustos): iyzico Marketplace
    # /onboarding/submerchant (create/update/retrieve) gerçek entegrasyonu. Pazaryeri
    # ürünü + şirket onayı gerektirir; şimdilik net hata döner (sessizce başarısız değil).
    async def create_submerchant(self, info: SubMerchantInfo) -> SubMerchantResult:
        logger.warning("iyzico sub-merchant create henüz entegre değil (ext=%s)", info.external_id)
        return SubMerchantResult(
            success=False,
            error="iyzico pazaryeri (alt üye) entegrasyonu henüz aktif değil",
        )

    async def update_submerchant(
        self, sub_merchant_key: str, info: SubMerchantInfo
    ) -> SubMerchantResult:
        return SubMerchantResult(
            success=False,
            error="iyzico pazaryeri (alt üye) entegrasyonu henüz aktif değil",
        )
