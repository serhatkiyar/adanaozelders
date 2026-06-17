from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_YEAR_MIN = 1950
_YEAR_MAX = 2100

# Diploma/belge türü ve doğrulama durumu sabitleri (DB'de String olarak tutulur).
DocumentType = Literal["DIPLOMA", "DENKLIK", "OGRENCI_BELGESI"]
VerificationStatus = Literal["NONE", "PENDING", "VERIFIED", "REJECTED"]


def _validate_tckn(v: str | None) -> str | None:
    """Boşsa None; verilmişse 11 haneli rakam olmalı (tam MERNIS kontrolü değil)."""
    if v is None:
        return None
    v = v.strip()
    if v == "":
        return None
    if not (v.isdigit() and len(v) == 11):
        raise ValueError("TCKN 11 haneli rakam olmalı")
    return v


class EducationCreate(BaseModel):
    school_name: str = Field(min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=100)
    field_of_study: str | None = Field(default=None, max_length=150)
    start_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    end_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    # Diploma doğrulama (yalnız eğitmen anlamlı): e-Devlet belge türü + barkod + TCKN.
    document_type: DocumentType | None = None
    verification_code: str | None = Field(default=None, max_length=60)
    verification_tckn: str | None = Field(default=None, max_length=11)

    _v_tckn = field_validator("verification_tckn")(_validate_tckn)

    @model_validator(mode="after")
    def _check_years(self):
        if (
            self.start_year is not None
            and self.end_year is not None
            and self.end_year < self.start_year
        ):
            raise ValueError("end_year cannot be earlier than start_year")
        return self


class EducationUpdate(BaseModel):
    school_name: str | None = Field(default=None, min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=100)
    field_of_study: str | None = Field(default=None, max_length=150)
    start_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    end_year: int | None = Field(default=None, ge=_YEAR_MIN, le=_YEAR_MAX)
    document_type: DocumentType | None = None
    verification_code: str | None = Field(default=None, max_length=60)
    verification_tckn: str | None = Field(default=None, max_length=11)

    _v_tckn = field_validator("verification_tckn")(_validate_tckn)


class EducationOut(BaseModel):
    """Public/paylaşımlı görünüm — eğitmen profilinde herkese görünür.
    Hassas alanlar (barkod, red notu) BURADA YOK."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    school_name: str
    degree: str | None = None
    field_of_study: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    # Yalnız eğitmen eğitimlerinde dolu (diploma/belge). Client'ta her zaman None.
    document_url: str | None = None
    document_name: str | None = None
    # Diploma doğrulama (rozet için yeterli kadarı public)
    document_type: DocumentType | None = None
    verification_status: VerificationStatus = "NONE"
    verified_at: datetime.datetime | None = None


class OwnEducationOut(EducationOut):
    """Sahibine (eğitmen /me) ve admin'e özel — barkod + TCKN + red notu dahil.
    Public EducationOut'ta YOK (TCKN asla public dönmez)."""

    verification_code: str | None = None
    verification_tckn: str | None = None
    verification_note: str | None = None


class EducationVerifyIn(BaseModel):
    """Admin: bir eğitim belgesini doğrula/reddet."""

    action: Literal["verify", "reject"]
    note: str | None = Field(default=None, max_length=500)


class AdminEducationOut(OwnEducationOut):
    """Admin görünümü: eğitmen kimliğiyle ad eşleşmesini kontrol edebilsin diye
    sahip eğitmenin adı da döner."""

    tutor_id: int
    tutor_name: str | None = None
