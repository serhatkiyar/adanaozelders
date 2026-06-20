from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

from models.tutor import Gender
from schemas.education import EducationOut

USERNAME_PATTERN = r"^[a-zA-Z0-9_]+$"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    first_name: str
    last_name: str
    username: str
    full_name: str  # first_name + last_name (model hybrid)
    is_active: bool
    email_verified: bool = False
    phone: str | None = None
    phone_verified: bool = False
    role_id: int
    about: str | None = None
    avatar_url: str | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    created_at: datetime.datetime
    last_seen_at: datetime.datetime | None = None
    # Ad-soyad / kullanıcı adı kaç kez değiştirildi (ilk değişiklik serbest; sonrası
    # admin onayı gerektirir). Frontend uyarı/gerekçe akışını buna göre gösterir.
    name_change_count: int = 0
    username_change_count: int = 0
    # update_me yanıtında, ilgili alanın onaya gönderildiğini bildiren transient bayrak.
    pending_name_change: bool = False
    pending_username_change: bool = False


class UserUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=75)
    last_name: str | None = Field(default=None, min_length=1, max_length=75)
    username: str | None = Field(
        default=None, min_length=3, max_length=50, pattern=USERNAME_PATTERN
    )
    about: str | None = Field(default=None, max_length=2000)
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    # Ad-soyad/kullanıcı adının ikinci ve sonraki değişikliği için zorunlu gerekçe.
    reason: str | None = Field(default=None, max_length=500)


class NameChangeRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role_id: int
    kind: str
    new_first_name: str | None = None
    new_last_name: str | None = None
    new_username: str | None = None
    reason: str
    status: str
    review_note: str | None = None
    reviewed_at: datetime.datetime | None = None
    created_at: datetime.datetime


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class PhoneUpdate(BaseModel):
    phone: str = Field(min_length=7, max_length=20)


class PhoneOtpVerify(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class PhoneRequestResult(BaseModel):
    phone_masked: str


class UserStats(BaseModel):
    completed_lessons: int


class ClientPublicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str
    about: str | None = None
    avatar_url: str | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    created_at: datetime.datetime
    last_seen_at: datetime.datetime | None = None
    completed_lessons: int
    educations: list[EducationOut] = []


class ClientSearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str
    about: str | None = None
    avatar_url: str | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    last_seen_at: datetime.datetime | None = None
