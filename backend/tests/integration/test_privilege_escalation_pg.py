"""Yetki yükselmesi engelleri — GERÇEK PostgreSQL.

Bağımsız güvenlik denetiminin bulgusu: `admin_roles.manage` iznine sahip bir
yönetici, `permission_codes` alanı serbest olduğu için **kendisinde olmayan**
izinleri (`settings.manage` → ödeme kolu açma) içeren yeni bir rol yaratıp onu
**kendine** atayabiliyordu. Migration'ın "settings.manage yalnız SUPER_ADMIN'e
verilir" iddiası bu yolla çürütülüyordu.

İki bağımsız engel test edilir; biri atlatılsa diğeri tutar:
  1. Aktör, sahip olmadığı izni bir role VEREMEZ (`assert_can_grant`).
  2. Aktör, kendi izinlerini AŞAN bir rolü kimseye atayamaz (`assert_can_assign`)
     — saldırganın rol yaratmasına gerek yok, `SUPER_ADMIN` zaten var.

"Kendine atama yasak" kuralı bilinçli olarak KULLANILMADI: mevcut meşru
bootstrap akışını kırıyor ve tek yöneticili bir kurulumda kilitlenme riski
üretiyor. Tehlikeli olan "kime" değil "hangi rolü" atadığıdır.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service


async def _mk_admin(s, suffix: str) -> Admin:
    admin = Admin(
        email=f"esc-{suffix}@test.local",
        hashed_password="test-only",
        first_name="Yetki",
        last_name="Denemesi",
        role_id=1,
    )
    s.add(admin)
    await s.flush()
    return admin


async def _cleanup(admin_ids: list[int], role_codes: list[str]) -> None:
    async with AsyncSessionLocal() as s:
        if role_codes:
            await s.execute(
                text(
                    """
                    DELETE FROM admin_role_permissions WHERE admin_role_id IN (
                        SELECT id FROM admin_roles WHERE code = ANY(:c))
                    """
                ),
                {"c": role_codes},
            )
            await s.execute(
                text(
                    """
                    DELETE FROM admin_role_assignments WHERE admin_role_id IN (
                        SELECT id FROM admin_roles WHERE code = ANY(:c))
                    """
                ),
                {"c": role_codes},
            )
            await s.execute(
                text("DELETE FROM admin_roles WHERE code = ANY(:c)"), {"c": role_codes}
            )
        if admin_ids:
            await s.execute(
                text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                {"a": admin_ids},
            )
            await s.execute(text("DELETE FROM admins WHERE id = ANY(:a)"), {"a": admin_ids})
        await s.commit()


@pytest.mark.asyncio
async def test_sahip_olmadigi_izni_role_VEREMEZ(pg):
    suffix = uuid.uuid4().hex[:8]
    kisitli_kod = f"KISITLI_{suffix.upper()}"
    admin_id = 0
    try:
        async with AsyncSessionLocal() as s:
            admin = await _mk_admin(s, suffix)
            admin_id = admin.id
            # Aktöre yalnız rol yönetimi izni ver (settings.manage YOK).
            role = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=kisitli_kod,
                    name="Kısıtlı rol yöneticisi",
                    permission_codes=["admin_roles.view", "admin_roles.manage"],
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=admin.id, role_id=role.id, assigned_by_admin_id=admin.id
            )
            await s.commit()

        async with AsyncSessionLocal() as s:
            # Kendisinde olmayan `settings.manage`'i vermeye çalışsın.
            with pytest.raises(HTTPException) as exc:
                await admin_access_service.assert_can_grant(
                    db=s,
                    actor_admin_id=admin_id,
                    permission_codes=["settings.view", "settings.manage"],
                )
            assert exc.value.status_code == 403
            assert exc.value.detail["code"] == "PRIVILEGE_ESCALATION_BLOCKED"

            # Sahip olduğu izni vermek serbest.
            await admin_access_service.assert_can_grant(
                db=s, actor_admin_id=admin_id, permission_codes=["admin_roles.view"]
            )
    finally:
        await _cleanup([admin_id] if admin_id else [], [kisitli_kod])


@pytest.mark.asyncio
async def test_yetkisini_asan_rol_ATANAMAZ(pg):
    """Asıl istismar yolu: saldırganın rol yaratmasına gerek yok — `SUPER_ADMIN`
    rolü zaten var ve `admin_roles.manage` sahibi onu kendine atayabilirdi.

    Kural "kendine atama yasak" DEĞİL (o, meşru bootstrap akışını kırıyor ve tek
    yöneticili kurulumda kilitlenme riski üretiyor); kural "kendi izinlerini aşan
    rolü kimseye atayamaz".
    """
    suffix = uuid.uuid4().hex[:8]
    kisitli_kod = f"KISITLI_{suffix.upper()}"
    admin_id = 0
    try:
        async with AsyncSessionLocal() as s:
            admin = await _mk_admin(s, suffix)
            admin_id = admin.id
            kisitli = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=kisitli_kod,
                    name="Kısıtlı rol yöneticisi",
                    permission_codes=["admin_roles.view", "admin_roles.manage"],
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=admin.id, role_id=kisitli.id, assigned_by_admin_id=admin.id
            )
            await s.commit()

        async with AsyncSessionLocal() as s:
            super_role_id = (
                await s.execute(
                    text("SELECT id FROM admin_roles WHERE code = 'SUPER_ADMIN'")
                )
            ).scalar()
            assert super_role_id, "SUPER_ADMIN rolü seed edilmemiş"

            with pytest.raises(HTTPException) as exc:
                await admin_access_service.assert_can_assign(
                    s, actor_admin_id=admin_id, role_id=super_role_id
                )
            assert exc.value.detail["code"] == "PRIVILEGE_ESCALATION_BLOCKED"

            # Kendi izin kümesine eşit bir rolü atamak serbest.
            kisitli_id = (
                await s.execute(
                    text("SELECT id FROM admin_roles WHERE code = :c"),
                    {"c": kisitli_kod},
                )
            ).scalar()
            await admin_access_service.assert_can_assign(
                s, actor_admin_id=admin_id, role_id=kisitli_id
            )
    finally:
        await _cleanup([admin_id] if admin_id else [], [kisitli_kod])


@pytest.mark.asyncio
async def test_super_admin_kisitlanmaz(pg):
    """SUPER_ADMIN tüm izinlere sahiptir; kural onu engellemez."""
    async with AsyncSessionLocal() as s:
        row = await s.execute(
            text(
                """
                SELECT a.id FROM admins a
                JOIN admin_role_assignments ra
                  ON ra.admin_id = a.id AND ra.deleted_at IS NULL
                JOIN admin_roles r ON r.id = ra.admin_role_id
                WHERE r.code = 'SUPER_ADMIN' AND a.deleted_at IS NULL
                LIMIT 1
                """
            )
        )
        super_id = row.scalar()
        if super_id is None:
            pytest.skip("SUPER_ADMIN atanmış yönetici yok")
        await admin_access_service.assert_can_grant(
            db=s, actor_admin_id=super_id, permission_codes=["settings.manage"]
        )
