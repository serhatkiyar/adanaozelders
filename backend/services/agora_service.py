"""Agora RTC giriş token'ı üretimi (AccessToken2, "007").

Token AgoraIO/Tools'un resmî kodu ile üretilir (`services/agora_token/`,
değiştirilmeden vendorlandı). String uid (`build_token_with_user_account`)
ve `Role_Publisher` kullanılır: `rtc` modunda herkes yayın yapar; öğretmen
yetkileri SDK'da değil bizim backend'dedir.

Bu modül YALNIZ token üretir — hiçbir yetki kararı vermez. Kimin token
alabileceği `api/routers/bookings.py::_canli_ders_kapilari` içinde belirlenir.
"""
from __future__ import annotations

import datetime
import time

from core.config import settings
from services.agora_token.RtcTokenBuilder2 import Role_Publisher, RtcTokenBuilder


def ders_token_uret(*, kanal: str, uid: str, bitis: datetime.datetime) -> tuple[str, datetime.datetime]:
    """`kanal` + `uid` için `bitis` anına kadar geçerli token; (token, gerçek bitiş).

    AccessToken2 süreyi "şu andan itibaren saniye" olarak alır ve düzenleme
    anını kendi `int(time.time())` çağrısıyla damgalar; o damga bizimkinden
    en fazla 1 sn sonra olabileceği için süreden 1 sn düşülür. Böylece token
    `bitis`i asla aşmaz; döndürülen bitiş gerçek bitişten en fazla 1 sn önce.
    """
    simdi = int(time.time())
    ttl = int(bitis.timestamp()) - simdi - 1
    if ttl <= 0:
        raise ValueError("Token süresi pozitif olmalı")
    token = RtcTokenBuilder.build_token_with_user_account(
        settings.AGORA_APP_ID,
        settings.AGORA_APP_CERTIFICATE,
        kanal,
        uid,
        Role_Publisher,
        token_expire=ttl,
        privilege_expire=ttl,
    )
    return token, datetime.datetime.fromtimestamp(simdi + ttl, tz=datetime.timezone.utc)
