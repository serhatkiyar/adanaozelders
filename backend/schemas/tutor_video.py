"""Eğitmen tanıtım videosu (doğrudan yükleme ve bağlantı) şemaları.

* ``IntroVideoOut`` — PUBLIC profil yanıtındaki işlenmiş video (yalnız ACTIVE).
* ``TutorIntroVideoOut`` — eğitmenin kendi görünümü (durum, hata, red notu).
* ``UploadInitIn/Out`` — imzalı PUT akışı.
* ``AdminTutorVideoOut`` / ``TutorVideoReviewIn`` — onay kuyruğu.

Anahtarlar DB'de durur; ``PublicAsset`` serileştirmede CDN adresine çevirir.
"""
from __future__ import annotations

import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.storage_types import PublicAsset

_CONTENT_TYPE_RE = re.compile(r"^video/[a-z0-9.+-]{1,60}$")


class IntroVideoOut(BaseModel):
    """Public: yalnız ACTIVE video buraya girer (servis garanti eder)."""

    kind: Literal["upload"] = "upload"
    mp4_url: PublicAsset
    poster_url: PublicAsset | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None


class TutorIntroVideoOut(BaseModel):
    """Eğitmenin kendi görünümü: yolda/aktif/başarısız kaydın durumu."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    #: UPLOAD (yüklenen dosya) | LINK (YouTube/Vimeo bağlantısı, `link_url`).
    kind: Literal["UPLOAD", "LINK"] = "UPLOAD"
    link_url: str | None = None
    mp4_url: PublicAsset | None = None
    poster_url: PublicAsset | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    error_code: str | None = None
    error_message: str | None = None
    review_note: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class TutorIntroVideoStateOut(BaseModel):
    """`GET /tutors/me/intro-video` — tek istekte bütün durum."""

    active: TutorIntroVideoOut | None = None
    pending: TutorIntroVideoOut | None = None
    #: YAYINDAKİ YouTube/Vimeo bağlantısı (tek kaynak kuralı: `active` ile aynı
    #: anda dolu olmaz). Onay bekleyen bağlantı `pending` (kind=LINK) içindedir.
    link_url: str | None = None
    uploads_enabled: bool
    max_bytes: int
    max_seconds: int
    min_seconds: int
    #: Görüntünün kısa kenarı alt sınırı (px; `TUTOR_VIDEO_MIN_HEIGHT`). Worker
    #: daha düşüğünü reddeder; istemci yüklemeden önce aynı kuralla uyarır.
    min_short_side: int
    require_review: bool


class UploadInitIn(BaseModel):
    filename: str = Field(max_length=255)
    size_bytes: int = Field(gt=0)
    content_type: str = Field(max_length=100)

    @field_validator("content_type")
    @classmethod
    def _video_only(cls, v: str) -> str:
        # Tarayıcı kaydı tipi parametreyle gelir (`video/webm;codecs=vp9,opus`);
        # imzalı PUT'a ve depoya yalnız baz tip yazılır.
        v = v.split(";", 1)[0].strip().lower()
        if not _CONTENT_TYPE_RE.match(v):
            raise ValueError("Yalnızca video dosyası yüklenebilir")
        return v


class UploadInitOut(BaseModel):
    video_id: int
    upload_url: str
    method: Literal["PUT"] = "PUT"
    #: Tarayıcının imzalı istekte BİREBİR göndermesi gereken başlıklar.
    headers: dict[str, str]
    expires_at: datetime.datetime


class AdminTutorVideoOut(TutorIntroVideoOut):
    tutor_id: int
    tutor_name: str | None = None


class TutorVideoReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=500)
