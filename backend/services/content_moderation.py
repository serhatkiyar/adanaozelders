"""Kullanıcı içeriğini yayından kaldırma (yorum moderasyonu).

BOŞLUK: şikayet kuyruğu vardı ama çözümün İÇERİĞE dokunan bir karşılığı yoktu.
Admin bir yorumu "RESOLVED" işaretleyebiliyor, hakaret içeren yorum yayında
kalmaya devam ediyordu; elde yalnız iki seçenek vardı — hiçbir şey yapmamak ya
da kaydı tamamen silmek (kanıt da giderdi).

TASARIM
- Gizleme, silme değildir: kayıt durur, `hidden_at/hidden_by/hidden_reason`
  dolar, karar geri alınabilir ve tekrar eden şikayetlerde geçmiş görünür.
- Gizlenen yorum PUANA DA SAYILMAZ: aksi halde 1 yıldızlı hakaret yorumu
  ekrandan kalkar ama eğitmenin ortalamasını düşürmeye devam ederdi. Bu yüzden
  gizleme/geri alma, ilgili varlığın `rating_count/rating_sum` toplamlarını
  da günceller (aynı işlemin iki kez uygulanması engellenir).
"""
from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from models.library import Library, LibraryReview
from models.review import Review
from models.store import Product, ProductReview
from models.tutor import Tutor

# Şikayet hedef tipi → (yorum modeli, puan sahibi modeli, sahip FK'si)
_TARGETS = {
    "REVIEW": (Review, Tutor, "tutor_id"),
    "PRODUCT_REVIEW": (ProductReview, Product, "product_id"),
    "LIBRARY_REVIEW": (LibraryReview, Library, "library_id"),
}

MODERATABLE_TARGETS = frozenset(_TARGETS)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _rating_delta(owner_model, owner_id: int, *, count_delta: int, sum_delta: int):
    return (
        update(owner_model)
        .where(owner_model.id == owner_id)
        .values(
            rating_count=owner_model.rating_count + count_delta,
            rating_sum=owner_model.rating_sum + sum_delta,
        )
    )


async def _load(db: AsyncSession, target_type: str, target_id: int):
    entry = _TARGETS.get(target_type)
    if entry is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Bu içerik türü gizlenemez: {target_type}",
        )
    model, owner_model, owner_field = entry
    content = await db.get(model, target_id)
    if content is None or content.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "İçerik bulunamadı")
    return content, owner_model, owner_field


def _counts_to_rating(content) -> bool:
    """Bu yorum puan ortalamasına katkı veriyor mu?

    Kütüphane yorumlarında karma puanlama vardır: yalnız doğrulanmış ziyaretçinin
    yorumu ortalamaya sayılır (`counts_to_rating`). Sayılmayan bir yorumu
    gizlerken ortalamadan düşmek, ortalamayı bozardı.
    """
    return getattr(content, "counts_to_rating", True)


async def hide(
    db: AsyncSession,
    *,
    target_type: str,
    target_id: int,
    admin,
    reason: str | None = None,
):
    """İçeriği yayından kaldırır (idempotent)."""
    content, owner_model, owner_field = await _load(db, target_type, target_id)
    if content.hidden_at is not None:
        return content

    content.hidden_at = _now()
    content.hidden_by = admin.id
    content.hidden_reason = (reason or "").strip()[:300] or None

    if _counts_to_rating(content):
        await db.execute(
            _rating_delta(
                owner_model,
                getattr(content, owner_field),
                count_delta=-1,
                sum_delta=-content.rating,
            )
        )
    await db.flush()
    return content


async def unhide(db: AsyncSession, *, target_type: str, target_id: int):
    """Gizleme kararını geri alır (idempotent)."""
    content, owner_model, owner_field = await _load(db, target_type, target_id)
    if content.hidden_at is None:
        return content

    content.hidden_at = None
    content.hidden_by = None
    content.hidden_reason = None

    if _counts_to_rating(content):
        await db.execute(
            _rating_delta(
                owner_model,
                getattr(content, owner_field),
                count_delta=1,
                sum_delta=content.rating,
            )
        )
    await db.flush()
    return content
