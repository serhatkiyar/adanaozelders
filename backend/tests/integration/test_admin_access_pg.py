"""Görev bazlı admin yetkilerini gerçek PostgreSQL üzerinde doğrular."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate, AdminRoleUpdate
from services import admin_access_service


@pytest.mark.asyncio
async def test_admin_role_permissions_are_assigned_and_replaced(pg):
    suffix = uuid.uuid4().hex[:10]
    admin_id = role_id = 0
    try:
        async with AsyncSessionLocal() as session:
            admin = Admin(
                email=f"rbac-{suffix}@test.local",
                hashed_password="test-only",
                first_name="Yetki",
                last_name="Testi",
                username=f"rbac{suffix}",
                role_id=1,
            )
            session.add(admin)
            await session.flush()
            admin_id = admin.id
            role = await admin_access_service.create_role(
                session,
                AdminRoleCreate(
                    code=f"TEST_{suffix.upper()}",
                    name="Test Rolü",
                    permission_codes=["users.view", "reports.view"],
                ),
            )
            role_id = role.id
            await admin_access_service.assign_role(
                session,
                admin_id=admin.id,
                role_id=role.id,
                assigned_by_admin_id=admin.id,
            )
            await session.commit()

        async with AsyncSessionLocal() as session:
            role_code, permissions = await admin_access_service.get_admin_access(session, admin_id)
            assert role_code == f"TEST_{suffix.upper()}"
            assert permissions == {"users.view", "reports.view"}
            await admin_access_service.update_role(
                session,
                role_id,
                AdminRoleUpdate(
                    name="Güncel Test Rolü",
                    permission_codes=["audit.view"],
                ),
            )
            await session.commit()

        async with AsyncSessionLocal() as session:
            role_code, permissions = await admin_access_service.get_admin_access(session, admin_id)
            assert role_code == f"TEST_{suffix.upper()}"
            assert permissions == {"audit.view"}
            assignments = await admin_access_service.list_assignments(session)
            assert any(item.admin_id == admin_id and item.role_id == role_id for item in assignments)
    finally:
        async with AsyncSessionLocal() as session:
            if admin_id:
                await session.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = :admin_id"),
                    {"admin_id": admin_id},
                )
                await session.execute(text("DELETE FROM admins WHERE id = :id"), {"id": admin_id})
            if role_id:
                await session.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = :role_id"),
                    {"role_id": role_id},
                )
                await session.execute(text("DELETE FROM admin_roles WHERE id = :id"), {"id": role_id})
            await session.commit()
