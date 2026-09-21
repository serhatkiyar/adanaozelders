"""Centrifugo istemcisi: bağlantı token'ı üretimi + sunucu publish API'si.

## Neden ayrı bir gerçek-zamanlı sunucu

``core/ws_manager.py`` bağlantıları **süreç belleğinde** tutar. Backend tek
replika olduğu sürece bu çalışır; ikinci replika açıldığı anda A replikasındaki
bir push, B replikasına bağlı istemciye ulaşmaz ve kayıp SESSİZDİR. Centrifugo
fan-out'u Redis üzerinden yapar, yani hangi replikanın publish ettiği önemsizdir.

## Kapsam

Bu modül YALNIZ yeni gerçek-zamanlı yetenek içindir. Mevcut ``/ws`` ucu
(``RTC_SIGNAL`` dahil) taşınmadı ve davranışı değişmedi.

## İki sır, iki ayrı iş

- ``CENTRIFUGO_TOKEN_HMAC_SECRET`` — istemciye verdiğimiz bağlantı JWT'sini
  imzalar; doğrulayan taraf Centrifugo'dur.
- ``CENTRIFUGO_API_KEY`` — sunucu→Centrifugo HTTP API çağrılarını yetkilendirir.

Hiçbiri ``JWT_SECRET_KEY`` DEĞİLDİR ve olamaz (``Settings._guard_centrifugo``):
aynı sır kullanılsaydı Centrifugo'ya verilen kısa ömürlü token, API access
token'ı olarak da kabul edilebilirdi.
"""
from __future__ import annotations

import datetime
import logging

import httpx
import jwt

from core.config import settings

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    """Paylaşılan istemci (keep-alive) — `core/google_oidc.py` ile aynı desen."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.CENTRIFUGO_API_URL,
            timeout=settings.CENTRIFUGO_TIMEOUT_SECONDS,
            headers={"X-API-Key": settings.CENTRIFUGO_API_KEY},
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def subject(user_id: int, role_id: int) -> str:
    """Centrifugo ``sub`` claim'i.

    Bu deponun kimliği TEK bir sayı değildir: her rol kendi tablosunda kendi
    id dizisine sahiptir (Tutor#17 ile Client#17 farklı kişilerdir). Sadece
    ``user_id`` gönderilseydi iki farklı kişi aynı kişisel kanalı paylaşırdı.
    """
    return f"{role_id}-{user_id}"


def personal_channel(user_id: int, role_id: int) -> str:
    """Kullanıcıya özel kanal.

    ``#`` ayırıcısı Centrifugo'nun "user-limited channel" özelliğidir: kanala
    yalnız ``sub`` claim'i ``#``'ten sonraki değere eşit olan bağlantı abone
    olabilir. Yetkilendirme böylece sunucu kodunda değil, Centrifugo'nun
    kendisinde de zorunlu kılınır.
    """
    return f"{settings.CENTRIFUGO_NAMESPACE}:#{subject(user_id, role_id)}"


def make_connection_token(*, user_id: int, role_id: int) -> str:
    """Kısa ömürlü bağlantı JWT'si. ``JWT_SECRET_KEY`` ile İMZALANMAZ."""
    now = datetime.datetime.now(datetime.timezone.utc)
    verilis = int(now.timestamp())
    return jwt.encode(
        {
            "sub": subject(user_id, role_id),
            "iat": verilis,
            "exp": verilis + settings.CENTRIFUGO_TOKEN_TTL_SECONDS,
        },
        settings.CENTRIFUGO_TOKEN_HMAC_SECRET,
        algorithm="HS256",
    )


async def broadcast(channels: list[str], data: dict) -> bool:
    """Kanallara veri gönderir. **Fail-open**: asla istek akışını bozmaz.

    Gerçek-zamanlı katman burada best-effort'tur — taşınan şey "yazıyor…"
    göstergesi gibi kaybı zararsız bir ipucudur, kalıcı veri değil. Centrifugo
    düşmüşse kullanıcı yalnız o ipucunu görmez; mesajlaşmanın kendisi (HTTP +
    mevcut ``/ws``) etkilenmez. Bu yüzden istisna yukarı taşınmaz.

    Centrifugo mantıksal hataları da HTTP 200 ile döner (gövdede ``error``),
    o yüzden ``raise_for_status`` tek başına yetmez.
    """
    if not settings.CENTRIFUGO_ENABLED or not channels:
        return False
    try:
        resp = await _http().post(
            "/broadcast", json={"channels": channels, "data": data}
        )
        resp.raise_for_status()
        hata = resp.json().get("error")
        if hata:
            logger.warning("Centrifugo broadcast hatası: %s", hata)
            return False
        return True
    except Exception:  # noqa: BLE001 — ağ, HTTP, JSON: hepsi aynı sonuç
        logger.warning("Centrifugo broadcast başarısız", exc_info=True)
        return False
