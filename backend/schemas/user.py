from __future__ import annotations

import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from models.tutor import Gender
from schemas.education import EducationOut



class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    first_name: str
    last_name: str
    full_name: str  # first_name + last_name (model hybrid)
    is_active: bool
    email_verified: bool = False
    # Hesabin parolasi var mi (model: PasswordMixin.has_password). Google ile
    # acilan hesapta False'tur ve arayuz buna bakar: parolasiz hesaba "Sifre
    # degistir" formu gosterilirse form HICBIR ZAMAN calismaz (mevcut parola
    # sorulur, oysa yoktur). Ayarlar ekrani bunun yerine "Sifremi unuttum"a
    # yonlendirir.
    has_password: bool = True
    phone: str | None = None
    phone_verified: bool = False
    role_id: int
    about: str | None = None
    avatar_url: str | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    created_at: datetime.datetime
    last_seen_at: datetime.datetime | None = None
    # Ad-soyad kaç kez değiştirildi (ilk değişiklik serbest; sonrası admin onayı
    # gerektirir). Frontend uyarı/gerekçe akışını buna göre gösterir.
    name_change_count: int = 0
    # Bu alanın bir sonraki değişiminin doğrudan mı uygulanacağı yoksa admin onayına
    # mı gideceği — role/duruma göre (örn. onaylı eğitmen + operatör her zaman onaya).
    # Frontend gerekçe alanını ve "onaya gidecek" uyarısını buna göre gösterir.
    name_change_locked: bool = False
    # update_me yanıtında, ilgili alanın onaya gönderildiğini bildiren transient bayrak.
    pending_name_change: bool = False
    admin_role_code: str | None = None
    admin_permissions: list[str] = Field(default_factory=list)


class UserUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=75)
    last_name: str | None = Field(default=None, min_length=1, max_length=75)
    about: str | None = Field(default=None, max_length=2000)
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    # Ad-soyadın ikinci ve sonraki değişikliği için zorunlu gerekçe.
    reason: str | None = Field(default=None, max_length=500)


class NameChangeRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role_id: int
    kind: str
    new_first_name: str | None = None
    new_last_name: str | None = None
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
    #: None → varsayılan (WhatsApp ayarlıysa önce WhatsApp). "sms" → kullanıcı
    #: "SMS olarak al" dedi.
    channel: Literal["whatsapp", "sms"] | None = None


class PhoneOtpVerify(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class PhoneRequestResult(BaseModel):
    phone_masked: str
    #: Kodun fiilen gittiği kanal: "whatsapp" | "sms".
    channel: str = "sms"


class UserStats(BaseModel):
    completed_lessons: int


class ClientPublicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    about: str | None = None
    avatar_url: str | None = None
    #: Tam doğum tarihi yalnız admin yanıtında (İP-3 §4.4); eğitmen `age` alır.
    birth_date: datetime.date | None = None
    age: int | None = None
    gender: Gender | None = None
    created_at: datetime.datetime
    last_seen_at: datetime.datetime | None = None
    completed_lessons: int
    educations: list[EducationOut] = []


class ClientSearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    about: str | None = None
    avatar_url: str | None = None
    birth_date: datetime.date | None = None
    gender: Gender | None = None
    last_seen_at: datetime.datetime | None = None
