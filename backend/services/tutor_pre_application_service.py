"""Eğitmen ön başvurusu — public lead toplama.

Neden tam kayıt değil: bkz. ``models/tutor_pre_application.py``. Servis üç iş
yapar: telefonu E.164'e indirger (aynı numara iki biçimde iki kayıt olmasın),
çift gönderimi sessizce yutar (double-click / sayfa yenileme) ve işletmeye
outbox üzerinden e-posta düşürür (SMTP anlık ölüyse bildirim kaybolmaz).
"""
from __future__ import annotations

import datetime
import logging

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import outbox, storage
from models.tutor_pre_application import (
    PreApplicationStatus,
    TutorPreApplication,
)
from schemas.tutor_pre_application import TutorPreApplicationIn
from services.support_service import support_inbox
from services.phone_service import normalize_phone

logger = logging.getLogger("adana.tutor_lead")


def prepare_submission(payload: TutorPreApplicationIn) -> dict:
    """Saf doğrulama/normalizasyon (pytest'li).

    KVKK onayı sunucuda da zorunludur — istemci checkbox'ı atlanabilir; onaysız
    kişisel veri işlenmez. Telefon E.164'e çevrilemiyorsa kayıt açılmaz: lead'in
    tek değeri aranabilir bir numaradır.
    """
    if not payload.kvkk_accepted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Başvuru için KVKK aydınlatma metnini onaylamanız gerekiyor.",
        )
    phone = normalize_phone(payload.phone)
    if phone is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Geçerli bir cep telefonu numarası girin (05XX XXX XX XX).",
        )
    note = (payload.note or "").strip()
    return {
        "full_name": " ".join(payload.full_name.split()),
        "phone": phone,
        "email": payload.email.strip().lower() if payload.email else None,
        "subjects": ", ".join(payload.subjects),
        "district": payload.district,
        "experience": payload.experience,
        "note": note or None,
        # İlan dosyası — formun isteğe bağlı bölümleri. Doldurulmayan alan
        # None gelir ve NULL yazılır.
        "headline": payload.headline or None,
        "bio": payload.bio or None,
        "intro_video_url": payload.intro_video_url or None,
        "teaching_mode": payload.teaching_mode,
        "hourly_rate": payload.hourly_rate,
        "availability_note": payload.availability_note or None,
        "education_note": payload.education_note or None,
    }


async def submit(
    db: AsyncSession,
    payload: TutorPreApplicationIn,
    *,
    files: list[tuple[str, bytes, str | None]] | None = None,
    photo: bytes | None = None,
) -> bool:
    """Kaydı ekler (commit ÇAĞIRANIN); yeni kayıt oluştuysa True döner.

    Aynı telefonla bekleyen (NEW/CONTACTED) kayıt varsa yenisi AÇILMAZ ama
    kullanıcıya yine başarı dönülür: "bu numara zaten kayıtlı" demek hem UX
    kazandırmaz hem de numaranın sistemde olduğunu üçüncü kişiye sızdırır.
    Sonuçlanmış (CONVERTED/REJECTED) kayıt engel değildir — kişi aylar sonra
    yeniden başvurabilir.

    ``files``: (ad, içerik, content_type) üçlüleri — doğrulaması ÇAĞIRANDA
    (uçta) yapılmıştır. Yükleme yalnız yeni kayıt açılacaksa yapılır; yükleme
    sonrası bir adım patlarsa dosyalar telafi olarak silinir (aksi hâlde
    private/ altında sahipsiz dosya birikir — `store_merchandising` deseni).
    """
    data = prepare_submission(payload)
    existing = await db.scalar(
        select(TutorPreApplication.id)
        .where(
            TutorPreApplication.phone == data["phone"],
            TutorPreApplication.status.in_(
                (
                    PreApplicationStatus.NEW.value,
                    PreApplicationStatus.CONTACTED.value,
                )
            ),
        )
        .limit(1)
    )
    if existing is not None:
        logger.info("ön başvuru yinelendi (mevcut id=%s), yeni kayıt yok", existing)
        return False

    yuklenen: list[str] = []  # telafi silme kapsamı (belge + fotoğraf)
    documents: list[dict[str, str]] = []
    photo_url: str | None = None
    try:
        for name, content, content_type in files or []:
            url = await storage.upload_file(
                content,
                original_name=name,
                content_type=content_type,
                prefix="tutor-pre-applications",
            )
            yuklenen.append(url)
            documents.append({"url": url, "name": name})
        if photo is not None:
            photo_url = await _upload_photo(photo)
            yuklenen.append(photo_url)

        db.add(
            TutorPreApplication(
                **data,
                photo_url=photo_url,
                documents=documents or None,
                kvkk_accepted_at=datetime.datetime.now(datetime.timezone.utc),
            )
        )
        outbox.enqueue(
            db,
            "email:tutor_lead",
            {
                "to": support_inbox(),
                "name": data["full_name"],
                "phone": data["phone"],
                "email": data["email"],
                "subjects": data["subjects"],
                "district": data["district"],
                "experience": data["experience"],
                "note": data["note"],
                "document_count": len(documents),
                "has_photo": photo_url is not None,
            },
        )
    except Exception:
        await _telafi_sil(yuklenen)
        raise
    logger.info(
        "yeni öğretmen ön başvurusu kuyruğa alındı (%s belge)", len(documents)
    )
    return True


async def _upload_photo(content: bytes) -> str:
    """Fotoğrafı private önekte saklar; çözülemeyen dosya 415'e çevrilir.

    Pillow dosyayı gerçekten açar — uzantı whitelist'i yalnız ADI kontrol
    eder. ".jpg" adıyla gelen bir PDF ya da bozuk bayt dizisi burada elenir.
    """
    try:
        return await storage.upload_pre_application_photo(content)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — Pillow çeşitli istisna atar
        logger.info("ön başvuru fotoğrafı çözülemedi: %s", exc)
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Fotoğraf okunamadı. JPG, PNG veya WEBP yükleyin.",
        ) from exc


async def _telafi_sil(urls: list[str]) -> None:
    for url in urls:
        try:
            await storage.delete_file(url)
        except Exception:  # noqa: BLE001 — telafi best-effort, asıl hata yutulmaz
            logger.warning("telafi silme başarısız: %s", url)
