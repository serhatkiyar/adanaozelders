"""LiveKit erişim token'ı üretimi (HS256).

Claim şekli livekit/protocol `auth.ClaimGrants` ile birebir: grant alanının
JSON adı `video`dur (LiveKit'in bazı dokümanları `grants` yazar — YANLIŞ,
kaynak koddan doğrulanmalı; sunucu token'ı reddediyorsa önce burayı kontrol
et). `iss` API anahtarıdır, `sub` katılımcı kimliğidir; LiveKit aynı odada
aynı `sub` ile ikinci bir bağlantı gelirse ilkini düşürür.

Bu modül YALNIZ token üretir — hiçbir yetki kararı vermez. Kimin token
alabileceği `api/routers/bookings.py::get_live_lesson_token` içindeki
sıralı kapılarda belirlenir.
"""
from __future__ import annotations

import datetime

import jwt

from core.config import settings


def ders_token_uret(*, room: str, identity: str, name: str, ttl_seconds: int) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return jwt.encode(
        {
            "iss": settings.LIVEKIT_API_KEY,
            "sub": identity,
            "nbf": int(now.timestamp()),
            "exp": int((now + datetime.timedelta(seconds=ttl_seconds)).timestamp()),
            "name": name,
            "video": {
                "room": room,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        },
        settings.LIVEKIT_API_SECRET,
        algorithm="HS256",
    )
