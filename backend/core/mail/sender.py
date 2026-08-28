from __future__ import annotations

import logging
from functools import lru_cache

from core.config import settings
from core.mail import templates
from core.mail.base import EmailMessage, EmailSender
from core.mail.console import ConsoleEmailSender
from core.mail.smtp import SMTPEmailSender

logger = logging.getLogger("adana.mail")

_LOCAL_SMTP_HOSTS = {"localhost", "127.0.0.1", "mailhog", "mailpit"}


@lru_cache
def get_email_sender() -> EmailSender:
    """``EMAIL_PROVIDER`` ayarına göre sender seçer (singleton)."""
    provider = (settings.EMAIL_PROVIDER or "console").strip().lower()
    if provider == "smtp":
        smtp_host = (settings.SMTP_HOST or "").strip().lower()
        if not settings.is_production and smtp_host not in _LOCAL_SMTP_HOSTS:
            logger.warning(
                "Geliştirme ortamında harici SMTP engellendi; e-postalar konsola yazılacak "
                "(host=%s)",
                smtp_host,
            )
            return ConsoleEmailSender()
        return SMTPEmailSender()
    return ConsoleEmailSender()


async def _safe_send(message: EmailMessage) -> bool:
    """E-posta gönderimi best-effort'tur: bir hata, tetikleyen akışı (kayıt, şifre
    sıfırlama talebi) ASLA bozmamalı. Başarısızlık loglanır, ``False`` döner."""
    try:
        await get_email_sender().send(message)
        return True
    except Exception:
        logger.warning(
            "e-posta gönderilemedi (to=%s, subject=%s)",
            message.to,
            message.subject,
            exc_info=True,
        )
        return False


async def send_verification_email(*, to: str, name: str, verify_url: str) -> bool:
    return await _safe_send(
        templates.verification_email(to=to, name=name, verify_url=verify_url)
    )


async def send_password_reset_email(*, to: str, name: str, reset_url: str) -> bool:
    return await _safe_send(
        templates.password_reset_email(to=to, name=name, reset_url=reset_url)
    )


async def send_order_status_email(
    *, to: str, name: str, order_id: int, status: str, total: str, currency: str, orders_url: str
) -> bool:
    return await _safe_send(
        templates.order_status_email(
            to=to, name=name, order_id=order_id, status=status,
            total=total, currency=currency, orders_url=orders_url,
        )
    )


async def send_back_in_stock_email(*, to: str, product_title: str, product_url: str) -> bool:
    return await _safe_send(
        templates.back_in_stock_email(to=to, product_title=product_title, product_url=product_url)
    )


async def send_contact_message_email(
    *,
    to: str,
    from_name: str,
    from_email: str,
    subject: str,
    message: str,
    user_ref: str | None = None,
) -> bool:
    return await _safe_send(
        templates.contact_message_email(
            to=to, from_name=from_name, from_email=from_email,
            subject=subject, message=message, user_ref=user_ref,
        )
    )


async def send_contact_ack_email(*, to: str, name: str, subject: str) -> bool:
    return await _safe_send(templates.contact_ack_email(to=to, name=name, subject=subject))


async def send_payout_changed_email(*, to: str, name: str, iban_masked: str) -> bool:
    return await _safe_send(
        templates.payout_changed_email(to=to, name=name, iban_masked=iban_masked)
    )
