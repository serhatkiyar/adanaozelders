from __future__ import annotations

import datetime

from pydantic import BaseModel, EmailStr, Field

from models.tutor import Gender
from schemas.user import USERNAME_PATTERN


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=512)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=75)
    last_name: str = Field(min_length=1, max_length=75)
    username: str = Field(min_length=3, max_length=50, pattern=USERNAME_PATTERN)
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    # KVKK aydınlatma + kullanım koşulları + gizlilik politikası onayı.
    # İstemci, onayladığı metinlerin sürümünü (legalContent.ts `updatedAt`,
    # "YYYY-MM-DD") gönderir; sunucu bunu `user_consents`'a yazar. İspat yükü
    # veri sorumlusunda olduğundan onay kaydı OLMADAN kayıt kabul edilmez.
    consent_version: str = Field(
        min_length=4, max_length=20, pattern=r"^\d{4}-\d{2}-\d{2}$"
    )


class MessageResponse(BaseModel):
    detail: str


class EmailVerifyConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeleteRequest(BaseModel):
    """Hesap silme onayı. Parola yeniden istenir: ele geçirilmiş bir oturumun
    hesabı yok etmesini zorlaştırır (geri alınamaz işlem)."""

    password: str = Field(min_length=1, max_length=128)
