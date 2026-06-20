"""Telefon (SMS OTP) doğrulama akışı — e-posta token akışının telefon karşılığı.

Numara kullanıcı satırında (``phone`` + ``phone_verified_at``) tutulur; OTP kodu
ayrı ``phone_otps`` tablosunda hash'li, süreli ve deneme-limitli durur. Kod yalnız
SMS ile gider (geliştirmede console log'una). SMS gönderimi best-effort'tur.

``require_phone_verified`` eylem-kapısıdır: rezervasyon/ödeme/mesaj gibi kritik
uçlarda admin hariç doğrulanmamış kullanıcıyı 403 ile durdurur.
"""
from __future__ import annotations

import datetime
import hashlib
import re
import secrets

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import sms
from core.config import settings
from models.phone_otp import PhoneOtp
from models.role import ROLE_IDS, RoleType

# Doğrulama yalnız admin HARİCİ rollerde anlamlıdır.
_ADMIN_ROLE = ROLE_IDS[RoleType.ADMIN]


def normalize_phone(raw: str) -> str | None:
    """Türk cep numarasını E.164'e (``+905XXXXXXXXX``) çevirir; geçersizse ``None``.

    Kabul: ``05XXXXXXXXX``, ``5XXXXXXXXX``, ``905...``, ``+905...`` (boşluk/(-)/() serbest).
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("90"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = digits[1:]
    # Kalan 10 hane olmalı ve cep (5 ile başlar).
    if len(digits) != 10 or not digits.startswith("5"):
        return None
    return "+90" + digits


def mask_phone(phone: str | None) -> str:
    """Görüntüleme için maskeler: ``+905XX***XX67``."""
    if not phone or len(phone) < 6:
        return phone or ""
    return phone[:5] + "***" + phone[-2:]


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _supports_phone(user) -> bool:
    """Admin'in telefon kolonu yoktur; doğrulama yalnız diğer rollerde."""
    return user.role_id != _ADMIN_ROLE and hasattr(user, "phone_verified_at")


async def request_otp(db: AsyncSession, user, raw_phone: str) -> str:
    """Numarayı normalize edip kullanıcıya yazar, OTP üretir ve SMS'le gönderir.

    Numara değişiyorsa önceki doğrulama düşer. Bekleyen kodlar geçersiz kılınır.
    Maskeli numarayı döner.
    """
    if not _supports_phone(user):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Bu hesap için telefon doğrulama gerekmez."
        )
    phone = normalize_phone(raw_phone)
    if phone is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Geçerli bir Türkiye cep numarası gir (ör. 0532 123 45 67).",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    # Numara değiştiyse doğrulamayı düşür; numarayı (yeniden) yaz.
    if user.phone != phone:
        user.phone = phone
        user.phone_verified_at = None
    # Bekleyen kodları geçersiz kıl — her an tek aktif kod.
    await db.execute(
        update(PhoneOtp)
        .where(
            PhoneOtp.role_id == user.role_id,
            PhoneOtp.user_id == user.id,
            PhoneOtp.used_at.is_(None),
        )
        .values(used_at=now)
    )
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(
        PhoneOtp(
            role_id=user.role_id,
            user_id=user.id,
            phone=phone,
            code_hash=_hash(code),
            expires_at=now
            + datetime.timedelta(minutes=settings.PHONE_OTP_TTL_MINUTES),
        )
    )
    await db.flush()
    await sms.send_otp_sms(to=phone, code=code)
    return mask_phone(phone)


async def verify_otp(db: AsyncSession, user, code: str) -> None:
    """Girilen kodu en güncel aktif OTP'ye karşı doğrular; başarıda numarayı onaylar.

    Hatalı/dolmuş/limit aşımı → 400. Deneme sayacı her hatalı denemede artar.
    """
    if not _supports_phone(user):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Bu hesap için telefon doğrulama gerekmez."
        )
    now = datetime.datetime.now(datetime.timezone.utc)
    otp = (
        await db.execute(
            select(PhoneOtp)
            .where(
                PhoneOtp.role_id == user.role_id,
                PhoneOtp.user_id == user.id,
                PhoneOtp.used_at.is_(None),
            )
            .order_by(PhoneOtp.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if otp is None or otp.expires_at <= now:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Kodun süresi doldu ya da yok. Yeni kod iste.",
        )
    if otp.attempts >= settings.PHONE_OTP_MAX_ATTEMPTS:
        otp.used_at = now
        await db.flush()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Çok fazla hatalı deneme. Yeni kod iste.",
        )
    if _hash(code.strip()) != otp.code_hash:
        otp.attempts += 1
        await db.flush()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod hatalı.")

    otp.used_at = now
    user.phone = otp.phone
    user.phone_verified_at = now
    await db.flush()


def require_phone_verified(user) -> None:
    """Eylem-kapısı: doğrulanmamışsa 403. Admin'de no-op (kapı uygulanmaz)."""
    if user.role_id == _ADMIN_ROLE:
        return
    if getattr(user, "phone_verified_at", None) is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Bu işlemi yapmadan önce telefon numaranı doğrulaman gerekiyor.",
        )
