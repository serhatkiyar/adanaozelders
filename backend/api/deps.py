from __future__ import annotations

import datetime

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from core.ratelimit import enforce
from core.security import decode_access_token
from core.token_denylist import is_revoked
from core import presence
from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus

CurrentUser = Admin | Tutor | Client | LibraryOperator | CourierAccount

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

_ROLE_MODELS: dict[str, type] = {
    RoleType.ADMIN.value: Admin,
    RoleType.TUTOR.value: Tutor,
    RoleType.CLIENT.value: Client,
    RoleType.LIBRARY_OPERATOR.value: LibraryOperator,
    RoleType.COURIER.value: CourierAccount,
}

_credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise _credentials_exception

    # Logout ile iptal edilmiş (denylist'teki) token reddedilir.
    if await is_revoked(payload.get("jti")):
        raise _credentials_exception

    subject = payload.get("sub")
    model = _ROLE_MODELS.get(payload.get("role"))
    if subject is None or model is None:
        raise _credentials_exception

    user = await db.get(model, int(subject))
    if user is None or user.deleted_at is not None:
        raise _credentials_exception
    # Kurye oturum sürümü: hesap kapatma/şifre sıfırlama auth_version'ı artırır;
    # eski sürümlü access token ANINDA ölür (kurye işten ayrıldı → telefon oturumu
    # denylist beklemeden kapanır). Diğer rollerin JWT sözleşmesi değişmez.
    if model is CourierAccount and payload.get("auth_ver") != user.auth_version:
        raise _credentials_exception
    return user


async def get_current_active_user(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Inactive user")

    now = datetime.datetime.now(datetime.timezone.utc)
    threshold = datetime.timedelta(seconds=settings.LAST_SEEN_THROTTLE_SECONDS)
    if user.last_seen_at is None or now - user.last_seen_at > threshold:
        # Note: We update memory object but do NOT commit to DB synchronously.
        # It's flushed asynchronously via presence.
        user.last_seen_at = now
        await presence.touch(user.__tablename__, user.id)
    return user


def require_roles(*allowed: RoleType):
    allowed_ids = {ROLE_IDS[role] for role in allowed}

    async def checker(
        user: CurrentUser = Depends(get_current_active_user),
    ) -> CurrentUser:
        if user.role_id not in allowed_ids:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Insufficient permissions"
            )
        return user

    return checker


def require_admin_permission(permission_code: str):
    """Platform ADMIN rolüne ek olarak görev bazlı izni backend'de zorunlu kılar."""
    async def checker(
        user: CurrentUser = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> Admin:
        if not isinstance(user, Admin):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        from services import admin_access_service

        _role_code, permissions = await admin_access_service.get_admin_access(db, user.id)
        if permission_code not in permissions:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient admin permission")
        return user

    return checker


def require_roles_or_admin_permission(permission_code: str, *other_roles: RoleType):
    """Admin için görev izni, diğer açıkça izin verilen roller için platform rolü ister."""
    other_role_ids = {ROLE_IDS[role] for role in other_roles}

    async def checker(
        user: CurrentUser = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> CurrentUser:
        if isinstance(user, Admin):
            from services import admin_access_service

            _role_code, permissions = await admin_access_service.get_admin_access(db, user.id)
            if permission_code in permissions:
                return user
        elif user.role_id in other_role_ids:
            return user
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    return checker


def require_admin_method_permission(view_permission: str, manage_permission: str):
    """Salt-okunur HTTP metotlarında view, mutasyonlarda manage izni ister."""
    async def checker(
        request: Request,
        user: CurrentUser = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> Admin:
        if not isinstance(user, Admin):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        from services import admin_access_service

        required = view_permission if request.method in {"GET", "HEAD", "OPTIONS"} else manage_permission
        _role_code, permissions = await admin_access_service.get_admin_access(db, user.id)
        if required not in permissions:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient admin permission")
        return user

    return checker


async def get_current_approved_tutor(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
) -> Tutor:
    if tutor.status != TutorStatus.APPROVED:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tutor is not approved")
    return tutor


def user_rate_limit(*, key: str, limit: int, window_seconds: int):
    """Kullanıcı (role_id+user_id) bazlı fixed-window limiter — kimlik doğrulamalı
    yazma uçları için (booking/mesaj/qa/demand/review/ödeme). IP bazlı limiter'ın
    aksine aynı NAT arkasındaki kullanıcılar birbirini etkilemez. Redis yoksa
    fail-open. get_current_active_user ile aynı istekte paylaşılır (çift auth yok).
    """

    async def dependency(
        user: CurrentUser = Depends(get_current_active_user),
    ) -> None:
        await enforce(
            bucket=f"rl:{key}:u{user.role_id}:{user.id}",
            limit=limit,
            window_seconds=window_seconds,
        )

    return dependency
