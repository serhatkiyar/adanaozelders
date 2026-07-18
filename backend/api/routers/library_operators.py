from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission, require_roles
from core.database import get_db
from models.admin import Admin
from models.library_operator import LibraryOperator
from models.role import RoleType
from schemas.library_operator import OperatorCreate, OperatorOut
from services import library_operator_service

router = APIRouter(tags=["library-operators"])


# ── Admin: bir kütüphaneye operatör hesabı yönetimi ──────────────────────────────


@router.post(
    "/libraries/{library_id}/operators",
    response_model=OperatorOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_operator(
    library_id: int,
    payload: OperatorCreate,
    _admin: Admin = Depends(require_admin_permission("libraries.manage")),
    db: AsyncSession = Depends(get_db),
):
    return await library_operator_service.create_operator(db, library_id, payload)


@router.get(
    "/libraries/{library_id}/operators", response_model=list[OperatorOut]
)
async def list_operators(
    library_id: int,
    _admin: Admin = Depends(require_admin_permission("libraries.view")),
    db: AsyncSession = Depends(get_db),
):
    return await library_operator_service.list_operators(db, library_id)


@router.delete(
    "/library-operators/{operator_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_operator(
    operator_id: int,
    _admin: Admin = Depends(require_admin_permission("libraries.manage")),
    db: AsyncSession = Depends(get_db),
):
    await library_operator_service.delete_operator(db, operator_id)


# ── Operatör: kendi bilgisi (hangi kütüphane) ────────────────────────────────────


@router.get("/library-operators/me", response_model=OperatorOut)
async def operator_me(
    operator: LibraryOperator = Depends(require_roles(RoleType.LIBRARY_OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    return await library_operator_service.whoami(db, operator)
