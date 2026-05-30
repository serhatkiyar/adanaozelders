from __future__ import annotations

import datetime

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from core.security import decode_access_token
from core import presence
from models.admin import Admin
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus

CurrentUser = Admin | Tutor | Client

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

_ROLE_MODELS: dict[str, type] = {
    RoleType.ADMIN.value: Admin,
    RoleType.TUTOR.value: Tutor,
    RoleType.CLIENT.value: Client,
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

    subject = payload.get("sub")
    model = _ROLE_MODELS.get(payload.get("role"))
    if subject is None or model is None:
        raise _credentials_exception

    user = await db.get(model, int(subject))
    if user is None or user.deleted_at is not None:
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


async def get_current_approved_tutor(
    tutor: Tutor = Depends(require_roles(RoleType.TUTOR)),
) -> Tutor:
    if tutor.status != TutorStatus.APPROVED:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tutor is not approved")
    return tutor
