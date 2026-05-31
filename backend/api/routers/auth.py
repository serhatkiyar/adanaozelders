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
# E-posta tetikleyen endpoint'ler (doğrulama yeniden gönder, şifre sıfırlama talebi).
_email_limit = rate_limit(
    key="email",
    limit=settings.RATE_LIMIT_EMAIL,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)
from models.admin import Admin
from models.client import Client
from models.role import ROLE_IDS, RoleType, role_name
from models.tutor import Tutor
from models.verification_token import TokenPurpose
from schemas.auth import (
    EmailVerifyConfirm,
    LogoutRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    Token,
)
from schemas.tutor import TutorOut
from schemas.user import PasswordChange, UserOut, UserStats, UserUpdate
from services import (
    auth_service,
    booking_service,
    refresh_token_service,
    verification_service,
)

# role_id -> kullanıcı modeli (refresh sırasında kullanıcıyı yüklemek için).
_MODEL_BY_ROLE_ID: dict[int, type] = {
    ROLE_IDS[RoleType.ADMIN]: Admin,
    ROLE_IDS[RoleType.TUTOR]: Tutor,
    ROLE_IDS[RoleType.CLIENT]: Client,
}

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
    tutor = await auth_service.register_tutor(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
        username=payload.username,
        birth_date=payload.birth_date,
        gender=payload.gender,
    )
    await verification_service.send_email_verification(db, tutor)
    return tutor


@router.post(
    "/register/client",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_client(
    payload: RegisterRequest, db: AsyncSession = Depends(get_db)
):
    client = await auth_service.register_client(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
        username=payload.username,
        birth_date=payload.birth_date,
        gender=payload.gender,
    )
    await verification_service.send_email_verification(db, client)
    return client


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
    token = create_access_token(
        subject=user.id, role=role.value, role_id=user.role_id
    )
    refresh = await refresh_token_service.issue(
        db, role_id=user.role_id, user_id=user.id
    )
    await db.commit()
    return Token(access_token=token, refresh_token=refresh)


@router.post("/refresh", response_model=Token)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    # Refresh token'ı rotasyonla yenile (eski revoke, yeni üret) ve yeni access üret.
    result = await refresh_token_service.rotate(db, raw_token=payload.refresh_token)
    if result is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Oturum süresi doldu, lütfen tekrar giriş yap.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    role_id, user_id, new_refresh = result
    model = _MODEL_BY_ROLE_ID.get(role_id)
    user = await db.get(model, user_id) if model else None
    if user is None or user.deleted_at is not None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Hesap bulunamadı veya pasif")
    access = create_access_token(
        subject=user.id, role=role_name(role_id), role_id=role_id
    )
    return Token(access_token=access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest | None = None,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    # Access token'ın jti'sini kalan ömrü kadar denylist'e koyarak iptal et.
    try:
        decoded = decode_access_token(token)
    except jwt.PyJWTError:
        decoded = None
    if decoded:
        jti = decoded.get("jti")
        exp = decoded.get("exp")
        if jti and exp:
            now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            await revoke(jti, max(int(exp) - now, 1))
    # Refresh token verildiyse onu da kalıcı olarak geçersiz kıl.
    if payload and payload.refresh_token:
        await refresh_token_service.revoke(db, raw_token=payload.refresh_token)


@router.post("/verify-email/confirm", response_model=MessageResponse)
async def verify_email_confirm(
    payload: EmailVerifyConfirm, db: AsyncSession = Depends(get_db)
):
    # Token'ın kendisi kimlik kanıtıdır; oturum gerekmez (kullanıcı linke tıklar).
    user = await verification_service.consume_token(
        db, raw_token=payload.token, purpose=TokenPurpose.EMAIL_VERIFY
    )
    if user is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
        )
    await verification_service.mark_email_verified(db, user)
    return MessageResponse(detail="E-posta adresin doğrulandı.")


@router.post(
    "/verify-email/resend",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=MessageResponse,
    dependencies=[Depends(_email_limit)],
)
async def verify_email_resend(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    # Zaten doğrulanmışsa sessizce no-op (send_email_verification içinde de korunur).
    await verification_service.send_email_verification(db, user)
    return MessageResponse(detail="Doğrulama bağlantısı e-posta adresine gönderildi.")


@router.post(
    "/password-reset/request",
    response_model=MessageResponse,
    dependencies=[Depends(_email_limit)],
)
async def password_reset_request(
    payload: PasswordResetRequest, db: AsyncSession = Depends(get_db)
):
    user = await auth_service.find_by_email(db, email=payload.email)
    if user is not None and user.is_active:
        await verification_service.send_password_reset(db, user)
    # Hesap enumeration'ını önlemek için yanıt her durumda aynıdır.
    return MessageResponse(
        detail="E-posta adresin kayıtlıysa şifre sıfırlama bağlantısı gönderildi.",
    )


@router.post("/password-reset/confirm", response_model=MessageResponse)
async def password_reset_confirm(
    payload: PasswordResetConfirm, db: AsyncSession = Depends(get_db)
):
    user = await verification_service.consume_token(
        db, raw_token=payload.token, purpose=TokenPurpose.PASSWORD_RESET
    )
    if user is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Sıfırlama bağlantısı geçersiz veya süresi dolmuş.",
        )
    await auth_service.reset_password(db, user, new_password=payload.new_password)
    return MessageResponse(detail="Şifren güncellendi. Artık giriş yapabilirsin.")


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
