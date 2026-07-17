from __future__ import annotations

import logging

from core.mail.base import EmailMessage, EmailSender

logger = logging.getLogger("adana.mail")


class ConsoleEmailSender(EmailSender):
    """E-postayı GÖNDERMEZ; içeriğini (doğrulama/sıfırlama linki dahil) loglar.

    Hiçbir dış bağımlılık gerektirmez — SMTP sunucusu bile kurmadan akışı uçtan
    uca denemek için. Geliştirme/test varsayılanı.
    """

    async def send(self, message: EmailMessage) -> None:
        logger.info(
            "\n----- E-POSTA (console) -----\n"
            "Kime : %s\n"
            "Konu : %s\n"
            "------------------------------\n"
            "%s\n"
            "------------------------------",
            message.to,
            message.subject,
            message.text,
        )
