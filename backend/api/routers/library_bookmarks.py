from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_shopping_client
from core.database import get_db
from models.client import Client
from schemas.library import LibrarySearchOut
from services import library_bookmark_service

# Alıcı kimliği `get_shopping_client`ten gelir (ÜK-6): eğitmen de ders
# verdiği kütüphaneyi favorileyebilir.
#
# Ayrı prefix (`/library-bookmarks`) — `/libraries/{id_or_slug}` route'u ile
# çakışmamak için kütüphane router'ından bağımsız tutulur (tutor /bookmarks deseni).
router = APIRouter(prefix="/library-bookmarks", tags=["library-bookmarks"])


@router.get("", response_model=list[LibrarySearchOut])
async def list_library_bookmarks(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    return await library_bookmark_service.list_for_client(
        db, client.id, limit=limit, offset=offset
    )


@router.put("/{library_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_library_bookmark(
    library_id: int,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    await library_bookmark_service.add(db, client.id, library_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{library_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_library_bookmark(
    library_id: int,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    await library_bookmark_service.remove(db, client.id, library_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
