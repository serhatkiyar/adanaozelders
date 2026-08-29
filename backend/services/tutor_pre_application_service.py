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
    }


async def submit(
    db: AsyncSession,
    payload: TutorPreApplicationIn,
    *,
    files: list[tuple[str, bytes, str | None]] | None = None,
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

    documents: list[dict[str, str]] = []
    for name, content, content_type in files or []:
        url = await storage.upload_file(
            content,
            original_name=name,
            content_type=content_type,
            prefix="tutor-pre-applications",
        )
        documents.append({"url": url, "name": name})

    try:
        db.add(
            TutorPreApplication(
                **data,
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
            },
        )
    except Exception:
        for doc in documents:
            try:
                await storage.delete_file(doc["url"])
            except Exception:  # noqa: BLE001 — telafi best-effort, asıl hata yutulmaz
                logger.warning("telafi silme başarısız: %s", doc["url"])
        raise
    logger.info(
        "yeni eğitmen ön başvurusu kuyruğa alındı (%s belge)", len(documents)
    )
    return True
