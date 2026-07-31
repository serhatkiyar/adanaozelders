"""İletişim formu — public destek kanalı.

Mesafeli satışta tüketicinin satıcıya kolayca ulaşabileceği bir kanal
bulundurmak zorunludur; platformda yalnız yasal metin içinde bir e-posta adresi
geçiyordu, arkasında hiçbir yüzey yoktu (`Tickets.tsx` destek değil "biletlerim"
sayfasıdır).

Tasarım: **ayrı bir helpdesk/ticket sistemi YAZILMADI.** Bu ölçekte (tek
geliştirici, yerel pazar) form → e-posta yeterlidir ve mesajın kaybolmaması
outbox ile garanti edilir. Ticket sistemi ancak hacim gerektirdiğinde anlamlı
olur; erken yazılırsa moderasyon/SLA yükü getirir ve kimse bakmaz.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from core import outbox
from core.config import settings

logger = logging.getLogger("adana.support")

#: Mesajların gönderileceği adres. Ayrı bir kutu tanımlanmadıysa gönderen
#: adresine düşer (EMAIL_FROM) — böylece yapılandırma eksikse bile mesaj
#: kaybolmaz, işletmenin kendi kutusuna gider.
def support_inbox() -> str:
    return (
        getattr(settings, "SUPPORT_EMAIL", None)
        or settings.EMAIL_FROM
    )


async def submit_contact(
    db: AsyncSession,
    *,
    name: str,
    email: str,
    subject: str,
    message: str,
    user_ref: str | None = None,
    send_ack: bool = True,
) -> None:
    """İletişim mesajını outbox'a yazar (commit ÇAĞIRANIN).

    Doğrudan SMTP çağırmak yerine outbox kullanılır: SMTP anlık erişilemezse
    mesaj kaybolmaz, worker üstel backoff'la yeniden dener. Aynı desen sipariş
    durumu e-postalarında kullanılıyor.
    """
    outbox.enqueue(
        db,
        "email:contact",
        {
            "to": support_inbox(),
            "from_name": name.strip(),
            "from_email": email.strip(),
            "subject": subject.strip(),
            "message": message.strip(),
            "user_ref": user_ref,
            # Gönderene teyit: kullanıcı boşluğa yazdığını sanmasın.
            "ack_to": email.strip() if send_ack else None,
        },
    )
    logger.info("iletişim mesajı kuyruğa alındı (konu=%r)", subject[:60])
