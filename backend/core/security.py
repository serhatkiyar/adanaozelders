from __future__ import annotations

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


def create_access_token(*, subject: int, role: str, role_id: int) -> str:
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
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
