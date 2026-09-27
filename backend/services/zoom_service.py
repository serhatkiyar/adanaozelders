"""Zoom Video SDK giriş JWT'si üretimi (HS256).

Alanlar Zoom resmî dokümanıyla birebir (https://developers.zoom.us/docs/video-sdk/auth/):
başlık `alg=HS256, typ=JWT`; gövde `app_key`, `tpc` (oturum adı, ≤200
karakter), `role_type` (1 host, 0 katılımcı), `version=1`, `iat`, `exp`
(`exp - iat` en az 1800 sn, en fazla 48 saat). `video_webrtc_mode` /
`audio_webrtc_mode` = 1: WebRTC modunda SharedArrayBuffer (COOP/COEP)
gerekmez. `geo_regions` ve bulut kaydı alanları bilinçli olarak YOK
(kullanıcı kararı, 24 Eyl 2026).

Bu modül YALNIZ token üretir — hiçbir yetki kararı vermez. Kimin token
alabileceği `api/routers/bookings.py::_canli_ders_kapilari` içinde belirlenir.
"""
from __future__ import annotations

import datetime

import jwt

from core.config import settings

# Saat kayması payı: istemci/Zoom saati biraz geride olsa da token "henüz
# geçerli değil" sayılmasın.
_IAT_GERI = 30


# Zoom `user_key` sınırı (SDK: participant.userKey).
_USER_KEY_AZAMI = 36


def ders_token_uret(
    *,
    oturum: str,
    egitmen_mi: bool,
    kullanici_anahtari: str,
    ttl_seconds: int,
    now: datetime.datetime,
) -> tuple[str, datetime.datetime]:
    """(token, bitiş anı) döndürür; bitiş anı JWT'deki `exp` ile AYNIDIR.

    `kullanici_anahtari` JWT'nin `user_key` claim'idir: uygulamadaki KALICI
    kimlik (öğretmen `t{id}`, öğrenci `c{id}`). Zoom'un oturum içi `userId`si
    her yeniden katılımda değişir; aynı kişiyi yeniden tanımak için istemci
    `participant.userKey` kullanır.
    """
    if not kullanici_anahtari or len(kullanici_anahtari) > _USER_KEY_AZAMI:
        raise ValueError("user_key 1-36 karakter olmalı")
    iat = int(now.timestamp()) - _IAT_GERI
    exp = iat + ttl_seconds
    token = jwt.encode(
        {
            "app_key": settings.ZOOM_VIDEO_SDK_KEY,
            "tpc": oturum,
            "role_type": 1 if egitmen_mi else 0,
            "version": 1,
            "iat": iat,
            "exp": exp,
            "user_key": kullanici_anahtari,
            "video_webrtc_mode": 1 if settings.ZOOM_VIDEO_WEBRTC else 0,
            "audio_webrtc_mode": 1,
        },
        settings.ZOOM_VIDEO_SDK_SECRET,
        algorithm="HS256",
        headers={"typ": "JWT"},
    )
    return token, datetime.datetime.fromtimestamp(exp, tz=datetime.timezone.utc)
