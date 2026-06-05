"""Kütüphane favorileme (bookmark) iş mantığı — tutor ``bookmark_service``'in
kütüphane kardeşi. Öğrenci bir kütüphaneyi favorileyip listeler."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.library import Library, LibraryStatus
from models.library_bookmark import LibraryBookmark
from schemas.library import LibrarySearchOut
from services import library_service


async def add(db: AsyncSession, client_id: int, library_id: int) -> None:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None or lib.status != LibraryStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    await db.execute(
        insert(LibraryBookmark)
        .values(client_id=client_id, library_id=library_id)
        .on_conflict_do_nothing(index_elements=["client_id", "library_id"])
    )


async def remove(db: AsyncSession, client_id: int, library_id: int) -> None:
    await db.execute(
        delete(LibraryBookmark).where(
            LibraryBookmark.client_id == client_id,
            LibraryBookmark.library_id == library_id,
        )
    )


async def list_for_client(
    db: AsyncSession, client_id: int, *, limit: int = 30, offset: int = 0
) -> list[LibrarySearchOut]:
    prior_mean = await library_service._compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    libs = (
        (
            await db.execute(
                select(Library)
                .join(LibraryBookmark, LibraryBookmark.library_id == Library.id)
                .options(
                    selectinload(Library.amenity_links),
                    selectinload(Library.hours),
                )
                .where(
                    LibraryBookmark.client_id == client_id,
                    Library.deleted_at.is_(None),
                )
                .order_by(LibraryBookmark.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    out: list[LibrarySearchOut] = []
    for lib in libs:
        item = library_service._to_search_out(
            lib,
            prior_mean,
            confidence,
            amenities=sorted(link.amenity for link in lib.amenity_links),
        )
        item.open_now = library_service._is_open_now(list(lib.hours))
        out.append(item)
    return out
