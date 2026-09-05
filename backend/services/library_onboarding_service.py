"""Self-servis kütüphane onboarding ('kütüphaneni listele') + admin onay/red.

Akış: operatör public formla kayıt olur → Library ``PENDING`` + operatör hesabı
oluşur (operatör giriş yapıp profilini tamamlar) → admin onaylar (``ACTIVE``,
public'te görünür) veya reddeder (``REJECTED`` + gerekçe). Public katalog/arama
yalnız ``ACTIVE`` gösterir (bkz. ``library_service.search_libraries``).
"""

from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password_async
from models.admin import Admin
from models.library import Library, LibraryStatus
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from schemas.library import LibraryDetailOut, LibraryRegister
from services import audit_service, notification_service
from services.library_service import (
    _compose_address,
    _slugify,
    _unique_slug,
    get_library_admin,
)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def register(db: AsyncSession, payload: LibraryRegister) -> LibraryOperator:
    """Operatör hesabı + PENDING kütüphaneyi birlikte oluşturur. Token üretimi
    router'da (login deseniyle) yapılır; burada yalnız domain kurulumu."""
    taken = (
        await db.execute(
            select(LibraryOperator.id).where(
                LibraryOperator.email == payload.email,
                LibraryOperator.deleted_at.is_(None),
            )
        )
    ).first()
    if taken is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu e-posta zaten kullanımda")

    lib = Library(
        name=payload.name,
        slug=await _unique_slug(db, _slugify(payload.name)),
        description=payload.description,
        phone=payload.phone,
        city=payload.city,
        district=payload.district,
        location_text=payload.location_text
        or _compose_address(None, None, None, payload.district, payload.city),
        location_lat=payload.location_lat,
        location_lng=payload.location_lng,
        status=LibraryStatus.PENDING.value,
    )
    db.add(lib)
    await db.flush()  # lib.id

    operator = LibraryOperator(
        email=payload.email,
        hashed_password=await hash_password_async(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role_id=ROLE_IDS[RoleType.LIBRARY_OPERATOR],
        library_id=lib.id,
    )
    db.add(operator)
    await db.commit()
    await db.refresh(operator)
    return operator


async def _notify_operators(db: AsyncSession, library_id: int, message: str) -> None:
    ops = (
        await db.execute(
            select(LibraryOperator).where(
                LibraryOperator.library_id == library_id,
                LibraryOperator.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    for op in ops:
        await notification_service.notify(
            db, user_id=op.id, role_id=op.role_id, message=message, link="/"
        )


async def approve(db: AsyncSession, admin: Admin, library_id: int) -> LibraryDetailOut:
    """Bekleyen başvuruyu onaylar → ACTIVE (public). Yalnız PENDING/REJECTED onaylanır."""
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    if lib.status not in (LibraryStatus.PENDING.value, LibraryStatus.REJECTED.value):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Yalnız onay bekleyen başvuru onaylanabilir"
        )
    lib.status = LibraryStatus.ACTIVE.value
    lib.rejection_reason = None
    await audit_service.record(
        db, actor=admin, action="library_approve", target_type="LIBRARY", target_id=lib.id
    )
    await _notify_operators(
        db, library_id, f"'{lib.name}' başvurun onaylandı; kütüphanen artık yayında. 🎉"
    )
    await db.commit()
    return await get_library_admin(db, lib.id)


async def reject(
    db: AsyncSession, admin: Admin, library_id: int, reason: str | None
) -> LibraryDetailOut:
    """Bekleyen başvuruyu reddeder → REJECTED + gerekçe. Operatör panelinde gösterilir."""
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    if lib.status != LibraryStatus.PENDING.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Yalnız onay bekleyen başvuru reddedilebilir"
        )
    lib.status = LibraryStatus.REJECTED.value
    lib.rejection_reason = reason
    await audit_service.record(
        db,
        actor=admin,
        action="library_reject",
        target_type="LIBRARY",
        target_id=lib.id,
        details=reason,
        reason=reason,
    )
    msg = f"'{lib.name}' başvurun reddedildi." + (f" Gerekçe: {reason}" if reason else "")
    await _notify_operators(db, library_id, msg)
    await db.commit()
    return await get_library_admin(db, lib.id)


async def resubmit(db: AsyncSession, library_id: int) -> LibraryDetailOut:
    """Operatör reddedilen başvurusunu düzeltip tekrar gönderir → PENDING (kuyruğa döner).
    Yalnız REJECTED durumundan; gerekçe temizlenir."""
    lib = await db.get(Library, library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    if lib.status != LibraryStatus.REJECTED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Yalnız reddedilmiş başvuru tekrar gönderilebilir"
        )
    lib.status = LibraryStatus.PENDING.value
    lib.rejection_reason = None
    await db.commit()
    return await get_library_admin(db, lib.id)
