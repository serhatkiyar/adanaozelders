"""Duyuru şeridi (İP-C2) testleri için gerçek veri fabrikası.

`supplier_factory.Fabrika` deseni: her satır gerçek tabloya yazılır, teardown
hepsini FİZİKSEL olarak geri alır. `duyuru_seridi` soft-delete taşımaz —
"sil" testte de gerçek DELETE demektir.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.duyuru import DuyuruSeridi


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class Fabrika:
    def __init__(self) -> None:
        self.duyuru_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def duyuru(
        self,
        *,
        metin: str | None = None,
        aktif: bool = True,
        baslangic_at: datetime.datetime | None = None,
        bitis_at: datetime.datetime | None = None,
        sira: int = 0,
        varyant: str = "bilgi",
        link_url: str | None = None,
        link_metni: str | None = None,
    ) -> int:
        async with AsyncSessionLocal() as s:
            k = DuyuruSeridi(
                metin=metin or f"duyuru {uniq()}",
                aktif=aktif,
                baslangic_at=baslangic_at,
                bitis_at=bitis_at,
                sira=sira,
                varyant=varyant,
                link_url=link_url,
                link_metni=link_metni,
            )
            s.add(k)
            await s.flush()
            kid = k.id
            await s.commit()
        self.duyuru_ids.append(kid)
        return kid

    async def admin(self, *, izinler: list[str] | None = None) -> int:
        """Admin satırı; `izinler` verilirse kendi rolüyle birlikte."""
        from models.admin import Admin
        from schemas.admin_access import AdminRoleCreate
        from services import admin_access_service

        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"duyuru-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Duyuru",
                last_name="Admin",
                username=f"da{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            aid = a.id
            if izinler is not None:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"DUY_{ek[:8].upper()}",
                        name="Duyuru Testi",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=aid, role_id=rol.id, assigned_by_admin_id=aid
                )
                self.role_ids.append(rol.id)
            await s.commit()
        self.admin_ids.append(aid)
        return aid

    async def admin_token(self, *, izinler: list[str]) -> str:
        from tests.integration.auth_headers import bearer_token

        aid = await self.admin(izinler=izinler)
        return await bearer_token(aid, role="ADMIN", role_id=1)

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.duyuru_ids:
                await s.execute(
                    text("DELETE FROM duyuru_seridi WHERE id = ANY(:ids)"),
                    {"ids": self.duyuru_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:ids)"),
                    {"ids": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_role_id = ANY(:ids)"),
                    {"ids": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:ids)"), {"ids": self.role_ids}
                )
            if self.admin_ids:
                # Admin CRUD uçları `audit_service.record` ile audit_logs'a
                # yazar (actor_role=1); admin satırı silinmeden ÖNCE bu
                # izler de temizlenmeli — yoksa hijyen nöbetçisi kalıcı satır
                # bulur (audit_logs FK'siz iz tutar, admin silinse de kalır).
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:ids) AND actor_role = 1"
                    ),
                    {"ids": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:ids)"), {"ids": self.admin_ids}
                )
            await s.commit()


@pytest.fixture
async def fab_duyuru(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()
