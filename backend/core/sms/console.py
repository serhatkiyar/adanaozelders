from __future__ import annotations

import logging

from core.sms.base import SmsMessage, SmsSender

logger = logging.getLogger("ceyhan.sms")


class ConsoleSmsSender(SmsSender):
    """SMS GÖNDERMEZ; içeriğini (OTP kodu dahil) loglar.

    Hiçbir dış bağımlılık/hesap gerektirmez — SMS sağlayıcısı kurmadan telefon
    doğrulama akışını uçtan uca denemek için. Geliştirme/test varsayılanı.
    Kullanıcı kodu backend loglarından okuyup girer.
    """

    async def send(self, message: SmsMessage) -> None:
        logger.info(
            "\n----- SMS (console) -----\n"
            "Kime : %s\n"
            "-------------------------\n"
            "%s\n"
            "-------------------------",
            message.to,
            message.text,
        )
