from __future__ import annotations

import asyncio
import datetime
import secrets

import bcrypt
import jwt

from core.config import settings

_BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    pwd = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pwd, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    pwd = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.checkpw(pwd, hashed_password.encode("utf-8"))


# ── Async sarmalayıcılar (istek yollarında BUNLAR kullanılır) ───────────────────
#
# bcrypt kasıtlı olarak YAVAŞTIR — güvenliğinin kaynağı bu. Varsayılan maliyet
# çarpanında tek bir hash ~250 ms CPU harcar ve saf Python'dan çağrıldığında
# event loop'u o süre boyunca BLOKLAR: yani bir kullanıcı giriş yaparken o anki
# TÜM isteklerin yanıtı bekler. Aynı anda birkaç login, sunucuyu yanıt veremez
# hale getirir (`optimize_image` için Pillow'da alınan kararın aynısı).
#
# Senkron sürümler bilerek duruyor: seed ve bakım betikleri event loop dışında
# çalışır, orada sarmalayıcı gereksiz bir karmaşıklık olurdu.


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(verify_password, password, hashed_password)


def create_access_token(
    *, subject: int, role: str, role_id: int, auth_version: int | None = None
) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": str(subject),
        "role": role,
        "role_id": role_id,
        "type": "access",
        # jti: logout'ta token'ı denylist'e koyabilmek için benzersiz kimlik.
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "exp": now + datetime.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    # Oturum sürümü (İP-3 §6 — BÜTÜN roller): şifre değişimi/sıfırlaması ve
    # hesap kapatma auth_version'ı artırır; eski sürümlü token
    # get_current_user'da anında reddedilir.
    if auth_version is not None:
        payload["auth_ver"] = auth_version
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
