from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_approved_tutor, require_roles, user_rate_limit
from core.config import settings
from core.database import get_db
from models.client import Client
from models.role import RoleType
from models.tutor import Tutor, TutorSubject
from schemas.demand import (
    DemandCreate,
    DemandOut,
    DemandRespondResult,
    DemandResponseCreate,
    DemandResponseOut,
)
from services import demand_service

router = APIRouter(prefix="/demands", tags=["demands"])

_create_limit = user_rate_limit(
    key="demand_create",
    limit=settings.RATE_LIMIT_DEMAND,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
_respond_limit = user_rate_limit(
    key="demand_respond",
    limit=settings.RATE_LIMIT_DEMAND,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.post(
    "",
    response_model=DemandOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_create_limit)],
)
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
    mine: bool = Query(default=False, description="Yalnız öğretmenin branşlarına uyan talepler"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    tutor: Tutor = Depends(get_current_approved_tutor),
    db: AsyncSession = Depends(get_db),
):
    subjects: list[str] | None = None
    if mine:
        subjects = list(
            (
                await db.execute(
                    select(TutorSubject.subject).where(
                        TutorSubject.tutor_id == tutor.id
                    )
                )
            ).scalars()
        )
    return await demand_service.list_open_demands(
        db, tutor=tutor, subjects=subjects, subject=subject, limit=limit, offset=offset
    )


@router.post(
    "/{demand_id}/respond",
    response_model=DemandRespondResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_respond_limit)],
)
async def respond_demand(
    demand_id: int,
    payload: DemandResponseCreate,
    tutor: Tutor = Depends(get_current_approved_tutor),
    db: AsyncSession = Depends(get_db),
):
    """Eğitmen açık talebe yanıt verir → öğrenciyle sohbet açılır (ilk mesaj eğitmenden)."""
    result = await demand_service.respond_to_demand(
        db, tutor, demand_id, payload.body
    )
    return DemandRespondResult(**result)


@router.get("/{demand_id}/responses", response_model=list[DemandResponseOut])
async def demand_responses(
    demand_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    """Öğrencinin kendi talebine yanıt veren eğitmenler (sohbete köprü)."""
    rows = await demand_service.list_responses(db, client, demand_id)
    return [DemandResponseOut(**r) for r in rows]


@router.post("/{demand_id}/close", response_model=DemandOut)
async def close_demand(
    demand_id: int,
    client: Client = Depends(require_roles(RoleType.CLIENT)),
    db: AsyncSession = Depends(get_db),
):
    return await demand_service.close_demand(db, client, demand_id)
