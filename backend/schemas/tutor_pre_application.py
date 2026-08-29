from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

#: Formdaki deneyim seçenekleri — serbest metin değil, kapalı liste.
EXPERIENCE_CHOICES = ("universite-ogrencisi", "0-2", "3-5", "5+")


class TutorPreApplicationIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    # İsteğe bağlı: lansmanda kayıt daveti göndermek için.
    email: EmailStr | None = Field(default=None, max_length=255)
    subjects: list[str] = Field(min_length=1, max_length=10)
    district: str | None = Field(default=None, max_length=50)
    experience: str | None = Field(default=None)
    note: str | None = Field(default=None, max_length=2000)
    # KVKK aydınlatma onayı sunucuda da zorunludur (endpoint 422 verir);
    # varsayılan False: alan gönderilmezse onay VARSAYILMAZ.
    kvkk_accepted: bool = False

    @field_validator("subjects")
    @classmethod
    def _clean_subjects(cls, items: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in items:
            label = " ".join(item.split())
            if not label:
                continue
            if len(label) > 100:
                raise ValueError("branş adı en fazla 100 karakter olabilir")
            if label not in cleaned:
                cleaned.append(label)
        if not cleaned:
            raise ValueError("en az bir ders seçilmelidir")
        return cleaned

    @field_validator("experience")
    @classmethod
    def _known_experience(cls, value: str | None) -> str | None:
        if value is not None and value not in EXPERIENCE_CHOICES:
            raise ValueError("geçersiz deneyim seçimi")
        return value


class TutorPreApplicationOut(BaseModel):
    detail: str


class PreApplicationDocumentOut(BaseModel):
    """Ek belge. `url` private/ anahtarıdır; JSON yanıtında `PresignPrivateUrls`
    katmanı kısa ömürlü imzalı adrese çevirir."""

    url: str
    name: str


class AdminTutorPreApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    phone: str
    email: str | None = None
    subjects: str
    district: str | None = None
    experience: str | None = None
    note: str | None = None
    documents: list[PreApplicationDocumentOut] | None = None
    status: str
    kvkk_accepted_at: datetime.datetime
    created_at: datetime.datetime


class PreApplicationStatusIn(BaseModel):
    """Admin durum geçişi. Geçerli değerler modeldeki enum'dan doğrulanır."""

    status: str = Field(min_length=1, max_length=16)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        from models.tutor_pre_application import PreApplicationStatus

        if value not in {s.value for s in PreApplicationStatus}:
            raise ValueError("geçersiz durum")
        return value
