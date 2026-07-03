"""Sağlayıcıdan bağımsız SMS gönderim katmanı (core/mail deseni).

Geliştirmede dış hesap/anahtar GEREKMEZ: ``SMS_PROVIDER=console`` (varsayılan) kodu
loglar. Üretimde ``SMS_PROVIDER=netgsm`` + ``.env`` kimlik bilgileriyle gerçek SMS.
"""
from core.sms.base import SmsMessage, SmsSender
from core.sms.sender import get_sms_sender, send_delivery_otp_sms, send_otp_sms

__all__ = [
    "SmsMessage",
    "SmsSender",
    "get_sms_sender",
    "send_delivery_otp_sms",
    "send_otp_sms",
]
