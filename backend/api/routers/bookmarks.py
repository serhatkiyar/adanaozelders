from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles
from core.database import get_db
from models.client import Client
from models.role import RoleType
from schemas.tutor import TutorSearchOut
from services import bookmark_service

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


@router.put("/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_bookmark(
    tutor_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await bookmark_service.add(db, client.id, tutor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{tutor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bookmark(
    tutor_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    await bookmark_service.remove(db, client.id, tutor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[TutorSearchOut])
async def list_bookmarks(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await bookmark_service.list_for_client(
        db, client.id, limit=limit, offset=offset
    )
