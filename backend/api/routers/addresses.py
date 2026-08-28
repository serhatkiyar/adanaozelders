from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_shopping_client
from core.database import get_db
from models.client import Client
from schemas.address import AddressCreate, AddressOut, AddressUpdate
from services import address_service

router = APIRouter(prefix="/me/addresses", tags=["addresses"])


@router.get("", response_model=list[AddressOut])
async def list_my_addresses(
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    return await address_service.list_own(db, client)


@router.post("", response_model=AddressOut, status_code=status.HTTP_201_CREATED)
async def add_address(
    payload: AddressCreate,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    return await address_service.create(db, client, payload)


@router.patch("/{address_id}", response_model=AddressOut)
async def edit_address(
    address_id: int,
    payload: AddressUpdate,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    return await address_service.update(db, client, address_id, payload)


@router.delete("/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_address(
    address_id: int,
    client: Client = Depends(get_shopping_client),
    db: AsyncSession = Depends(get_db),
):
    await address_service.delete(db, client, address_id)
