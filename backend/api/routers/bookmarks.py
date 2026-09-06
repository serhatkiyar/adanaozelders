"""Eğitmen favorileme uçları.

Alıcı kimliği `get_shopping_client`ten gelir (ÜK-6 · docs/urun-kararlari.md):
CLIENT kendisi, TUTOR bağlı gölge satırı. Aşağı akış HİÇ DEĞİŞMEZ — favori
satırı yine `clients.id`e yazılır.

Ad notu: `get_shopping_client` artık yalnız mağazayı değil favorileri de
taşıyor; adı eksik kalıyor. Yeniden adlandırma ~25 çağrı yerini ve sözleşme
maddelerini etkilediği için ayrı bir tura bırakıldı.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_shopping_client
from core.database import get_db
from models.client import Client
from schemas.tutor import TutorSearchOut
from services import bookmark_service

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


@router.put("/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_bookmark(
    tutor_id: int,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    await bookmark_service.add(db, client, tutor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bookmark(
    tutor_id: int,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    await bookmark_service.remove(db, client.id, tutor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[TutorSearchOut])
async def list_bookmarks(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    return await bookmark_service.list_for_client(
        db, client.id, limit=limit, offset=offset
    )
