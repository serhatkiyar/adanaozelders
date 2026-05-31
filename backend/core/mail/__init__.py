"""Sağlayıcıdan bağımsız e-posta gönderim katmanı.

Geliştirmede dış hesap/anahtar GEREKMEZ: ``EMAIL_PROVIDER=console`` içeriği loglar,
``EMAIL_PROVIDER=smtp`` MailHog'a (localhost:1025) yazar. Üretimde aynı arayüzle
gerçek bir SMTP relay'e geçilir (yalnızca .env değişir).
"""
from core.mail.base import EmailMessage, EmailSender
from core.mail.sender import (
    get_email_sender,
    send_password_reset_email,
    send_verification_email,
)

__all__ = [
    "EmailMessage",
    "EmailSender",
    "get_email_sender",
    "send_password_reset_email",
    "send_verification_email",
]
