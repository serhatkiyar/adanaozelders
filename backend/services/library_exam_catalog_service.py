"""Deneme katalogu (blueprint) iş mantığı — admin küratörlüğünde.

Katalog, denemenin *içeriğini* (yayıncı, ad, tür, cevap anahtarı) temsil eder;
fiziksel oturumdan (``LibraryExamSession``) ayrıdır. Birden çok kütüphane aynı
public katalogu kendi oturumunda kullanabilir → ortak cevap anahtarı + (ileride)
çapraz-kütüphane sıralama.
"""

from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import storage
from models.admin import Admin
from models.library_exam import LibraryExamSession
from models.library_exam_catalog import LibraryExamCatalog
from schemas.library_exam_catalog import CatalogCreate, CatalogOut, CatalogUpdate


def _to_out(
    cat: LibraryExamCatalog,
    *,
    session_count: int = 0,
    include_answer_key: bool = True,
) -> CatalogOut:
    """``include_answer_key=False`` cevap anahtarı URL'ini çıktıdan düşürür.

    Dosya public-read bucket'ta durduğundan URL'i görmek = anahtarı indirmek
    demektir. Operatöre yalnız "anahtar yüklenmiş mi" bilgisi gider; gerçek
    bağlantı admin küratör listesinde kalır (oturum yayınlandıktan sonra
    öğrenciye ayrıca `library_exam_service` üzerinden açılır).
    """
    out = CatalogOut.model_validate(cat)
    out.has_answer_key_data = bool(cat.answer_key_data)
    out.has_answer_key = bool(cat.answer_key_url)
    if not include_answer_key:
        out.answer_key_url = None
    out.session_count = session_count
    return out


async def _session_counts(db: AsyncSession, catalog_ids: list[int]) -> dict[int, int]:
    if not catalog_ids:
        return {}
    rows = (
        await db.execute(
            select(LibraryExamSession.catalog_id, func.count())
            .where(
                LibraryExamSession.catalog_id.in_(catalog_ids),
                LibraryExamSession.deleted_at.is_(None),
            )
            .group_by(LibraryExamSession.catalog_id)
        )
    ).all()
    return {cid: c for cid, c in rows}


async def _get_or_404(db: AsyncSession, catalog_id: int) -> LibraryExamCatalog:
    cat = await db.get(LibraryExamCatalog, catalog_id)
    if cat is None or cat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Katalog bulunamadı")
    return cat


# ── Admin CRUD ───────────────────────────────────────────────────────────────────


async def list_catalogs(db: AsyncSession) -> list[CatalogOut]:
    cats = (
        await db.execute(
            select(LibraryExamCatalog)
            .where(LibraryExamCatalog.deleted_at.is_(None))
            .order_by(LibraryExamCatalog.created_at.desc())
        )
    ).scalars().all()
    counts = await _session_counts(db, [c.id for c in cats])
    return [_to_out(c, session_count=counts.get(c.id, 0)) for c in cats]


async def create_catalog(
    db: AsyncSession, admin: Admin, payload: CatalogCreate
) -> CatalogOut:
    cat = LibraryExamCatalog(
        exam_name=payload.exam_name.strip(),
        exam_type=payload.exam_type.strip().upper(),
        publisher_name=(payload.publisher_name or None),
        description=payload.description,
        question_count=payload.question_count,
        duration_minutes=payload.duration_minutes,
        is_public=payload.is_public,
        is_nationwide=payload.is_nationwide,
        created_by_admin_id=admin.id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return _to_out(cat)


async def update_catalog(
    db: AsyncSession, catalog_id: int, payload: CatalogUpdate
) -> CatalogOut:
    cat = await _get_or_404(db, catalog_id)
    data = payload.model_dump(exclude_unset=True)
    if "exam_name" in data and data["exam_name"]:
        cat.exam_name = data["exam_name"].strip()
    if "exam_type" in data and data["exam_type"]:
        cat.exam_type = data["exam_type"].strip().upper()
    for field in (
        "publisher_name",
        "description",
        "question_count",
        "duration_minutes",
        "is_public",
        "is_nationwide",
    ):
        if field in data:
            setattr(cat, field, data[field])
    await db.commit()
    await db.refresh(cat)
    counts = await _session_counts(db, [cat.id])
    return _to_out(cat, session_count=counts.get(cat.id, 0))


async def delete_catalog(db: AsyncSession, catalog_id: int) -> None:
    cat = await _get_or_404(db, catalog_id)
    cat.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()


async def set_answer_key(
    db: AsyncSession,
    catalog_id: int,
    *,
    file_bytes: bytes,
    original_name: str | None,
    content_type: str | None,
) -> CatalogOut:
    """Cevap anahtarı dosyasını (PDF/görsel) yükler, eskisini storage'dan temizler."""
    cat = await _get_or_404(db, catalog_id)
    old = cat.answer_key_url
    cat.answer_key_url = await storage.upload_file(
        file_bytes, original_name=original_name, content_type=content_type
    )
    await db.commit()
    await db.refresh(cat)
    if old:
        await storage.delete_file(old)
    counts = await _session_counts(db, [cat.id])
    return _to_out(cat, session_count=counts.get(cat.id, 0))


# ── Oturum oluştururken kullanılabilir kataloglar (admin / operatör) ─────────────


async def list_usable(
    db: AsyncSession, *, include_answer_key: bool = False
) -> list[CatalogOut]:
    """Oturum açarken seçilebilecek public kataloglar (operatör + admin).

    Varsayılan olarak cevap anahtarı URL'i DÖNMEZ — bu listeyi operatör de
    çeker ve anahtarın sızması denemenin bütünlüğünü bozar.
    """
    cats = (
        await db.execute(
            select(LibraryExamCatalog)
            .where(
                LibraryExamCatalog.deleted_at.is_(None),
                LibraryExamCatalog.is_public.is_(True),
            )
            .order_by(
                LibraryExamCatalog.is_nationwide.desc(),
                LibraryExamCatalog.created_at.desc(),
            )
        )
    ).scalars().all()
    counts = await _session_counts(db, [c.id for c in cats])
    return [
        _to_out(
            c,
            session_count=counts.get(c.id, 0),
            include_answer_key=include_answer_key,
        )
        for c in cats
    ]
