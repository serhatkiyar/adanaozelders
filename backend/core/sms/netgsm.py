from __future__ import annotations

import logging

import httpx

from core.config import settings
from core.sms.base import SmsMessage, SmsSender

logger = logging.getLogger("adana.sms")


class NetgsmSmsSender(SmsSender):
    """Üretim için Netgsm (Türkiye) SMS sağlayıcısı — iskelet.

    Yalnızca ``.env``'de ``SMS_PROVIDER=netgsm`` + kimlik bilgileri verilince devreye
    girer (geliştirmede gerek yok; varsayılan console). Netgsm HTTP API'sine basit
    GET ile gönderir. TODO(prod): yanıt kodu doğrulaması, başlık (gönderici) onayı.
    """

    _URL = "https://api.netgsm.com.tr/sms/send/get"

    async def send(self, message: SmsMessage) -> None:
        if not (settings.NETGSM_USERCODE and settings.NETGSM_PASSWORD):
            # Kimlik bilgisi yoksa gerçek gönderim yapma — akışı bozmamak için logla.
            logger.warning(
                "SMS_PROVIDER=netgsm ama kimlik bilgisi yok; SMS loglanıyor: %s -> %s",
                message.to,
                message.text,
            )
            return
        params = {
            "usercode": settings.NETGSM_USERCODE,
            "password": settings.NETGSM_PASSWORD,
            "gsmno": message.to.lstrip("+"),
            "message": message.text,
            "msgheader": settings.NETGSM_MSGHEADER or settings.NETGSM_USERCODE,
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(self._URL, params=params)
            resp.raise_for_status()
