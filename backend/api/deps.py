from __future__ import annotations

import datetime

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
        # `from None`: JWT ayrıştırma detayı (süresi doldu / imza geçersiz /
        # bozuk payload) istemciye sızmasın — hepsi tek tip 401 döner.
        raise _credentials_exception from None

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
    # Oturum sürümü (İP-3 §6): şifre değişimi/sıfırlaması ve hesap kapatma
    # auth_version'ı artırır; eski sürümlü access token denylist ya da doğal
    # süre dolumunu beklemeden ANINDA ölür. Denetim BÜTÜN kullanıcı tiplerinde,
    # tek yerde ve rol istisnası olmadan yapılır (eskiden yalnız kuryedeydi).
    if payload.get("auth_ver") != user.auth_version:
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


async def get_current_active_operator(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Admin | LibraryOperator:
    """Ortak ACTIVE kapısı: kütüphanesi admin onayından geçmiş operatör — ya da ADMIN.

    Self-servis kayıt (``POST /libraries/register``) anında oturum açtığı için
    rol kontrolü tek başına yetmez: onay beklemekte olan (PENDING) — ya da
    reddedilmiş/askıya alınmış — bir kütüphanenin operatörü de geçerli bir
    LIBRARY_OPERATOR token'ına sahiptir. Onaya bağlı yönetim yüzeyleri bu
    dependency ile kablolanır.

    Sözleşme (docs/ip3-yetki-kvkk-sozlesme.md §1b):

    - **ADMIN olduğu gibi geçer** — platform yönetimi, denetlediği işletmenin
      onay durumuna bağlanamaz (onaylama işlemi de bu yüzeylerden yapılır).
      Hangi admin İZNİNİN gerektiği kararı rotadaki
      ``require_roles_or_admin_permission(...)`` katmanında kalır; bu kapı o
      kararı ne tekrarlar ne de gevşetir.
    - **Durum kontrolleri yalnız gerçek LibraryOperator için**: kütüphane
      silinmişse 404, ``status != ACTIVE`` ise 403. Kapı allowlist'tir —
      tanımlı olmayan/gelecekte eklenecek durumlar da reddedilir (fail-closed).
      Operatör hesabı silinmişse ``get_current_user`` zaten 401 verir.
    """
    if isinstance(user, Admin):
        return user
    if not isinstance(user, LibraryOperator):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    from models.library import Library, LibraryStatus

    lib = await db.get(Library, user.library_id)
    if lib is None or lib.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kütüphane bulunamadı")
    if lib.status != LibraryStatus.ACTIVE.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Kütüphaneniz henüz onaylanmadı; bu işlem onaydan sonra kullanılabilir.",
        )
    return user



#: Gölgeye yansıtılan kimlik alanları (docs/egitmen-alici-sozlesme.md §1.5).
#: Yansıtma TEK YÖNLÜDÜR: Tutor → gölge. Liste burada tek kaynaktır; yeni bir
#: kimlik alanı eklenirse buraya girmezse fatura/ödeme sağlayıcısı eski değeri
#: görür.
_SHADOW_MIRRORED_FIELDS = (
    "first_name",
    "last_name",
    "email",
    "avatar_url",
    "phone",
    "phone_verified_at",
    "email_verified_at",
)


async def get_shopping_client(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Client:
    """Mağazanın alıcı kimliği: öğrencinin kendisi ya da eğitmenin gölgesi.

    `require_roles(RoleType.CLIENT)`'ın mağaza+adres uçlarındaki yerini alır
    (docs/egitmen-alici-sozlesme.md §2). Aşağı akış — sipariş, escrow, fatura,
    teslimat, adres — HİÇ DEĞİŞMEZ: hepsi bir `Client` nesnesi ve `clients.id`
    üzerinde çalışmaya devam eder.

    Sözleşme:

    - **CLIENT** → kendisi; mevcut davranış birebir korunur.
    - **TUTOR** → bağlı gölge satır; yoksa oluşturulur, varsa kimlik alanları
      tazelenir. Gölge bir giriş öznesi değildir (§1.2): parolası hiçbir şeyle
      eşleşmez, `is_active=False`'tır ve kimlik sorgularından düşürülür.
    - **Diğer roller** → 403, `require_roles` ile aynı gövde (fail-closed).

    `TutorStatus.SUSPENDED` alışverişi durdurmaz (§6): askıya alma satıcılığı
    hedefler, tüketiciliği değil. Hesap tamamen kapatılmışsa
    `get_current_active_user` zaten `is_active`'te keser.
    """
    if isinstance(user, Client):
        return user
    if not isinstance(user, Tutor):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")

    stmt = select(Client).where(
        Client.shadow_of_tutor_id == user.id, Client.deleted_at.is_(None)
    )
    shadow = (await db.execute(stmt)).scalar_one_or_none()

    if shadow is None:
        shadow = Client(
            shadow_of_tutor_id=user.id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            hashed_password="!",  # hiçbir parolayla eşleşmez
            is_active=False,
            **{f: getattr(user, f, None) for f in _SHADOW_MIRRORED_FIELDS},
        )
        try:
            # SAVEPOINT: çakışmada yalnız bu ekleme geri alınır. Düz
            # `db.rollback()` dış işlemi de öldürür ve `get_current_active_user`
            # içinde tazelenen kullanıcı nesnesini expire ederdi.
            async with db.begin_nested():
                db.add(shadow)
                await db.flush()
        except IntegrityError:
            # Aynı eğitmenin iki eşzamanlı isteği: kısmi UNIQUE indeks ikinciyi
            # reddeder. Kazananı oku — gölge yine tektir.
            shadow = (await db.execute(stmt)).scalar_one()
        return shadow

    # Yansıtmayı tazele — YALNIZ değer farklıysa yaz. Aksi hâlde her GET isteği
    # gereksiz bir UPDATE üretirdi (§8.6).
    for field in _SHADOW_MIRRORED_FIELDS:
        yeni = getattr(user, field, None)
        if getattr(shadow, field) != yeni:
            setattr(shadow, field, yeni)
    return shadow


async def get_optional_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser | None:
    """Oturum VARSA kullanıcıyı döndürür, yoksa None — hata fırlatmaz.

    Public uçlarda (iletişim formu gibi) "giriş yapmışsa kim olduğunu bil, ama
    giriş şart olmasın" davranışı için. `oauth2_scheme` eksik token'da 401
    attığından burada başlığı kendimiz okuyoruz.
    """
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        return await get_current_user(token=token, db=db)
    except HTTPException:
        # Geçersiz/süresi dolmuş token public uçta akışı kesmemeli.
        return None

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
