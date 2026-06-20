from __future__ import annotations

import logging
from functools import lru_cache

from core.config import settings
from core.sms.base import SmsMessage, SmsSender
from core.sms.console import ConsoleSmsSender
from core.sms.netgsm import NetgsmSmsSender

logger = logging.getLogger("ceyhan.sms")


@lru_cache
def get_sms_sender() -> SmsSender:
    """``SMS_PROVIDER`` ayarına göre sender seçer (singleton)."""
    provider = (settings.SMS_PROVIDER or "console").strip().lower()
    if provider == "netgsm":
        return NetgsmSmsSender()
    return ConsoleSmsSender()


async def _safe_send(message: SmsMessage) -> bool:
    """SMS gönderimi best-effort'tur: bir hata, tetikleyen akışı bozmamalı.
    Başarısızlık loglanır, ``False`` döner."""
    try:
        await get_sms_sender().send(message)
        return True
    except Exception:
        logger.warning("SMS gönderilemedi (to=%s)", message.to, exc_info=True)
        return False


async def send_otp_sms(*, to: str, code: str) -> bool:
    text = (
        f"Adana Özel Ders doğrulama kodun: {code}\n"
        f"Kodu kimseyle paylaşma. {settings.PHONE_OTP_TTL_MINUTES} dk geçerli."
    )
    return await _safe_send(SmsMessage(to=to, text=text))
