"""Mağaza yönetimi entegrasyon testleri için gerçek admin/rol fabrikası.

Manuel vitrin kararı (28 Ağu 2026) sonrası fabrika sadeleşti: landing sayfası
üretimi söküldü (o uçlar yok). Kalan iş, GERÇEK admin + rol/izin satırları +
imzalı JWT üretmek — blog ve öznitelik/medya entegrasyon testleri bunu
kullanır; izin kararı `require_admin_permission` ile gerçek satırlardan
çözülür, dependency override yoktur.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service
from tests.integration.auth_headers import bearer_headers


@pytest.fixture
async def fabv(pg):
    f = VitrinFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt: datetime.datetime) -> str:
    return dt.isoformat()


class VitrinFabrikasi:
    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.attribute_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları + gerçek imzalı JWT."""
        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"vitrin-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Vitrin",
                last_name="Admin",
                username=f"va{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"VITRIN_{ek.upper()}",
                        name="Vitrin Test Rolü",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
                )
                self.role_ids.append(rol.id)
            await s.commit()
            self.admin_ids.append(a.id)
            admin_id = a.id
        return admin_id, await bearer_headers(admin_id, role="ADMIN", role_id=1)

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.attribute_ids:
                await s.execute(
                    text("DELETE FROM product_attribute_values WHERE definition_id = ANY(:a)"),
                    {"a": self.attribute_ids},
                )
                await s.execute(
                    text("DELETE FROM product_attribute_definitions WHERE id = ANY(:a)"),
                    {"a": self.attribute_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE actor_role = 1 AND actor_id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_role_id = ANY(:r)"),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:r)"),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:r)"),
                    {"r": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            await s.commit()
