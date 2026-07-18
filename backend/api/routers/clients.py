from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_roles_or_admin_permission
from core.database import get_db
from models.client import Client
from models.role import RoleType
from models.tutor import Gender
from schemas.education import EducationOut
from schemas.user import ClientPublicOut, ClientSearchOut
from services import booking_service, client_service, education_service

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("/search", response_model=list[ClientSearchOut])
async def search_clients(
    q: str | None = Query(default=None),
    gender: Gender | None = Query(default=None),
    min_age: int | None = Query(default=None, ge=0, le=120),
    max_age: int | None = Query(default=None, ge=0, le=120),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _viewer=Depends(require_roles_or_admin_permission("users.view", RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    return await client_service.search_clients(
        db,
        q=q,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        limit=limit,
        offset=offset,
    )


# Dinamik path; statik /search rotasından SONRA tanımlanmalı.
@router.get("/{client_id}", response_model=ClientPublicOut)
async def get_client_public(
    client_id: int,
    _viewer=Depends(require_roles_or_admin_permission("users.view", RoleType.TUTOR)),
    db: AsyncSession = Depends(get_db),
):
    client = await db.get(Client, client_id)
    if client is None or client.deleted_at is not None or not client.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")

    completed = await booking_service.count_completed(
        db, role_id=client.role_id, user_id=client.id
    )
    educations = await education_service.list_by(
        db, role_id=client.role_id, owner_id=client.id
    )
    return ClientPublicOut(
        id=client.id,
        full_name=client.full_name,
        username=client.username,
        about=client.about,
        avatar_url=client.avatar_url,
        birth_date=client.birth_date,
        gender=client.gender,
        created_at=client.created_at,
        last_seen_at=client.last_seen_at,
        completed_lessons=completed,
        educations=[EducationOut.model_validate(e) for e in educations],
    )
