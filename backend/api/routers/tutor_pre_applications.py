"""Eğitmen ön başvurusu — public lead ucu (oturum gerektirmez).

Facebook gruplarına atılan /egitmen-on-basvuru sayfasının arkasıdır. Hesap
açılmaz, e-posta doğrulanmaz; iletişim bilgisi + isteğe bağlı diploma/sertifika
toplanır ki lansmanda aday hazır evrakla hızla yayına alınabilsin. Admin
listesi `api/routers/admin.py` içindedir (tutors.view / tutors.manage).

Gövde multipart'tır (dosya taşıyabilir); alan doğrulaması yine pydantic
şemasından geçer (`TutorPreApplicationIn`) — Form alanları elle şemaya
katlanır, doğrulama kuralları iki yerde yaşamaz.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from core import storage
from core.config import settings
from core.database import get_db
from core.ratelimit import rate_limit
from schemas.tutor_pre_application import (
    TutorPreApplicationIn,
    TutorPreApplicationOut,
)
from services import tutor_pre_application_service

router = APIRouter(prefix="/tutor-pre-applications", tags=["tutor-pre-applications"])

# Public yazma ucu: iletişim formuyla aynı sınıf, aynı IP limiti
# (RATE_LIMIT_EMAIL). Her başarılı gönderim bir e-posta da doğurduğu için
# limit spam'le birlikte SMTP maliyetini de kapatır; dosya kabul ettiğinden
# depolama kotasını da aynı limit korur.
_submit_limit = rate_limit(
    key="tutor_lead",
    limit=settings.RATE_LIMIT_EMAIL,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

#: Anonim uçtan kabul edilen en fazla belge sayısı.
MAX_DOCUMENTS = 3


async def _oku_belgeler(
    documents: list[UploadFile],
) -> list[tuple[str, bytes, str | None]]:
    """Belge üçlüsünü doğrular: uzantı → içerik → boyut.

    Bu döngü bilerek router dosyasında durur (servise taşınmaz): anonim yazma
    ucunun dosya kapısı, ucun kendisiyle aynı yerde okunabilir olmalı.
    """
    files: list[tuple[str, bytes, str | None]] = []
    for doc in documents:
        # Diploma ucuyla aynı üçlü kalıp: uzantı → içerik → boyut. `read`
        # sınır+1 okur ki 100 MB'lık dosya belleğe tam inmeden 413 yesin.
        if not storage.is_allowed_resource(doc.filename):
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                "Desteklenmeyen dosya türü. PDF veya fotoğraf (JPG/PNG) yükleyin.",
            )
        data = await doc.read(settings.MAX_RESOURCE_SIZE_BYTES + 1)
        if not data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya")
        if len(data) > settings.MAX_RESOURCE_SIZE_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "Dosya çok büyük (en fazla 10 MB).",
            )
        files.append((doc.filename or "belge", data, doc.content_type))
    return files


async def _oku_fotograf(photo: UploadFile | None) -> bytes | None:
    """Profil fotoğrafı: avatar sınırı (5 MB). İçerik doğrulaması servistedir
    (Pillow gerçekten çözer); burada yalnız boyut kapısı vardır."""
    if photo is None or not photo.filename:
        return None
    data = await photo.read(settings.MAX_AVATAR_SIZE_BYTES + 1)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Boş dosya")
    if len(data) > settings.MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Fotoğraf çok büyük (en fazla 5 MB).",
        )
    return data


@router.post(
    "",
    response_model=TutorPreApplicationOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(_submit_limit)],
)
async def submit_pre_application(
    full_name: str = Form(...),
    phone: str = Form(...),
    subjects: str = Form(..., description="JSON dizisi: [\"Matematik\", ...]"),
    district: str | None = Form(None),
    experience: str | None = Form(None),
    note: str | None = Form(None),
    email: str | None = Form(None),
    kvkk_accepted: bool = Form(False),
    # İlan dosyası — formun isteğe bağlı bölümleri.
    headline: str | None = Form(None),
    bio: str | None = Form(None),
    intro_video_url: str | None = Form(None),
    teaching_mode: str | None = Form(None),
    hourly_rate: str | None = Form(None),
    availability_note: str | None = Form(None),
    education_note: str | None = Form(None),
    photo: UploadFile | None = File(default=None),
    documents: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
):
    try:
        subject_list = json.loads(subjects)
        if not isinstance(subject_list, list):
            raise ValueError("subjects bir dizi olmalı")
        payload = TutorPreApplicationIn(
            full_name=full_name,
            phone=phone,
            subjects=subject_list,
            district=district or None,
            experience=experience or None,
            note=note,
            email=(email or "").strip() or None,
            kvkk_accepted=kvkk_accepted,
            headline=headline,
            bio=bio,
            intro_video_url=intro_video_url,
            teaching_mode=teaching_mode or None,
            hourly_rate=hourly_rate or None,
            availability_note=availability_note,
            education_note=education_note,
        )
    except (ValueError, ValidationError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Geçersiz başvuru: {exc}"
        ) from exc

    if len(documents) > MAX_DOCUMENTS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"En fazla {MAX_DOCUMENTS} belge eklenebilir.",
        )
    files = await _oku_belgeler(documents)
    photo_bytes = await _oku_fotograf(photo)

    await tutor_pre_application_service.submit(
        db, payload, files=files, photo=photo_bytes
    )
    await db.commit()
    return TutorPreApplicationOut(
        detail="Başvurun alındı. En geç 24 saat içinde seni arayacağız."
    )
