from __future__ import annotations

import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.storage_types import PublicAsset

Puan = Annotated[int, Field(ge=1, le=5)]
YORUM_MAKS = 2000


def _bos_yorum_none(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


#: Dört puan da zorunludur (23 Eyl 2026). Kolonlar legacy NULL kayıtlar yüzünden
#: nullable kalır; zorunluluk create/update doğrulamasındadır.
PUAN_ALANLARI = ("rating", "clarity_rating", "motivation_rating", "preparation_rating")
EKSIK_PUAN_MESAJI = "Değerlendirmeni göndermek için tüm puanları seç."


class ReviewCreate(BaseModel):
    booking_id: int
    # Genel puan alt kriterlerden hesaplanmaz; dördü bağımsız seçimlerdir.
    rating: Puan
    clarity_rating: Puan
    motivation_rating: Puan
    preparation_rating: Puan
    comment_text: str | None = Field(default=None, max_length=YORUM_MAKS)
    is_anonymous: bool = False

    _yorum = field_validator("comment_text")(_bos_yorum_none)


class ReviewUpdate(BaseModel):
    """Kısmi güncelleme (`exclude_unset`). Puanlar ve anonimlik için açık
    `null` kabul edilmez. Legacy NULL kriterli kaydın eksikleri tamamlanmadan
    kaydedilemeyeceği kuralı birleşik kayda bakar (review_service)."""

    rating: Puan | None = None
    clarity_rating: Puan | None = None
    motivation_rating: Puan | None = None
    preparation_rating: Puan | None = None
    comment_text: str | None = Field(default=None, max_length=YORUM_MAKS)
    is_anonymous: bool | None = None

    _yorum = field_validator("comment_text")(_bos_yorum_none)

    @model_validator(mode="after")
    def _zorunlular_null_olamaz(self) -> "ReviewUpdate":
        for alan in (*PUAN_ALANLARI, "is_anonymous"):
            if alan in self.model_fields_set and getattr(self, alan) is None:
                raise ValueError(f"{alan} boş bırakılamaz")
        return self


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # Anonim değerlendirme sahibi olmayana döndüğünde kimliği ele veren
    # alanlar (booking_id, client_id, ad, fotoğraf) None'dır.
    booking_id: int | None = None
    client_id: int | None = None
    tutor_id: int
    rating: int
    clarity_rating: int | None = None
    motivation_rating: int | None = None
    preparation_rating: int | None = None
    comment_text: str | None = None
    is_anonymous: bool = False
    created_at: datetime.datetime
    # "Düzenlendi" etiketi yalnız bundan beslenir (updated_at değil).
    edited_at: datetime.datetime | None = None
    client_name: str | None = None
    client_avatar_url: PublicAsset | None = None


class RatingDistributionOut(BaseModel):
    """Yıldız puan dağılımı — özet başlık + 5→1 dağılım çubukları için.
    Eğitmen ve kütüphane değerlendirmelerinde ortak kullanılır."""

    count: int = 0
    average: float | None = None
    # Yıldız (1..5) → adet.
    distribution: dict[int, int] = Field(default_factory=dict)


class TutorRatingSummaryOut(RatingDistributionOut):
    """Öğretmen değerlendirme özeti: genel dağılım + alt kriter ortalamaları.
    Alt kriter ortalaması yalnız o kritere puan verilmiş kayıtlardan hesaplanır."""

    clarity_average: float | None = None
    motivation_average: float | None = None
    preparation_average: float | None = None
