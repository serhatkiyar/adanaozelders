"""WhatsApp doğrulama kodu — Meta WhatsApp Cloud API (26-27 Eyl 2026).

Telefon OTP'si önce WhatsApp'tan denenir; ayar yoksa, istek hata verirse ya da
kullanıcı "SMS olarak al" derse `core/sms` devreye girer (bkz.
`services/phone_service.request_otp`). Netgsm'deki gibi gönderici başlığı/KEP
gerekmez; Meta'da onaylı bir "authentication" şablonu yeterlidir.

Gönderim best-effort'tur: hata yükselmez, `False` döner. Erişim anahtarı ve kod
loga yazılmaz; httpx istek satırı zaten WARNING altına kısıldı
(`core/observability.py`).
"""
from __future__ import annotations

import logging

import httpx

from core.config import settings

logger = logging.getLogger("adana.whatsapp")


def whatsapp_otp_etkin() -> bool:
    return bool(
        settings.WHATSAPP_PHONE_NUMBER_ID
        and settings.WHATSAPP_ACCESS_TOKEN
        and settings.WHATSAPP_OTP_TEMPLATE
    )


def otp_sablon_govdesi(*, to: str, code: str) -> dict:
    """Saf (pytest'li): kopyala-kodu düğmeli authentication şablonu isteği.

    Meta bu şablon türünde kodu İKİ yerde ister: gövde parametresi ve URL
    düğmesinin (index 0) parametresi."""
    return {
        "messaging_product": "whatsapp",
        "to": to.lstrip("+"),
        "type": "template",
        "template": {
            "name": settings.WHATSAPP_OTP_TEMPLATE,
            "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": code}],
                },
            ],
        },
    }


async def send_otp_whatsapp(*, to: str, code: str) -> bool:
    if not whatsapp_otp_etkin():
        return False
    url = (
        f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/"
        f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                json=otp_sablon_govdesi(to=to, code=code),
                headers={"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp OTP gönderilemedi: %s", type(exc).__name__)
        return False
    if resp.status_code >= 400:
        # Gövde Meta hata kodunu taşır (ör. 131026: alıcı WhatsApp kullanmıyor);
        # kod/anahtar içermez.
        logger.warning("WhatsApp OTP reddedildi: HTTP %s %s", resp.status_code, resp.text[:300])
        return False
    return True
