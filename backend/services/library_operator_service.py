"""Kütüphane operatörü (kütüphaneci) hesap yönetimi — admin küratörlüğünde.

Operatörler self-servis kaydolmaz; admin bir kütüphaneye operatör hesabı açar.
Hesap diğer kullanıcılar (admin/tutor/client) gibi ayrı tabloda (`library_operators`),
`role_id=4` (LIBRARY_OPERATOR). E-posta/kullanıcı adı tüm hesap türlerinde tekildir.
"""

from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password_async
from models.admin import Admin
from models.client import Client
from models.library import Library
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.library_operator import OperatorCreate, OperatorOut

_ALL_USER_MODELS = (Admin, Tutor, Client, LibraryOperator)


def _to_out(op: LibraryOperator, *, library_name: str | None = None) -> OperatorOut:
    out = OperatorOut.model_validate(op)
    out.library_name = library_name
    return out


async def _taken(db: AsyncSession, field: str, value: str) -> bool:
    for model in _ALL_USER_MODELS:
        col = getattr(model, field)
        stmt = select(model.id).where(col == value, model.deleted_at.is_(None))
        if (await db.execute(stmt)).first() is not None:
            return True
    return False


async def create_operator(
    db: AsyncSession, library_id: int, payload: OperatorCreate
) -> OperatorOut:
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")

    if await _taken(db, "email", payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu e-posta zaten kullanımda")

    operator = LibraryOperator(
        email=payload.email,
        hashed_password=await hash_password_async(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role_id=ROLE_IDS[RoleType.LIBRARY_OPERATOR],
        library_id=library_id,
        # Admin oluşturduğu için doğrulanmış kabul edilir.
        email_verified_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(operator)
    await db.commit()
    await db.refresh(operator)
    return _to_out(operator, library_name=lib.name)


async def list_operators(db: AsyncSession, library_id: int) -> list[OperatorOut]:
    stmt = (
        select(LibraryOperator)
        .where(
            LibraryOperator.library_id == library_id,
            LibraryOperator.deleted_at.is_(None),
        )
        .order_by(LibraryOperator.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(op) for op in rows]


async def delete_operator(db: AsyncSession, operator_id: int) -> None:
    op = await db.get(LibraryOperator, operator_id)
    if op is None or op.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operatör bulunamadı")
    op.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    op.is_active = False
    await db.commit()


async def whoami(db: AsyncSession, operator: LibraryOperator) -> OperatorOut:
    lib = await db.get(Library, operator.library_id)
    return _to_out(operator, library_name=lib.name if lib else None)
