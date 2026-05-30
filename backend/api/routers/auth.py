from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, get_current_active_user
from core.database import get_db
from core.security import create_access_token
from schemas.auth import RegisterRequest, Token
from schemas.tutor import TutorOut
from schemas.user import PasswordChange, UserOut, UserStats, UserUpdate
from services import auth_service, booking_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register/tutor", response_model=TutorOut, status_code=status.HTTP_201_CREATED
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
    "/register/client", response_model=UserOut, status_code=status.HTTP_201_CREATED
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


@router.post("/login", response_model=Token)
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
