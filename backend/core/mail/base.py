from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class EmailMessage:
    """Gönderilecek tek bir e-posta (çoklu-parça: düz metin + HTML)."""

    to: str
    subject: str
    html: str
    text: str


class EmailSender(ABC):
    """E-posta gönderim soyutlaması.

    Sağlayıcıdan bağımsız arayüz: geliştirmede ConsoleEmailSender/SMTPEmailSender
    (MailHog), üretimde gerçek bir SMTP relay (SES/SendGrid vb.) aynı arayüzü
    uygular. Kod sağlayıcıya bağlanmaz; seçim ``EMAIL_PROVIDER`` ile yapılır.
    """

    @abstractmethod
    async def send(self, message: EmailMessage) -> None:  # pragma: no cover - arayüz
        raise NotImplementedError
