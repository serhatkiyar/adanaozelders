from __future__ import annotations

import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password, verify_password
from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from models.tutor import Gender, Tutor
from schemas.user import UserUpdate

_LOGIN_PRECEDENCE: tuple[tuple[RoleType, type], ...] = (
    (RoleType.ADMIN, Admin),
    (RoleType.TUTOR, Tutor),
    (RoleType.CLIENT, Client),
    (RoleType.LIBRARY_OPERATOR, LibraryOperator),
    (RoleType.COURIER, CourierAccount),
)


async def _email_taken(db: AsyncSession, model: type, email: str) -> bool:
    stmt = select(model.id).where(model.email == email, model.deleted_at.is_(None))
    return (await db.execute(stmt)).first() is not None


# Kullanıcı adı tüm hesap türlerinde globalde tekildir.
_ALL_USER_MODELS: tuple[type, ...] = (Admin, Tutor, Client, LibraryOperator)


async def _username_taken(
    db: AsyncSession,
    username: str,
    *,
    exclude_model: type | None = None,
    exclude_id: int | None = None,
) -> bool:
    for model in _ALL_USER_MODELS:
        stmt = select(model.id).where(
            model.username == username, model.deleted_at.is_(None)
        )
        if exclude_model is model and exclude_id is not None:
            stmt = stmt.where(model.id != exclude_id)
        if (await db.execute(stmt)).first() is not None:
            return True
    return False


async def _ensure_unique(
    db: AsyncSession, model: type, *, email: str, username: str
) -> None:
    if await _email_taken(db, model, email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    if await _username_taken(db, username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")


async def register_tutor(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    username: str,
    birth_date: datetime.date | None = None,
    gender: Gender | None = None,
) -> Tutor:
    await _ensure_unique(db, Tutor, email=email, username=username)
    tutor = Tutor(
        email=email,
        hashed_password=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        username=username,
        birth_date=birth_date,
        gender=gender,
        role_id=ROLE_IDS[RoleType.TUTOR],
    )
    db.add(tutor)
    await db.flush()
    await db.refresh(tutor)
    return tutor


async def register_client(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    username: str,
    birth_date: datetime.date | None = None,
    gender: Gender | None = None,
) -> Client:
    await _ensure_unique(db, Client, email=email, username=username)
    client = Client(
        email=email,
        hashed_password=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        username=username,
        birth_date=birth_date,
        gender=gender,
        role_id=ROLE_IDS[RoleType.CLIENT],
    )
    db.add(client)
    await db.flush()
    await db.refresh(client)
    return client


async def update_me(
    db: AsyncSession, user: Admin | Tutor | Client, data: UserUpdate
) -> Admin | Tutor | Client:
    from services import name_change_service

    payload = data.model_dump(exclude_unset=True)
    # Ad-soyad/kullanıcı adı kimlik bütünlüğü için kapılıdır: ilk değişiklik serbest,
    # sonrası admin onayı + gerekçe gerektirir (name_change_service).
    reason = payload.pop("reason", None)
    first_name = payload.pop("first_name", None)
    last_name = payload.pop("last_name", None)
    username = payload.pop("username", None)
    result = await name_change_service.apply_or_request(
        db,
        user,
        role_id=user.role_id,
        first_name=first_name,
        last_name=last_name,
        username=username,
        reason=reason,
    )
    # Kalan alanlar (about/birth_date/gender) serbestçe uygulanır.
    for field, value in payload.items():
        setattr(user, field, value)
    await db.flush()
    await db.refresh(user)
    # Onaya gönderilen alanları yanıtta sinyalle (transient — kalıcı kolon değil).
    user.pending_name_change = "NAME" in result["pending"]
    user.pending_username_change = "USERNAME" in result["pending"]
    # Değişim sonrası kilit durumunu da güncelle (ör. öğrencinin ilk değişiminden
    # sonra artık onay gerekecek; frontend bir sonraki düzenlemede gerekçe ister).
    name_change_service.annotate_change_locks(user, user.role_id)
    return user


async def change_password(
    db: AsyncSession,
    user: Admin | Tutor | Client | LibraryOperator,
    *,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(current_password, user.hashed_password):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Current password is incorrect"
        )
    user.hashed_password = hash_password(new_password)
    await db.flush()


async def authenticate(db: AsyncSession, *, email: str, password: str):
    for role, model in _LOGIN_PRECEDENCE:
        stmt = select(model).where(model.email == email, model.deleted_at.is_(None))
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user is not None and verify_password(password, user.hashed_password):
            return user, role
    return None, None


async def find_by_email(db: AsyncSession, *, email: str):
    """E-postayı 3 kullanıcı tablosunda sırayla arar. Şifre sıfırlama talebinde
    kullanılır (kimlik doğrulamasız). Bulunamazsa None — çağıran enumeration'a
    karşı yanıtı her durumda aynı tutmalıdır."""
    for _role, model in _LOGIN_PRECEDENCE:
        stmt = select(model).where(model.email == email, model.deleted_at.is_(None))
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user is not None:
            return user
    return None


async def reset_password(
    db: AsyncSession, user: Admin | Tutor | Client, *, new_password: str
) -> None:
    """Token ile doğrulanmış şifre sıfırlama (mevcut şifre sorulmaz)."""
    user.hashed_password = hash_password(new_password)
    await db.flush()
