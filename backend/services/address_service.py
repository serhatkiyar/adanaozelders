from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from models.client import Client, ClientAddress
from schemas.address import AddressCreate, AddressUpdate


async def list_own(db: AsyncSession, client: Client) -> list[ClientAddress]:
    stmt = (
        select(ClientAddress)
        .where(
            ClientAddress.client_id == client.id,
            ClientAddress.deleted_at.is_(None),
        )
        .order_by(ClientAddress.is_default.desc(), ClientAddress.id.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def _get_owned_or_404(
    db: AsyncSession, client: Client, address_id: int
) -> ClientAddress:
    addr = await db.get(ClientAddress, address_id)
    if addr is None or addr.deleted_at is not None or addr.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Address not found")
    return addr


async def _clear_other_defaults(
    db: AsyncSession, client_id: int, *, except_id: int | None = None
) -> None:
    stmt = (
        sa_update(ClientAddress)
        .where(
            ClientAddress.client_id == client_id,
            ClientAddress.deleted_at.is_(None),
            ClientAddress.is_default.is_(True),
        )
        .values(is_default=False)
    )
    if except_id is not None:
        stmt = stmt.where(ClientAddress.id != except_id)
    await db.execute(stmt)


async def create(
    db: AsyncSession, client: Client, data: AddressCreate
) -> ClientAddress:
    addr = ClientAddress(client_id=client.id, **data.model_dump())
    if addr.is_default:
        await _clear_other_defaults(db, client.id)
    db.add(addr)
    await db.flush()
    await db.refresh(addr)
    return addr


async def update(
    db: AsyncSession, client: Client, address_id: int, data: AddressUpdate
) -> ClientAddress:
    addr = await _get_owned_or_404(db, client, address_id)
    payload = data.model_dump(exclude_unset=True)
    if payload.get("is_default") is True:
        await _clear_other_defaults(db, client.id, except_id=addr.id)
    for field, value in payload.items():
        setattr(addr, field, value)
    await db.flush()
    await db.refresh(addr)
    return addr


async def delete(db: AsyncSession, client: Client, address_id: int) -> None:
    addr = await _get_owned_or_404(db, client, address_id)
    addr.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
