"""Rotasyonlu refresh token akışı.

Her başarılı `rotate` eski token'ı revoke edip yenisini üretir (tek kullanımlık
rotasyon). Ham token DB'de saklanmaz; yalnız SHA-256 özeti aranır.
"""
from __future__ import annotations

import datetime
import hashlib
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.refresh_token import RefreshToken


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def issue(db: AsyncSession, *, role_id: int, user_id: int) -> str:
    """Yeni refresh token üretir, hash'ini saklar, ham token döner."""
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            role_id=role_id,
            user_id=user_id,
            token_hash=_hash(raw),
            expires_at=_now()
            + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    await db.flush()
    return raw


async def _lookup_valid(db: AsyncSession, raw_token: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == _hash(raw_token))
    tok = (await db.execute(stmt)).scalar_one_or_none()
    if tok is None or tok.revoked_at is not None or tok.expires_at <= _now():
        return None
    return tok


async def rotate(
    db: AsyncSession, *, raw_token: str
) -> tuple[int, int, str] | None:
    """Geçerli token'ı doğrular, REVOKE eder ve yenisini üretir.

    (role_id, user_id, yeni_ham_token) döner; geçersiz/expired/revoked ise None.
    """
    tok = await _lookup_valid(db, raw_token)
    if tok is None:
        return None
    tok.revoked_at = _now()
    new_raw = await issue(db, role_id=tok.role_id, user_id=tok.user_id)
    return tok.role_id, tok.user_id, new_raw


async def revoke(db: AsyncSession, *, raw_token: str) -> None:
    """Logout'ta refresh token'ı geçersiz kılar (yoksa no-op)."""
    tok = await _lookup_valid(db, raw_token)
    if tok is not None:
        tok.revoked_at = _now()
        await db.flush()
