from __future__ import annotations

import logging
from functools import lru_cache

from core.config import settings
from core.mail import templates
from core.mail.base import EmailMessage, EmailSender
from core.mail.console import ConsoleEmailSender
from core.mail.smtp import SMTPEmailSender

logger = logging.getLogger("ceyhan.mail")


@lru_cache
def get_email_sender() -> EmailSender:
    """``EMAIL_PROVIDER`` ayarına göre sender seçer (singleton)."""
    provider = (settings.EMAIL_PROVIDER or "console").strip().lower()
    if provider == "smtp":
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
