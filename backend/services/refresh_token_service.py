"""Rotasyonlu refresh token akışı.

Her başarılı `rotate` eski token'ı revoke edip yenisini üretir (tek kullanımlık
rotasyon). Ham token DB'de saklanmaz; yalnız SHA-256 özeti aranır.
"""
from __future__ import annotations

import datetime
import hashlib
import secrets

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.refresh_token import RefreshToken


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def issue(
    db: AsyncSession, *, role_id: int, user_id: int, persistent: bool = True
) -> str:
    """Yeni refresh token üretir, hash'ini saklar, ham token döner.

    ``persistent`` "beni hatırla" tercihidir ve çerezin ömrünü belirler; rotasyon
    zinciri boyunca taşınır (bkz. :func:`rotate`).
    """
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            role_id=role_id,
            user_id=user_id,
            token_hash=_hash(raw),
            persistent=persistent,
            expires_at=_now()
            + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    await db.flush()
    return raw


async def revoke_all_for_user(db: AsyncSession, *, role_id: int, user_id: int) -> None:
    """Kullanıcının TÜM aktif refresh token'larını iptal eder (bulk; commit
    çağıranın). Şifre sıfırlama / hesap kapatma gibi güvenlik olaylarında
    oturum sürekliliği kesilir — kısa ömürlü access token doğal ölür."""
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.role_id == role_id,
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )


async def _lookup_valid(db: AsyncSession, raw_token: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == _hash(raw_token))
    tok = (await db.execute(stmt)).scalar_one_or_none()
    if tok is None or tok.revoked_at is not None or tok.expires_at <= _now():
        return None
    return tok


async def rotate(
    db: AsyncSession, *, raw_token: str
) -> tuple[int, int, str, bool] | None:
    """Geçerli token'ı doğrular, REVOKE eder ve yenisini üretir.

    (role_id, user_id, yeni_ham_token, persistent) döner; geçersiz/expired/
    revoked ise None. ``persistent`` devredilir: kullanıcının giriş anındaki
    "beni hatırla" tercihi, oturum yenilendikçe kaybolmamalı.
    """
    tok = await _lookup_valid(db, raw_token)
    if tok is None:
        return None
    tok.revoked_at = _now()
    new_raw = await issue(
        db, role_id=tok.role_id, user_id=tok.user_id, persistent=tok.persistent
    )
    return tok.role_id, tok.user_id, new_raw, tok.persistent


async def is_persistent(db: AsyncSession, *, raw_token: str | None) -> bool:
    """Token'ın "beni hatırla" tercihi. Token yok/geçersizse ``True``.

    Varsayılanın ``True`` olması bilinçli: tercih okunamadığında kullanıcıyı
    tarayıcıyı kapattığı anda oturumdan atmak, tanımsız durumda verilecek en
    can sıkıcı karardır — ve bu bir güvenlik sınırı değil, konfor tercihidir.
    """
    if not raw_token:
        return True
    tok = await _lookup_valid(db, raw_token)
    return True if tok is None else tok.persistent


async def revoke(db: AsyncSession, *, raw_token: str) -> None:
    """Logout'ta refresh token'ı geçersiz kılar (yoksa no-op)."""
    tok = await _lookup_valid(db, raw_token)
    if tok is not None:
        tok.revoked_at = _now()
        await db.flush()
