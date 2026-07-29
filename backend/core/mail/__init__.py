"""Sağlayıcıdan bağımsız e-posta gönderim katmanı.

Geliştirmede dış hesap/anahtar GEREKMEZ: ``EMAIL_PROVIDER=console`` içeriği loglar,
``EMAIL_PROVIDER=smtp`` MailHog'a (localhost:1025) yazar. Üretimde aynı arayüzle
gerçek bir SMTP relay'e geçilir (yalnızca .env değişir).
"""
from core.mail.base import EmailMessage, EmailSender
from core.mail.sender import (
    get_email_sender,
    send_back_in_stock_email,
    send_contact_ack_email,
    send_contact_message_email,
    send_order_status_email,
    send_password_reset_email,
    send_payout_changed_email,
    send_verification_email,
)

__all__ = [
    "EmailMessage",
    "EmailSender",
    "get_email_sender",
    "send_back_in_stock_email",
    "send_contact_ack_email",
    "send_contact_message_email",
    "send_order_status_email",
    "send_password_reset_email",
    "send_payout_changed_email",
    "send_verification_email",
]
