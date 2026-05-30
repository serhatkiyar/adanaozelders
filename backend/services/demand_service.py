from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client
from models.demand import Demand, DemandStatus
from schemas.demand import DemandCreate


async def create_demand(
    db: AsyncSession, client: Client, data: DemandCreate
) -> Demand:
    demand = Demand(client_id=client.id, **data.model_dump())
    db.add(demand)
    await db.flush()
    await db.refresh(demand)
    return demand


async def list_open_demands(
    db: AsyncSession, *, subject: str | None = None, limit: int = 20, offset: int = 0
) -> list[Demand]:
    stmt = select(Demand).where(
        Demand.status == DemandStatus.OPEN, Demand.deleted_at.is_(None)
    )
    if subject:
        stmt = stmt.where(Demand.subject.op("%")(subject))
    stmt = stmt.order_by(Demand.created_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def list_client_demands(
    db: AsyncSession, client: Client, *, limit: int = 20, offset: int = 0
) -> list[Demand]:
    stmt = (
        select(Demand)
        .where(Demand.client_id == client.id, Demand.deleted_at.is_(None))
        .order_by(Demand.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await db.execute(stmt)).scalars().all())


async def close_demand(db: AsyncSession, client: Client, demand_id: int) -> Demand:
    demand = await db.get(Demand, demand_id)
    if demand is None or demand.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demand not found")
    if demand.client_id != client.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your demand")
    if demand.status != DemandStatus.OPEN:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only OPEN demands can be closed"
        )
    demand.status = DemandStatus.CLOSED
    await db.flush()
    return demand
