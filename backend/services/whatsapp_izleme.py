"""WAHA oturum izleme — bağlantı koparsa yöneticiye haber ver (27 Eyl 2026).

Bağlı cihaz oturumu kalıcıdır ama sonsuz değildir: telefondan çıkış, uzun
süre çevrimdışı telefon ya da WhatsApp tarafı oturumu düşürebilir. O sırada
kodlar zaten SMS'e düşer (core/whatsapp.py); bu iş yalnız yöneticinin QR'ı
yeniden okutması gerektiğini bildirir. Durum DEĞİŞİMİNDE bir kez bildirir
(her dakika değil); son durum süreç içinde tutulur — iş lider replikada koşar.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import whatsapp
from models.admin import Admin
from models.role import ROLE_IDS, RoleType
from services import notification_service

logger = logging.getLogger("adana.whatsapp")

_son_durum: str | None = None


def _sifirla() -> None:
    """Testler için."""
    global _son_durum
    _son_durum = None


async def _yoneticilere(db: AsyncSession, mesaj: str) -> None:
    admin_ids = (
        await db.execute(select(Admin.id).where(Admin.deleted_at.is_(None)))
    ).scalars().all()
    for admin_id in admin_ids:
        await notification_service.notify(
            db, user_id=admin_id, role_id=ROLE_IDS[RoleType.ADMIN], message=mesaj
        )


async def oturum_kontrol(db: AsyncSession) -> str | None:
    """Durumu okur; WORKING'den düşüşte ve geri gelişte bir kez bildirir."""
    global _son_durum
    durum = await whatsapp.waha_oturum_durumu()
    if durum is None and not whatsapp.whatsapp_otp_etkin():
        return None  # WAHA kapalı: izlenecek bir şey yok
    calisiyor = durum == "WORKING"
    onceki_calisiyor = _son_durum == "WORKING"
    if _son_durum is not None and calisiyor != onceki_calisiyor:
        if calisiyor:
            await _yoneticilere(
                db, "WhatsApp bağlantısı geri geldi; doğrulama kodları yine WhatsApp'tan gidiyor."
            )
        else:
            logger.error("WAHA oturumu düştü: durum=%s", durum)
            await _yoneticilere(
                db,
                f"WhatsApp bağlantısı koptu (durum: {durum or 'ulaşılamıyor'}). "
                "Doğrulama kodları şimdilik SMS ile gidiyor; WAHA panelinden QR'ı yeniden okutun.",
            )
    elif _son_durum is None and not calisiyor:
        # Açılışta zaten kopuksa da haber ver.
        logger.error("WAHA oturumu çalışmıyor: durum=%s", durum)
        await _yoneticilere(
            db,
            f"WhatsApp bağlantısı çalışmıyor (durum: {durum or 'ulaşılamıyor'}). "
            "Doğrulama kodları SMS ile gidiyor; WAHA panelinden QR'ı okutun.",
        )
    _son_durum = durum or "ULASILAMIYOR"
    return durum
