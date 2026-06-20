from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class SmsMessage:
    """Gönderilecek tek bir SMS."""

    to: str
    text: str


class SmsSender(ABC):
    """SMS gönderim soyutlaması (core/mail ile aynı desen).

    Geliştirmede ConsoleSmsSender kodu loglar (dış hesap GEREKMEZ); üretimde gerçek
    bir SMS sağlayıcısı (Netgsm/İleti Merkezi/Twilio) aynı arayüzü uygular. Kod
    sağlayıcıya bağlanmaz; seçim ``SMS_PROVIDER`` ile yapılır.
    """

    @abstractmethod
    async def send(self, message: SmsMessage) -> None:  # pragma: no cover - arayüz
        raise NotImplementedError
