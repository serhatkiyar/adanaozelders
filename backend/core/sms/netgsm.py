from __future__ import annotations

import logging

import httpx

from core.config import settings
from core.sms.base import SmsMessage, SmsSender

logger = logging.getLogger("adana.sms")

#: Netgsm /sms/send/get gövde kodları — başarı yalnız "00" (kuyruğa alındı) ve
#: "01" (gönderildi, bazı numaralarda sorun). Gerisi HATADIR (HTTP 200 olsa da):
#: 20=mesaj/uzunluk, 30=kimlik/yetki, 40=gönderici başlığı onaysız, 50/51=İYS,
#: 70=parametre, 85=tekrar limiti. Kod yanıtın İLK token'ıdır.
NETGSM_SUCCESS_CODES = frozenset({"00", "01"})

NETGSM_ERROR_MESSAGES = {
    "20": "mesaj metni sorunu / karakter sınırı aşıldı",
    "30": "geçersiz kimlik veya API yetkisi yok",
    "40": "gönderici başlığı (msgheader) onaysız",
    "50": "İYS kontrollü hesap — alıcı ticari izin sorunu",
    "51": "İYS başlık eşleşmesi sorunu",
    "70": "hatalı parametre",
    "85": "aynı içerik tekrar gönderim limiti",
}


def parse_netgsm_code(body: str) -> str:
    """Netgsm yanıt gövdesinin ilk token'ından durum kodunu çıkarır ('00 12345' → '00')."""
    return body.strip().split(maxsplit=1)[0] if body.strip() else ""


def netgsm_response_ok(body: str) -> bool:
    """Gövde koduna göre gönderim başarılı mı? (HTTP 200 tek başına yetmez.)"""
    return parse_netgsm_code(body) in NETGSM_SUCCESS_CODES


class NetgsmSmsSender(SmsSender):
    """Üretim için Netgsm (Türkiye) SMS sağlayıcısı.

    Yalnızca ``.env``'de ``SMS_PROVIDER=netgsm`` + kimlik bilgileri verilince devreye
    girer (geliştirmede gerek yok; varsayılan console). Netgsm HTTP API'sine basit
    GET ile gönderir; HTTP durumu VE gövde kodu doğrulanır — Netgsm başarısız
    gönderimi de HTTP 200 ile gövdede hata koduyla döndürür, bu yüzden gövde
    kontrolü şarttır (aksi halde başarısız SMS 'gönderildi' sayılırdı).
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
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(self._URL, params=params)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            # httpx hata metni ve zinciri istek URL'sini (parola + OTP) taşır;
            # yukarıdaki log/outbox'a yalnız sade bir özet çıksın.
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            raise RuntimeError(
                f"Netgsm HTTP hatası: {type(exc).__name__}"
                + (f" (HTTP {status_code})" if status_code else "")
            ) from None
        if not netgsm_response_ok(resp.text):
            code = parse_netgsm_code(resp.text)
            detail = NETGSM_ERROR_MESSAGES.get(code, "bilinmeyen Netgsm hata kodu")
            # RAISE: _safe_send bunu yakalayıp False döndürür → gönderim
            # 'başarısız' işaretlenir (outbox retry'lar, OTP'de kurye uyarılır).
            raise RuntimeError(f"Netgsm gönderim hatası (kod {code!r}): {detail}")
