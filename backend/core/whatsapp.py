"""WhatsApp doğrulama kodu (26-27 Eyl 2026).

Telefon OTP'si önce WhatsApp'tan denenir; sağlayıcı kapalıysa, numara
WhatsApp'ta yoksa, saatlik sınır aşıldıysa ya da gönderim herhangi bir hata
verirse `False` döner ve `core/sms` devreye girer (bkz.
`services/phone_service.request_otp`). Kullanıcı ayrıca "SMS olarak al"
diyebilir. SMS'e düşme kararı BURADA, bizim kodumuzda verilir; WAHA/Meta bunu
kendiliğinden yapmaz.

Sağlayıcılar (`WHATSAPP_PROVIDER`):
* ``waha`` — kendi sunucumuzda WAHA (GOWS motoru), telefondaki WhatsApp'a
  "bağlı cihaz" olarak bağlanır; telefon uygulaması kullanılmaya devam eder.
  27 Eyl 2026 yerel denemesi: gönderim, yeniden başlatmada QR'sız dönüş,
  durum okuma, olmayan numara ve telefondan çıkış senaryoları doğrulandı.
* ``meta`` — WhatsApp Cloud API (onaylı authentication şablonu).
* ``off`` — varsayılan; her şey SMS.

Gönderim best-effort'tur: hata yükselmez. Kod, API anahtarı ve yanıt gövdesi
loga yazılmaz (WAHA hata gövdesi isteği — yani kodu — geri yansıtıyor).
"""
from __future__ import annotations

import logging

import httpx

from core.config import settings

logger = logging.getLogger("adana.whatsapp")

_ZAMAN_ASIMI = 8.0


def _saglayici() -> str:
    return (settings.WHATSAPP_PROVIDER or "off").strip().lower()


def whatsapp_otp_etkin() -> bool:
    saglayici = _saglayici()
    if saglayici == "waha":
        return bool(settings.WAHA_URL and settings.WAHA_API_KEY)
    if saglayici == "meta":
        return bool(
            settings.WHATSAPP_PHONE_NUMBER_ID
            and settings.WHATSAPP_ACCESS_TOKEN
            and settings.WHATSAPP_OTP_TEMPLATE
        )
    return False


def otp_metni(code: str) -> str:
    """Saf (pytest'li): WAHA ile giden serbest metin."""
    return f"Doğrulama kodunuz: {code}."


async def _saatlik_sinir_asildi(to: str) -> bool:
    """Aynı numaraya saatte `WHATSAPP_OTP_SAATLIK_SINIR`'dan fazla WhatsApp
    kodu gitmesin; aşılırsa SMS'e düşülür. Redis yoksa sınır uygulanmaz
    (fail-open: kullanıcı yine SMS/WhatsApp ile kod alır)."""
    from core.ratelimit import _redis

    r = _redis()
    if r is None:
        return False
    anahtar = f"wa_otp:{to}"
    try:
        adet = await r.incr(anahtar)
        if adet == 1:
            await r.expire(anahtar, 3600)
        return adet > settings.WHATSAPP_OTP_SAATLIK_SINIR
    except Exception:
        logger.warning("WhatsApp OTP sınırı okunamadı", exc_info=True)
        return False


# ── WAHA ─────────────────────────────────────────────────────────────────────


def _waha_istemci() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.WAHA_URL.rstrip("/"),
        headers={"X-Api-Key": settings.WAHA_API_KEY or ""},
        timeout=_ZAMAN_ASIMI,
    )


async def _waha_gonder(*, to: str, code: str) -> bool:
    rakamlar = to.lstrip("+")
    oturum = settings.WAHA_SESSION
    try:
        async with _waha_istemci() as istemci:
            # Numara WhatsApp'ta yoksa hiç denemeden SMS'e düş: hem hızlı hem
            # "olmayan numaralara mesaj atan hesap" görüntüsü oluşmaz.
            kontrol = await istemci.get(
                "/api/contacts/check-exists",
                params={"phone": rakamlar, "session": oturum},
            )
            if kontrol.status_code != 200:
                logger.warning("WAHA numara kontrolü başarısız: HTTP %s", kontrol.status_code)
                return False
            veri = kontrol.json()
            if not veri.get("numberExists"):
                return False
            chat_id = veri.get("pn") or f"{rakamlar}@c.us"
            yanit = await istemci.post(
                "/api/sendText",
                json={"session": oturum, "chatId": chat_id, "text": otp_metni(code)},
            )
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("WAHA OTP gönderilemedi: %s", type(exc).__name__)
        return False
    if yanit.status_code not in (200, 201):
        # 422: oturum WORKING değil (telefondan çıkış vb.); 500: WhatsApp reddi
        # (463/475 yeni kişi kısıtları dahil). Gövde kodu yansıttığı için loglanmaz.
        logger.warning("WAHA OTP reddedildi: HTTP %s", yanit.status_code)
        return False
    return True


async def waha_oturum_durumu() -> str | None:
    """WAHA oturum durumu ("WORKING", "FAILED", "SCAN_QR_CODE", ...); ulaşılamazsa None."""
    if not (_saglayici() == "waha" and whatsapp_otp_etkin()):
        return None
    try:
        async with _waha_istemci() as istemci:
            yanit = await istemci.get(f"/api/sessions/{settings.WAHA_SESSION}")
        if yanit.status_code != 200:
            return f"HTTP_{yanit.status_code}"
        return yanit.json().get("status")
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("WAHA durumu okunamadı: %s", type(exc).__name__)
        return None


# ── Meta WhatsApp Cloud API ──────────────────────────────────────────────────


def otp_sablon_govdesi(*, to: str, code: str) -> dict:
    """Saf (pytest'li): kopyala-kodu düğmeli authentication şablonu isteği.

    Meta bu şablon türünde kodu İKİ yerde ister: gövde parametresi ve URL
    düğmesinin (index 0) parametresi."""
    return {
        "messaging_product": "whatsapp",
        "to": to.lstrip("+"),
        "type": "template",
        "template": {
            "name": settings.WHATSAPP_OTP_TEMPLATE,
            "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": code}],
                },
            ],
        },
    }


async def _meta_gonder(*, to: str, code: str) -> bool:
    url = (
        f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/"
        f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                json=otp_sablon_govdesi(to=to, code=code),
                headers={"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("WhatsApp OTP gönderilemedi: %s", type(exc).__name__)
        return False
    if resp.status_code >= 400:
        # Meta hata gövdesi kodu/anahtarı içermez (ör. 131026: alıcı WhatsApp
        # kullanmıyor).
        logger.warning("WhatsApp OTP reddedildi: HTTP %s %s", resp.status_code, resp.text[:300])
        return False
    return True


# ── Ortak giriş ──────────────────────────────────────────────────────────────


async def send_otp_whatsapp(*, to: str, code: str) -> bool:
    """True: kod WhatsApp'tan gitti. False: SMS'e düşülmeli."""
    if not whatsapp_otp_etkin():
        return False
    if await _saatlik_sinir_asildi(to):
        logger.info("WhatsApp OTP saatlik sınırı aşıldı; SMS'e düşülüyor")
        return False
    if _saglayici() == "waha":
        return await _waha_gonder(to=to, code=code)
    return await _meta_gonder(to=to, code=code)
