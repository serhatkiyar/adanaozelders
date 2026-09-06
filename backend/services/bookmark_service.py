from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.bookmark import Bookmark
from models.client import Client
from models.tutor import Tutor, TutorStatus
from schemas.tutor import TutorSearchOut
from services.ranking import compute_global_mean
from services.search_service import _to_search_out


async def add(db: AsyncSession, client: Client, tutor_id: int) -> None:
    """Favoriye ekler. `client` GÖLGE olabilir (ÜK-6).

    Nesne alınmasının sebebi self-favori kapısı: gölgenin
    `shadow_of_tutor_id` alanı eğitmenin kimliğini zaten taşıyor, ek sorgu
    gerekmiyor. Kapı serviste durur ki ikinci bir çağrı yeri onu atlayamasın.
    """
    tutor = await db.get(Tutor, tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or tutor.status != TutorStatus.APPROVED
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tutor not found")
    if client.shadow_of_tutor_id == tutor_id:
        # Self-dealing kuralının favori karşılığı: favori hem sıralama sinyali
        # hem "kaç kişi favoriledi" sayısıdır; eğitmen kendi ilanını
        # favorileyerek onu şişiremez.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Kendi ilanınızı favorileyemezsiniz"
        )
    await db.execute(
        insert(Bookmark)
        .values(client_id=client.id, tutor_id=tutor_id)
        .on_conflict_do_nothing(index_elements=["client_id", "tutor_id"])
    )


async def remove(db: AsyncSession, client_id: int, tutor_id: int) -> None:
    await db.execute(
        delete(Bookmark).where(
            Bookmark.client_id == client_id, Bookmark.tutor_id == tutor_id
        )
    )


async def list_for_client(
    db: AsyncSession, client_id: int, *, limit: int = 20, offset: int = 0
) -> list[TutorSearchOut]:
    prior_mean = await compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    tutors = (
        (
            await db.execute(
                select(Tutor)
                .join(Bookmark, Bookmark.tutor_id == Tutor.id)
                .where(Bookmark.client_id == client_id, Tutor.deleted_at.is_(None))
                .order_by(Bookmark.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return [_to_search_out(tutor, prior_mean, confidence) for tutor in tutors]
