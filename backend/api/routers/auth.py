from __future__ import annotations

import datetime

import jwt
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user, oauth2_scheme
from core.database import get_db
from core.config import settings
from core.ratelimit import rate_limit
from core.security import create_access_token, decode_access_token
from core.token_denylist import revoke
from core.storage import upload_avatar, delete_avatar

_login_limit = rate_limit(
    key="login",
    limit=settings.RATE_LIMIT_LOGIN,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
_register_limit = rate_limit(
    key="register",
    limit=settings.RATE_LIMIT_REGISTER,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
from schemas.auth import RegisterRequest, Token
from schemas.tutor import TutorOut
from schemas.user import PasswordChange, UserOut, UserStats, UserUpdate
from services import auth_service, booking_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register/tutor",
    response_model=TutorOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_tutor(
    payload: RegisterRequest, db: AsyncSession = Depends(get_db)
):
    return await auth_service.register_tutor(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
        username=payload.username,
        birth_date=payload.birth_date,
        gender=payload.gender,
    )


@router.post(
    "/register/client",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_client(
    payload: RegisterRequest, db: AsyncSession = Depends(get_db)
):
    return await auth_service.register_client(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
        username=payload.username,
        birth_date=payload.birth_date,
        gender=payload.gender,
    )


@router.post("/login", response_model=Token, dependencies=[Depends(_login_limit)])
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    user, role = await auth_service.authenticate(
        db, email=form.username, password=form.password
    )
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Inactive user")

    user.last_seen_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    token = create_access_token(
        subject=user.id, role=role.value, role_id=user.role_id
    )
    return Token(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(token: str = Depends(oauth2_scheme)):
    # Token'ın jti'sini kalan ömrü kadar denylist'e koyarak sunucu tarafında iptal et.
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        return  # geçersiz/expired token: zaten oturum yok
    jti = payload.get("jti")
    exp = payload.get("exp")
    if jti and exp:
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        await revoke(jti, max(int(exp) - now, 1))


@router.get("/me", response_model=UserOut)
async def read_me(user: CurrentUser = Depends(get_current_active_user)):
    return user


@router.get("/me/stats", response_model=UserStats)
async def read_my_stats(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    completed = await booking_service.count_completed(
        db, role_id=user.role_id, user_id=user.id
    )
    return UserStats(completed_lessons=completed)


@router.patch("/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.update_me(db, user, payload)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(
    payload: PasswordChange,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await auth_service.change_password(
        db,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )


@router.post("/me/avatar", response_model=UserOut)
async def update_my_avatar(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    if len(file_bytes) > settings.MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is too large"
        )

    if user.avatar_url:
        await delete_avatar(user.avatar_url)

    url = await upload_avatar(file_bytes)
    user.avatar_url = url
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/me/avatar", response_model=UserOut)
async def delete_my_avatar(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if user.avatar_url:
        await delete_avatar(user.avatar_url)
        user.avatar_url = None
        await db.commit()
        await db.refresh(user)
    return user
