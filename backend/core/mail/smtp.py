from __future__ import annotations

from email.message import EmailMessage as MIMEMessage

from core.config import settings
from core.mail.base import EmailMessage, EmailSender


class SMTPEmailSender(EmailSender):
    """SMTP üzerinden gönderir.

    Geliştirmede MailHog/Mailpit (``localhost:1025``, kimlik/TLS gerektirmez);
    üretimde gerçek bir SMTP relay (SES/SendGrid/Resend). Kimlik bilgisi ve TLS
    opsiyoneldir: MailHog için ``SMTP_USERNAME`` boş ve ``SMTP_USE_TLS=false``.

    ``aiosmtplib`` yalnızca SMTP sağlayıcısı seçildiğinde gerekir; bu yüzden ağır
    bağımlılık modül seviyesinde değil, gönderim anında import edilir (console
    varsayılanı bu paketi hiç gerektirmez).
    """

    async def send(self, message: EmailMessage) -> None:
        import aiosmtplib

        mime = MIMEMessage()
        mime["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
        mime["To"] = message.to
        mime["Subject"] = message.subject
        # Düz metin gövde + HTML alternatifi (uyumsuz istemciler düz metni görür).
        mime.set_content(message.text)
        mime.add_alternative(message.html, subtype="html")

        await aiosmtplib.send(
            mime,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME or None,
            password=settings.SMTP_PASSWORD or None,
            start_tls=settings.SMTP_USE_TLS,
            timeout=settings.SMTP_TIMEOUT_SECONDS,
        )
