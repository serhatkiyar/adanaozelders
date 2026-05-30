from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_approved_tutor, require_roles
from core.database import get_db
from models.client import Client
from models.role import RoleType
from schemas.demand import DemandCreate, DemandOut
from services import demand_service

router = APIRouter(prefix="/demands", tags=["demands"])


@router.post("", response_model=DemandOut, status_code=status.HTTP_201_CREATED)
async def create_demand(
    payload: DemandCreate,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await demand_service.create_demand(db, client, payload)


@router.get("/me", response_model=list[DemandOut])
async def my_demands(
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await demand_service.list_client_demands(
        db, client, limit=limit, offset=offset
    )


@router.get("", response_model=list[DemandOut])
async def browse_demands(
    subject: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _tutor=Depends(get_current_approved_tutor),
    db: AsyncSession = Depends(get_db),
):
    return await demand_service.list_open_demands(
        db, subject=subject, limit=limit, offset=offset
    )


@router.post("/{demand_id}/close", response_model=DemandOut)
async def close_demand(
    demand_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await demand_service.close_demand(db, client, demand_id)
