from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.admin import Admin
from models.admin_access import (
    AdminPermission,
    AdminRole,
    AdminRoleAssignment,
    AdminRolePermission,
)
from schemas.admin_access import (
    AdminPermissionOut,
    AdminRoleAssignmentOut,
    AdminRoleCreate,
    AdminRoleOut,
    AdminRoleUpdate,
)


async def get_admin_access(db: AsyncSession, admin_id: int) -> tuple[str | None, set[str]]:
    rows = (
        await db.execute(
            select(AdminRole.code, AdminPermission.code)
            .join(AdminRoleAssignment, AdminRoleAssignment.admin_role_id == AdminRole.id)
            .join(AdminRolePermission, AdminRolePermission.admin_role_id == AdminRole.id)
            .join(AdminPermission, AdminPermission.id == AdminRolePermission.permission_id)
            .where(
                AdminRoleAssignment.admin_id == admin_id,
                AdminRoleAssignment.deleted_at.is_(None),
                AdminRole.deleted_at.is_(None),
                AdminRolePermission.deleted_at.is_(None),
                AdminPermission.deleted_at.is_(None),
            )
        )
    ).all()
    if not rows:
        role_code = await db.scalar(
            select(AdminRole.code)
            .join(AdminRoleAssignment, AdminRoleAssignment.admin_role_id == AdminRole.id)
            .where(
                AdminRoleAssignment.admin_id == admin_id,
                AdminRoleAssignment.deleted_at.is_(None),
                AdminRole.deleted_at.is_(None),
            )
        )
        return role_code, set()
    return rows[0][0], {permission_code for _role_code, permission_code in rows}


async def list_permissions(db: AsyncSession) -> list[AdminPermissionOut]:
    permissions = list(
        (
            await db.execute(
                select(AdminPermission)
                .where(AdminPermission.deleted_at.is_(None))
                .order_by(AdminPermission.group, AdminPermission.name)
            )
        ).scalars()
    )
    return [AdminPermissionOut.model_validate(item, from_attributes=True) for item in permissions]


async def list_roles(db: AsyncSession) -> list[AdminRoleOut]:
    roles = list(
        (
            await db.execute(
                select(AdminRole)
                .where(AdminRole.deleted_at.is_(None))
                .order_by(AdminRole.is_system.desc(), AdminRole.name)
            )
        ).scalars()
    )
    result: list[AdminRoleOut] = []
    for role in roles:
        permission_codes = list(
            (
                await db.execute(
                    select(AdminPermission.code)
                    .join(AdminRolePermission, AdminRolePermission.permission_id == AdminPermission.id)
                    .where(
                        AdminRolePermission.admin_role_id == role.id,
                        AdminRolePermission.deleted_at.is_(None),
                        AdminPermission.deleted_at.is_(None),
                    )
                    .order_by(AdminPermission.code)
                )
            ).scalars()
        )
        assignment_count = int(
            (
                await db.scalar(
                    select(func.count())
                    .select_from(AdminRoleAssignment)
                    .where(
                        AdminRoleAssignment.admin_role_id == role.id,
                        AdminRoleAssignment.deleted_at.is_(None),
                    )
                )
            )
            or 0
        )
        result.append(
            AdminRoleOut(
                id=role.id,
                code=role.code,
                name=role.name,
                description=role.description,
                is_system=role.is_system,
                permission_codes=permission_codes,
                assignment_count=assignment_count,
            )
        )
    return result


async def list_assignments(db: AsyncSession) -> list[AdminRoleAssignmentOut]:
    rows = (
        await db.execute(
            select(Admin, AdminRole)
            .outerjoin(
                AdminRoleAssignment,
                (AdminRoleAssignment.admin_id == Admin.id)
                & AdminRoleAssignment.deleted_at.is_(None),
            )
            .outerjoin(AdminRole, AdminRole.id == AdminRoleAssignment.admin_role_id)
            .where(Admin.deleted_at.is_(None))
            .order_by(Admin.full_name)
        )
    ).all()
    return [
        AdminRoleAssignmentOut(
            admin_id=admin.id,
            admin_name=admin.full_name,
            admin_email=admin.email,
            role_id=role.id if role else None,
            role_code=role.code if role else None,
            role_name=role.name if role else None,
        )
        for admin, role in rows
    ]


async def _permission_ids(db: AsyncSession, codes: list[str]) -> list[int]:
    unique_codes = set(codes)
    rows = (
        await db.execute(
            select(AdminPermission.id, AdminPermission.code).where(
                AdminPermission.code.in_(unique_codes),
                AdminPermission.deleted_at.is_(None),
            )
        )
    ).all()
    found = {code for _id, code in rows}
    missing = sorted(unique_codes - found)
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown permissions: {', '.join(missing)}")
    return [permission_id for permission_id, _code in rows]


async def assert_can_grant(
    db: AsyncSession, *, actor_admin_id: int, permission_codes: list[str]
) -> None:
    """No-privilege-escalation: aktör, **kendisinde olmayan** bir izni bir role
    veremez.

    Bağımsız güvenlik denetiminin bulgusu: `admin_roles.manage` iznine sahip bir
    yönetici, `permission_codes` alanı serbest olduğu için kendine
    `settings.manage` içeren yeni bir rol yaratıp atayabiliyordu — yani ödeme
    kolu açma yetkisini kendi kendine verebiliyordu. Bugün ikinci kapı bileşeni
    (`supports_marketplace`) tuttuğu için para açılmıyor; PK-2'den sonra tek
    kapı bu bayrak olacak.

    SUPER_ADMIN tüm izinlere sahip olduğundan bu kural onu kısıtlamaz.
    """
    _role_code, actor_permissions = await get_admin_access(db, actor_admin_id)
    if _role_code == "SUPER_ADMIN":
        return
    fazla = sorted(set(permission_codes) - set(actor_permissions))
    if fazla:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "PRIVILEGE_ESCALATION_BLOCKED",
                "message": (
                    "Kendinizde bulunmayan izinleri bir role veremezsiniz: "
                    + ", ".join(fazla)
                ),
            },
        )


async def create_role(db: AsyncSession, payload: AdminRoleCreate) -> AdminRole:
    existing = await db.scalar(
        select(AdminRole.id).where(AdminRole.code == payload.code, AdminRole.deleted_at.is_(None))
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Role code already exists")
    permission_ids = await _permission_ids(db, payload.permission_codes)
    role = AdminRole(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        is_system=False,
    )
    db.add(role)
    await db.flush()
    db.add_all(
        [AdminRolePermission(admin_role_id=role.id, permission_id=permission_id) for permission_id in permission_ids]
    )
    await db.flush()
    return role


async def update_role(db: AsyncSession, role_id: int, payload: AdminRoleUpdate) -> AdminRole:
    role = await db.get(AdminRole, role_id, with_for_update=True)
    if role is None or role.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin role not found")
    if role.code == "SUPER_ADMIN":
        raise HTTPException(status.HTTP_409_CONFLICT, "SUPER_ADMIN permissions cannot be changed")
    permission_ids = await _permission_ids(db, payload.permission_codes)
    role.name = payload.name
    role.description = payload.description
    now = datetime.datetime.now(datetime.timezone.utc)
    existing = list(
        (
            await db.execute(
                select(AdminRolePermission).where(
                    AdminRolePermission.admin_role_id == role.id,
                    AdminRolePermission.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    for link in existing:
        link.deleted_at = now
    await db.flush()
    db.add_all(
        [AdminRolePermission(admin_role_id=role.id, permission_id=permission_id) for permission_id in permission_ids]
    )
    await db.flush()
    return role


async def assert_can_assign(
    db: AsyncSession, *, actor_admin_id: int, role_id: int
) -> None:
    """Aktör, **kendi izinlerini aşan** bir rolü kimseye (kendisi dahil) atayamaz.

    `assert_can_grant` yeni rol yaratma yolunu kapatıyor, ama tek başına
    yetmiyordu: saldırganın rol yaratmasına gerek yok — `SUPER_ADMIN` rolü zaten
    var ve `admin_roles.manage` sahibi onu kendine atayabilirdi.

    Neden "kendine atama yasak" değil: o kural mevcut meşru bootstrap akışını
    kırıyor ve tek yöneticili bir kurulumda kilitlenme riski üretiyor. Asıl
    tehlike "kime" değil "hangi rolü" atadığıdır.

    Bilinçli olarak yalnız ROUTER'dan çağrılır: servis katmanı testleri ve
    migration/backfill yolları sentetik aktör kimlikleriyle çalışır.
    """
    actor_role, actor_permissions = await get_admin_access(db, actor_admin_id)
    if actor_role == "SUPER_ADMIN":
        return
    codes = set(
        (
            await db.execute(
                select(AdminPermission.code)
                .join(
                    AdminRolePermission,
                    AdminRolePermission.permission_id == AdminPermission.id,
                )
                .where(
                    AdminRolePermission.admin_role_id == role_id,
                    AdminRolePermission.deleted_at.is_(None),
                    AdminPermission.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    fazla = sorted(codes - set(actor_permissions))
    if fazla:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {
                "code": "PRIVILEGE_ESCALATION_BLOCKED",
                "message": (
                    "Kendi yetkinizi aşan bir rol atayamazsınız; fazla izinler: "
                    + ", ".join(fazla)
                ),
            },
        )


async def assign_role(
    db: AsyncSession, *, admin_id: int, role_id: int, assigned_by_admin_id: int
) -> None:
    target = await db.get(Admin, admin_id, with_for_update=True)
    role = await db.get(AdminRole, role_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin not found")
    if role is None or role.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin role not found")
    current = await db.scalar(
        select(AdminRoleAssignment).where(
            AdminRoleAssignment.admin_id == admin_id,
            AdminRoleAssignment.deleted_at.is_(None),
        )
    )
    if current and current.admin_role_id == role_id:
        return
    if current:
        current_role_code = await db.scalar(select(AdminRole.code).where(AdminRole.id == current.admin_role_id))
        if current_role_code == "SUPER_ADMIN" and role.code != "SUPER_ADMIN":
            # Eşzamanlı indirmeleri sıraya al; iki istek birden son Super Admin'i silemez.
            await db.scalar(
                select(AdminRole.id)
                .where(AdminRole.code == "SUPER_ADMIN", AdminRole.deleted_at.is_(None))
                .with_for_update()
            )
            super_count = int(
                (
                    await db.scalar(
                        select(func.count())
                        .select_from(AdminRoleAssignment)
                        .join(AdminRole, AdminRole.id == AdminRoleAssignment.admin_role_id)
                        .join(Admin, Admin.id == AdminRoleAssignment.admin_id)
                        .where(
                            AdminRole.code == "SUPER_ADMIN",
                            AdminRoleAssignment.deleted_at.is_(None),
                            Admin.deleted_at.is_(None),
                            Admin.is_active.is_(True),
                        )
                    )
                )
                or 0
            )
            if super_count <= 1:
                raise HTTPException(status.HTTP_409_CONFLICT, "The last SUPER_ADMIN cannot be demoted")
        current.deleted_at = datetime.datetime.now(datetime.timezone.utc)
        await db.flush()
    db.add(
        AdminRoleAssignment(
            admin_id=admin_id,
            admin_role_id=role_id,
            assigned_by_admin_id=assigned_by_admin_id,
        )
    )
    await db.flush()
