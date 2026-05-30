from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import hash_password
from models.admin import Admin
from models.role import ROLE_IDS, Role, RoleType


async def seed_roles(session: AsyncSession) -> None:
    for role_type, role_id in ROLE_IDS.items():
        if await session.get(Role, role_id) is None:
            session.add(Role(id=role_id, name=role_type))


async def seed_admin(session: AsyncSession) -> None:
    if not (settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
        return
    stmt = select(Admin.id).where(
        Admin.email == settings.ADMIN_EMAIL, Admin.deleted_at.is_(None)
    )
    if (await session.execute(stmt)).first() is not None:
        return
    parts = settings.ADMIN_FULL_NAME.split(" ", 1)
    first_name = parts[0] or "System"
    last_name = parts[1] if len(parts) > 1 else "Admin"
    username = settings.ADMIN_EMAIL.split("@", 1)[0] or "admin"
    session.add(
        Admin(
            email=settings.ADMIN_EMAIL,
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            first_name=first_name,
            last_name=last_name,
            username=username,
            role_id=ROLE_IDS[RoleType.ADMIN],
        )
    )
