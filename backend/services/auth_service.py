from __future__ import annotations

import datetime
import secrets

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password_async, verify_password_async
from core.slug import slugify_tr
from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.role import ROLE_IDS, RoleType
from models.tutor import Gender, Tutor
from schemas.user import UserUpdate
# refresh_token_service yalnız core/models'e bağlı — döngüsel import yok.
from services import refresh_token_service

_LOGIN_PRECEDENCE: tuple[tuple[RoleType, type], ...] = (
    (RoleType.ADMIN, Admin),
    (RoleType.TUTOR, Tutor),
    (RoleType.CLIENT, Client),
    (RoleType.LIBRARY_OPERATOR, LibraryOperator),
    (RoleType.COURIER, CourierAccount),
)

#: Rol → model eşlemesinin TEK kaynağı (İP-3 §6.3). İkinci bir katalog
#: TUTULMAZ: `verification_service` ve `api/routers/auth.py` buradan türetir.
#: Eski drift somut zarar verdi — `_MODEL_BY_ROLE` 3 rolde kalınca operatör ve
#: kurye "şifremi unuttum" akışını tamamlayamıyordu (mail gidiyor, link ölü).
MODEL_BY_ROLE_ID: dict[int, type] = {
    ROLE_IDS[role]: model for role, model in _LOGIN_PRECEDENCE
}


def _exclude_shadow(stmt, model: type):
    """Eğitmenin alışveriş gölgesini her kimlik sorgusundan düşürür.

    Gölge satır bir GİRİŞ ÖZNESİ DEĞİLDİR (docs/egitmen-alici-sozlesme.md §1.2):
    eğitmenin gerçek e-postasını taşır ama onunla giriş yapılamaz, şifre
    sıfırlanamaz ve kullanıcı adı tekilliğinde yer tutmaz. Filtre olmadan
    `authenticate`/`find_by_email` içindeki `scalar_one_or_none()` — eğitmenin
    e-postasıyla ayrı bir gerçek öğrenci hesabı da varsa — iki satır bulup
    MultipleResultsFound ile 500 verirdi.
    """
    if model is Client:
        return stmt.where(Client.shadow_of_tutor_id.is_(None))
    return stmt


async def _email_taken(db: AsyncSession, model: type, email: str) -> bool:
    stmt = _exclude_shadow(
        select(model.id).where(model.email == email, model.deleted_at.is_(None)),
        model,
    )
    return (await db.execute(stmt)).first() is not None


# Kullanıcı adı tüm hesap türlerinde globalde tekildir. Tek kaynaktan türetilir
# (elle yazılan kopya kuryeyi atlamıştı — 4 modellik drift).
_ALL_USER_MODELS: tuple[type, ...] = tuple(m for _role, m in _LOGIN_PRECEDENCE)


async def _username_taken(
    db: AsyncSession,
    username: str,
    *,
    exclude_model: type | None = None,
    exclude_id: int | None = None,
) -> bool:
    for model in _ALL_USER_MODELS:
        stmt = _exclude_shadow(
            select(model.id).where(
                model.username == username, model.deleted_at.is_(None)
            ),
            model,
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


async def _turet_kullanici_adi(
    db: AsyncSession, first_name: str, last_name: str
) -> str:
    """Ad-soyaddan serbest bir kullanıcı adı üretir.

    NEDEN VAR: kayıt formu eğitmene kullanıcı adı SORMUYOR. Superprof'ta olduğu
    gibi kayıt e-posta + parola + ad + soyad ile bitiyor; araya konan her ek
    alan, ilan oluşturma akışına girmeden vazgeçen aday demek. Kullanıcı adı
    kimlik değil bir kolaylık: public eğitmen adresi `slug` (`isim-soyisim-{id}`)
    üzerinden kuruluyor, bu yüzden üretilmiş bir ad kimseyi bağlamıyor —
    isteyen `/ayarlar`'dan değiştirebiliyor.

    Desen `^[a-zA-Z0-9_]+$` (bkz. `schemas/user.USERNAME_PATTERN`), yani tire
    kabul etmiyor: `slugify_tr`'nin çıktısındaki tireler alt çizgiye çevrilir.
    """
    taban = slugify_tr(f"{first_name} {last_name}").replace("-", "_")[:40]
    taban = taban.strip("_") or "kullanici"
    if len(taban) < 3:
        taban = f"{taban}_kullanici"[:40]
    if not await _username_taken(db, taban):
        return taban
    # Çakışmada sıralı sayaç (ahmet_2, ahmet_3…) KULLANILMAZ: aynı ada sahip kaç
    # kişi olduğunu dışarıya sızdırır ve her denemede bir sorgu daha eder.
    for _ in range(5):
        aday = f"{taban[:40]}_{secrets.randbelow(9000) + 1000}"
        if not await _username_taken(db, aday):
            return aday
    return f"{taban[:36]}_{secrets.token_hex(4)}"[:50]


async def register_tutor(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    username: str | None = None,
    birth_date: datetime.date | None = None,
    gender: Gender | None = None,
) -> Tutor:
    if username:
        await _ensure_unique(db, Tutor, email=email, username=username)
    else:
        # Kullanıcı adı SORULMADIYSA üretilir; e-posta tekilliği yine aranır.
        if await _email_taken(db, Tutor, email):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Email already registered"
            )
        username = await _turet_kullanici_adi(db, first_name, last_name)
    tutor = Tutor(
        email=email,
        hashed_password=await hash_password_async(password),
        first_name=first_name,
        last_name=last_name,
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
    username: str | None = None,
    birth_date: datetime.date | None = None,
    gender: Gender | None = None,
) -> Client:
    if username:
        await _ensure_unique(db, Client, email=email, username=username)
    else:
        # Kullanıcı adı SORULMADIYSA üretilir; e-posta tekilliği yine aranır.
        if await _email_taken(db, Client, email):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Email already registered"
            )
        username = await _turet_kullanici_adi(db, first_name, last_name)
    client = Client(
        email=email,
        hashed_password=await hash_password_async(password),
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
    # Ad-soyad kimlik bütünlüğü için kapılıdır: ilk değişiklik serbest,
    # sonrası admin onayı + gerekçe gerektirir (name_change_service).
    reason = payload.pop("reason", None)
    first_name = payload.pop("first_name", None)
    last_name = payload.pop("last_name", None)
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
    # Değişim sonrası kilit durumunu da güncelle (ör. öğrencinin ilk değişiminden
    # sonra artık onay gerekecek; frontend bir sonraki düzenlemede gerekçe ister).
    name_change_service.annotate_change_locks(user, user.role_id)
    return user


async def change_password(
    db: AsyncSession,
    user: Admin | Tutor | Client | LibraryOperator | CourierAccount,
    *,
    current_password: str,
    new_password: str,
) -> None:
    if not await verify_password_async(current_password, user.hashed_password):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Current password is incorrect"
        )
    user.hashed_password = await hash_password_async(new_password)
    # Oturum sürümü (İP-3 §6): mevcut ACCESS token'lar da anında ölsün — yalnız
    # refresh iptali, çalınmış access token'ı ACCESS_TOKEN_EXPIRE_MINUTES boyunca
    # yaşatıyordu. Sürüm artışı + hash aynı flush/transaction içinde (atomik).
    user.auth_version = int(user.auth_version or 0) + 1
    await db.flush()
    # Şifre değişimi TÜM oturumları kapatır: aksi halde çalınmış 30 günlük bir
    # refresh token, kurban şifresini değiştirdikten sonra da /auth/refresh ile
    # erişim üretmeye devam ederdi. (Çağıran, isterse aynı istekte yeni token verir.)
    await refresh_token_service.revoke_all_for_user(
        db, role_id=user.role_id, user_id=user.id
    )


async def authenticate(db: AsyncSession, *, email: str, password: str):
    for role, model in _LOGIN_PRECEDENCE:
        stmt = _exclude_shadow(
            select(model).where(model.email == email, model.deleted_at.is_(None)),
            model,
        )
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user is not None and await verify_password_async(password, user.hashed_password):
            return user, role
    return None, None


async def find_by_email(db: AsyncSession, *, email: str):
    """E-postayı 5 kullanıcı tablosunda sırayla arar. Şifre sıfırlama talebinde
    kullanılır (kimlik doğrulamasız). Bulunamazsa None — çağıran enumeration'a
    karşı yanıtı her durumda aynı tutmalıdır."""
    for _role, model in _LOGIN_PRECEDENCE:
        stmt = _exclude_shadow(
            select(model).where(model.email == email, model.deleted_at.is_(None)),
            model,
        )
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user is not None:
            return user
    return None


async def reset_password(
    db: AsyncSession,
    user: Admin | Tutor | Client | LibraryOperator | CourierAccount,
    *,
    new_password: str,
) -> None:
    """Token ile doğrulanmış şifre sıfırlama (mevcut şifre sorulmaz).

    Hesabı ele geçiren saldırganın oturumunu da düşürmek için tüm oturumlar
    düşürülür — "şifremi unuttum" akışının asıl amacı budur: refresh token'lar
    iptal edilir VE `auth_version` artırılarak mevcut access token'lar da
    anında öldürülür (İP-3 §6; saldırganın elindeki access token bir saat daha
    yaşarsa akış amacını karşılamaz).
    """
    user.hashed_password = await hash_password_async(new_password)
    user.auth_version = int(user.auth_version or 0) + 1
    await db.flush()
    await refresh_token_service.revoke_all_for_user(
        db, role_id=user.role_id, user_id=user.id
    )
