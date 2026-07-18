"""Kurye giriş hesabı yaşam döngüsü + saha erişim guard'ları (rol 5).

LibraryOperator deseninin teslimata uyarlanmışı. Kritik fark ``auth_version``:
hesap kapatma/şifre sıfırlama sürümü artırır → kuryenin telefonundaki access
token ANINDA ölür (deps.get_current_user sürüm eşleşmesini kontrol eder) ve tüm
refresh token'ları toplu revoke edilir. Yeniden işe alım ESKİ hesabı diriltmez;
yeni satır açılır (eski token hiçbir koşulda canlanamaz).

IDOR: kurye yalnız KENDİ atanmış turunun verisini görür; yabancı tur/durak/QR
için 404 döner (403 değil — varlık bilgisi bile sızmaz).
"""
from __future__ import annotations

import datetime
import re

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password
from models.admin import Admin
from models.client import Client
from models.courier import Courier
from models.courier_account import CourierAccount
from models.delivery import DeliveryRun, DeliveryRunStatus, DeliveryStop
from models.library_operator import LibraryOperator
from models.refresh_token import RefreshToken
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.delivery import CourierAccountCreate, CourierAccountOut
from services import audit_service

_ALL_USER_MODELS = (Admin, Tutor, Client, LibraryOperator, CourierAccount)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _to_out(acc: CourierAccount) -> CourierAccountOut:
    return CourierAccountOut(
        id=acc.id,
        email=acc.email,
        username=acc.username,
        first_name=acc.first_name,
        last_name=acc.last_name,
        is_active=acc.is_active,
        courier_id=acc.courier_id,
        created_at=acc.created_at,
    )


async def _taken(db: AsyncSession, field: str, value: str) -> bool:
    """E-posta/kullanıcı adı TÜM kullanıcı tablolarında tekil (login precedence
    gölgelenemesin)."""
    for model in _ALL_USER_MODELS:
        col = getattr(model, field)
        stmt = select(model.id).where(col == value, model.deleted_at.is_(None))
        if (await db.execute(stmt)).first() is not None:
            return True
    return False


async def _unique_username(db: AsyncSession, base: str) -> str:
    base = re.sub(r"[^a-z0-9_]+", "", base.lower()) or "kurye"
    username = base
    n = 1
    while await _taken(db, "username", username):
        n += 1
        username = f"{base}{n}"
    return username


async def _revoke_all_refresh(db: AsyncSession, *, role_id: int, user_id: int) -> None:
    """Kullanıcının TÜM aktif refresh token'larını iptal eder (bulk)."""
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.role_id == role_id,
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )


async def account_for_courier(
    db: AsyncSession, courier_id: int
) -> CourierAccountOut | None:
    acc = (
        await db.execute(
            select(CourierAccount).where(
                CourierAccount.courier_id == courier_id,
                CourierAccount.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    return _to_out(acc) if acc else None


async def create_account(
    db: AsyncSession, courier_id: int, payload: CourierAccountCreate, *, actor
) -> CourierAccountOut:
    courier = await db.get(Courier, courier_id)
    if courier is None or courier.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kurye profili bulunamadı")
    if not courier.is_active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Pasif kurye profiline hesap açılamaz")
    if await account_for_courier(db, courier_id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kuryenin zaten aktif hesabı var")
    if await _taken(db, "email", payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu e-posta zaten kullanımda")

    acc = CourierAccount(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        username=await _unique_username(db, payload.email.split("@", 1)[0]),
        role_id=ROLE_IDS[RoleType.COURIER],
        courier_id=courier_id,
        email_verified_at=_now(),  # admin oluşturdu — doğrulanmış sayılır
    )
    db.add(acc)
    await db.flush()
    await audit_service.record(
        db, actor=actor, action="courier_account_create",
        target_type="courier_account", target_id=acc.id,
        details=f"kurye #{courier_id} için hesap açıldı",
    )
    await db.commit()
    await db.refresh(acc)
    return _to_out(acc)


async def close_account(db: AsyncSession, account_id: int, *, actor) -> None:
    """Hesabı kapat: soft-delete + pasif + auth_version artışı (access ANINDA
    ölür) + tüm refresh'ler revoke — TEK transaction."""
    acc = await db.get(CourierAccount, account_id)
    if acc is None or acc.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hesap bulunamadı")
    acc.deleted_at = _now()
    acc.is_active = False
    acc.auth_version += 1
    await _revoke_all_refresh(
        db, role_id=ROLE_IDS[RoleType.COURIER], user_id=acc.id
    )
    await audit_service.record(
        db, actor=actor, action="courier_account_close",
        target_type="courier_account", target_id=acc.id,
        details=f"kurye #{acc.courier_id} hesabı kapatıldı; oturumlar iptal",
    )
    await db.commit()


async def close_for_courier_profile(db: AsyncSession, courier_id: int, *, actor) -> None:
    """Kurye PROFİLİ pasifleştirilir/silinirse bağlı hesabı da kapat (commit
    çağıranda — profil değişikliğiyle aynı transaction)."""
    acc = (
        await db.execute(
            select(CourierAccount).where(
                CourierAccount.courier_id == courier_id,
                CourierAccount.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if acc is None:
        return
    acc.deleted_at = _now()
    acc.is_active = False
    acc.auth_version += 1
    await _revoke_all_refresh(db, role_id=ROLE_IDS[RoleType.COURIER], user_id=acc.id)
    await audit_service.record(
        db, actor=actor, action="courier_account_close",
        target_type="courier_account", target_id=acc.id,
        details=f"kurye #{courier_id} profili kapandı; hesap da kapatıldı",
    )


async def reset_password(
    db: AsyncSession, account_id: int, new_password: str, *, actor
) -> None:
    """Admin şifre sıfırlama: yeni hash + sürüm artışı + tüm refresh revoke —
    eski cihazlardaki oturumlar düşer, kurye yeni şifreyle girer."""
    acc = await db.get(CourierAccount, account_id)
    if acc is None or acc.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hesap bulunamadı")
    acc.hashed_password = hash_password(new_password)
    acc.auth_version += 1
    await _revoke_all_refresh(db, role_id=ROLE_IDS[RoleType.COURIER], user_id=acc.id)
    await audit_service.record(
        db, actor=actor, action="courier_account_password_reset",
        target_type="courier_account", target_id=acc.id, details=None,
    )
    await db.commit()


# ── Saha erişim guard'ları (IDOR) ────────────────────────────────────────────


def is_courier_user(user) -> bool:
    return isinstance(user, CourierAccount)


async def ensure_run_access(db: AsyncSession, user, run_id: int) -> None:
    """ADMIN her tura; kurye YALNIZ kendi atanmış turuna. Yabancı tur 404 —
    varlık bilgisi sızmaz. Sahiplik taze DB satırından okunur."""
    if not is_courier_user(user):
        return
    run = await db.get(DeliveryRun, run_id)
    if run is None or run.deleted_at is not None or run.courier_id != user.courier_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tur bulunamadı")


async def ensure_stop_access(db: AsyncSession, user, stop_id: int) -> None:
    if not is_courier_user(user):
        return
    stop = await db.get(DeliveryStop, stop_id)
    if stop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Durak bulunamadı")
    await ensure_run_access(db, user, stop.run_id)


async def current_run_id(db: AsyncSession, account: CourierAccount) -> int | None:
    """Kuryenin güncel turu: önce tek ACTIVE; yoksa bugünün PLANNED'ı; yoksa None."""
    active = (
        await db.execute(
            select(DeliveryRun.id).where(
                DeliveryRun.courier_id == account.courier_id,
                DeliveryRun.status == DeliveryRunStatus.ACTIVE.value,
                DeliveryRun.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    if len(active) > 1:
        # DB partial unique index bunu engeller; yine de rastgele seçme.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Birden çok aktif tur — yöneticiye bildir"
        )
    if active:
        return active[0]
    from core.config import settings

    today = (_now() + datetime.timedelta(hours=settings.APP_UTC_OFFSET_HOURS)).date()
    planned = (
        await db.execute(
            select(DeliveryRun.id)
            .where(
                DeliveryRun.courier_id == account.courier_id,
                DeliveryRun.status == DeliveryRunStatus.PLANNED.value,
                DeliveryRun.run_date == today,
                DeliveryRun.deleted_at.is_(None),
            )
            .order_by(DeliveryRun.id)
        )
    ).scalars().first()
    return planned
