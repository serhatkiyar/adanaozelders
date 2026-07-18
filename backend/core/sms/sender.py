from __future__ import annotations

import logging
from functools import lru_cache

from core.config import settings
from core.sms.base import SmsMessage, SmsSender
from core.sms.console import ConsoleSmsSender
from core.sms.netgsm import NetgsmSmsSender

logger = logging.getLogger("adana.sms")


@lru_cache
def get_sms_sender() -> SmsSender:
    """``SMS_PROVIDER`` ayarına göre sender seçer (singleton)."""
    provider = (settings.SMS_PROVIDER or "console").strip().lower()
    if provider == "netgsm":
        return NetgsmSmsSender()
    return ConsoleSmsSender()


async def _safe_send(message: SmsMessage) -> bool:
    """SMS gönderimi best-effort'tur: bir hata, tetikleyen akışı bozmamalı.
    Başarısızlık loglanır, ``False`` döner."""
    try:
        await get_sms_sender().send(message)
        return True
    except Exception:
        logger.warning("SMS gönderilemedi (to=%s)", message.to, exc_info=True)
        return False


async def send_otp_sms(*, to: str, code: str) -> bool:
    text = (
        f"Adana Özel Ders doğrulama kodun: {code}\n"
        f"Kodu kimseyle paylaşma. {settings.PHONE_OTP_TTL_MINUTES} dk geçerli."
    )
    return await _safe_send(SmsMessage(to=to, text=text))


def delivery_otp_sms_text(*, order_id: int, code: str, ttl_minutes: int) -> str:
    """Saf şablon (pytest'li). Son cümle sosyal mühendislik kalkanıdır — sahte
    'kurye' aramalarıyla kod sızdırılmasına karşı her OTP SMS'inde sabit durur."""
    return (
        f"#{order_id} siparişin teslimat kodun: {code}\n"
        f"Paketi teslim alırken bu kodu kuryemize söyle. "
        f"{ttl_minutes} dk geçerli.\n"
        f"Bu kodu yalnız kapındaki kuryeye söyle — kuryemiz seni arayıp kod istemez."
    )


async def send_delivery_otp_sms(*, to: str, code: str, order_id: int) -> bool:
    """Kapıda teslim kodu: müşteri kodu kuryeye söyler, sunucu doğrular."""
    text = delivery_otp_sms_text(
        order_id=order_id, code=code, ttl_minutes=settings.DELIVERY_OTP_TTL_MINUTES
    )
    return await _safe_send(SmsMessage(to=to, text=text))


async def send_tracking_link_sms(*, to: str, order_id: int, url: str) -> bool:
    """Sipariş dağıtıma çıkınca oturumsuz kargo takip linki (canlı kurye takibi)."""
    text = (
        f"#{order_id} siparişin dağıtıma çıktı! Kuryeni canlı takip et:\n{url}"
    )
    return await _safe_send(SmsMessage(to=to, text=text))


async def send_approach_sms(
    *, to: str, order_id: int, stops_ahead: int, url: str
) -> bool:
    """"Kuryen yaklaşıyor" — bir durak sonuçlanınca sıradaki müşterilere gider."""
    lead = (
        "Sıradaki teslimat sensin!"
        if stops_ahead <= 0
        else f"Kuryenin gelmesine {stops_ahead} durak kaldı."
    )
    text = f"#{order_id} siparişin yaklaşıyor. {lead} Canlı takip:\n{url}"
    return await _safe_send(SmsMessage(to=to, text=text))


async def send_failed_sms(*, to: str, order_id: int) -> bool:
    """Teslim edilemedi bilgilendirmesi (kurye ulaşamadı; yeniden planlanacak)."""
    text = (
        f"#{order_id} siparişini bugün teslim edemedik — adresinde sana ulaşamadık. "
        f"Teslimat bir sonraki dağıtım gününe planlanacak."
    )
    return await _safe_send(SmsMessage(to=to, text=text))


async def send_postponed_sms(*, to: str, order_id: int, new_date: str) -> bool:
    """Müşteri ertelemesi onayı (yeni teslim günüyle)."""
    text = (
        f"#{order_id} siparişinin teslimatı isteğinle ertelendi. "
        f"Yeni teslimat günü: {new_date}."
    )
    return await _safe_send(SmsMessage(to=to, text=text))
