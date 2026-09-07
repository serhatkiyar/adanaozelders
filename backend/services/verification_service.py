"""E-posta doğrulama ve şifre sıfırlama token akışı.

Token üretimi/tüketimi tek bir yerde toplanır; ham token yalnızca e-posta linkinde
gider, DB'de hash'i saklanır (bkz. models/verification_token.py). E-posta gönderimi
best-effort'tur (mail katmanı yutar) — token üretimi başarısız olmaz.
"""
from __future__ import annotations

import datetime
import hashlib
import secrets

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import mail
from core.config import settings
from models.verification_token import TokenPurpose, VerificationToken
# role_id -> kullanıcı modeli: TEK kaynaktan (İP-3 §6.3). Buradaki eski elle
# yazılmış 3 rollük kopya, operatör ve kuryenin "şifremi unuttum" akışını
# sessizce öldürüyordu (mail gidiyor, consume_token None dönüyordu).
from services.auth_service import MODEL_BY_ROLE_ID as _MODEL_BY_ROLE


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _ttl_hours(purpose: TokenPurpose) -> int:
    if purpose is TokenPurpose.PASSWORD_RESET:
        return settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    if purpose is TokenPurpose.ACCOUNT_DELETE:
        # Silme geri alınamaz; onay penceresi şifre sıfırlamayla aynı kısalıkta
        # tutulur. E-posta doğrulamanın 24 saati burada fazla geniş olurdu.
        return settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    return settings.EMAIL_VERIFY_TOKEN_TTL_HOURS


async def issue_token(
    db: AsyncSession, *, user, purpose: TokenPurpose
) -> str:
    """Hedef kullanıcı için tek kullanımlık ham token üretir.

    Aynı amaçlı bekleyen (kullanılmamış) tokenları geçersiz kılar — her an tek aktif
    token olur. Ham token döner (e-postada gönderilecek); DB'de yalnız hash'i durur.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    await db.execute(
        update(VerificationToken)
        .where(
            VerificationToken.purpose == purpose,
            VerificationToken.role_id == user.role_id,
            VerificationToken.user_id == user.id,
            VerificationToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        VerificationToken(
            purpose=purpose,
            role_id=user.role_id,
            user_id=user.id,
            token_hash=_hash(raw),
            expires_at=now + datetime.timedelta(hours=_ttl_hours(purpose)),
        )
    )
    await db.flush()
    return raw


async def consume_token(
    db: AsyncSession, *, raw_token: str, purpose: TokenPurpose
):
    """Token'ı doğrular ve tüketir (used_at). Hedef kullanıcıyı döner.

    Geçersiz / süresi dolmuş / kullanılmış / hedefi silinmiş ise ``None`` döner.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    stmt = select(VerificationToken).where(
        VerificationToken.token_hash == _hash(raw_token),
        VerificationToken.purpose == purpose,
    )
    token = (await db.execute(stmt)).scalar_one_or_none()
    if token is None or token.used_at is not None or token.expires_at <= now:
        return None
    model = _MODEL_BY_ROLE.get(token.role_id)
    if model is None:
        return None
    user = await db.get(model, token.user_id)
    if user is None or user.deleted_at is not None:
        return None
    token.used_at = now
    await db.flush()
    return user


async def send_email_verification(db: AsyncSession, user) -> None:
    """Doğrulama maili gönderir (best-effort). Zaten doğrulanmışsa no-op."""
    if getattr(user, "email_verified_at", None) is not None:
        return
    raw = await issue_token(db, user=user, purpose=TokenPurpose.EMAIL_VERIFY)
    url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/e-posta-dogrula?token={raw}"
    await mail.send_verification_email(to=user.email, name=user.full_name, verify_url=url)


async def send_password_reset(db: AsyncSession, user) -> None:
    """Şifre sıfırlama maili gönderir (best-effort)."""
    raw = await issue_token(db, user=user, purpose=TokenPurpose.PASSWORD_RESET)
    url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/sifre-yenile?token={raw}"
    await mail.send_password_reset_email(to=user.email, name=user.full_name, reset_url=url)


async def send_account_delete_confirm(db: AsyncSession, user) -> None:
    """Hesap silme onay bağlantısını yollar (parolasız hesaplar için).

    Parolalı hesapta silme parola ile onaylanır. Google ile açılmış hesabın
    parolası yoktur ve o kapı kapalı kalsaydı kullanıcı KVKK silme hakkını
    kullanamazdı. Onay yine de İKİNCİ bir kanıt ister: e-posta kutusuna erişim.
    """
    raw = await issue_token(db, user=user, purpose=TokenPurpose.ACCOUNT_DELETE)
    url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/hesap-silme-onayi?token={raw}"
    await mail.send_account_delete_email(
        to=user.email, name=user.full_name, confirm_url=url
    )


async def mark_email_verified(db: AsyncSession, user) -> None:
    if user.email_verified_at is None:
        user.email_verified_at = datetime.datetime.now(datetime.timezone.utc)
        await db.flush()
