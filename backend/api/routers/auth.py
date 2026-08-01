from __future__ import annotations

import datetime
import logging

import jwt
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import (
    CurrentUser,
    get_current_active_user,
    oauth2_scheme,
    user_rate_limit,
)
from core.cookies import (
    clear_refresh_cookie,
    clear_refresh_cookie_headers,
    get_refresh_cookie,
    set_refresh_cookie,
)
from core.database import get_db
from core.config import settings
from core.ratelimit import client_ip, rate_limit
from core.security import (
    create_access_token,
    decode_access_token,
    verify_password_async,
)
from core.token_denylist import revoke
from core.storage import upload_avatar, delete_avatar, delete_file

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
from models.role import role_name
from models.verification_token import TokenPurpose
from schemas.auth import (
    AccountDeleteRequest,
    EmailVerifyConfirm,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    Token,
)
from schemas.tutor import TutorOut
from schemas.user import (
    NameChangeRequestOut,
    PasswordChange,
    PhoneOtpVerify,
    PhoneRequestResult,
    PhoneUpdate,
    UserOut,
    UserStats,
    UserUpdate,
)
from services import (
    account_deletion_service,
    auth_service,
    booking_service,
    consent_service,
    name_change_service,
    phone_service,
    refresh_token_service,
    verification_service,
)

# SMS OTP gönderimi — kullanıcı bazlı rate-limit (spam/maliyet koruması).
_sms_limit = user_rate_limit(
    key="sms_otp",
    limit=settings.RATE_LIMIT_SMS,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

# role_id -> kullanıcı modeli (refresh sırasında kullanıcıyı yüklemek için).
# Rol → model eşlemesi TEK kaynaktan (İP-3 §6.3): elle yazılmış kopya bir kez
# rol 4/5'i atlayıp operatör refresh'ini sessizce kırmıştı (drift bug).
_MODEL_BY_ROLE_ID: dict[int, type] = auth_service.MODEL_BY_ROLE_ID

logger = logging.getLogger("adana.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


async def _record_signup_consents(
    db: AsyncSession, request: Request, *, user, payload: RegisterRequest
) -> None:
    """Kayıt anındaki zorunlu onayları ispat kaydı olarak yazar.

    KVKK'da ispat yükü veri sorumlusundadır: "onayladım/onaylamadım"
    tartışmasında gösterilecek bir kayıt olmalıdır. IP ve user-agent yalnız bu
    amaçla tutulur ve hesap anonimleştirmesinde temizlenir.
    """
    await consent_service.record_signup_consents(
        db,
        user_id=user.id,
        role_id=user.role_id,
        doc_version=payload.consent_version,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()


@router.post(
    "/register/tutor",
    response_model=TutorOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_tutor(
    payload: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
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
    await _record_signup_consents(db, request, user=tutor, payload=payload)
    await verification_service.send_email_verification(db, tutor)
    return tutor


@router.post(
    "/register/client",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_limit)],
)
async def register_client(
    payload: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
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
    await _record_signup_consents(db, request, user=client, payload=payload)
    await verification_service.send_email_verification(db, client)
    return client


@router.post("/login", response_model=Token, dependencies=[Depends(_login_limit)])
async def login(
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    remember: bool = Form(False),
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
        subject=user.id,
        role=role.value,
        role_id=user.role_id,
        auth_version=getattr(user, "auth_version", None),
    )
    refresh = await refresh_token_service.issue(
        db, role_id=user.role_id, user_id=user.id, persistent=remember
    )
    await db.commit()
    # Refresh token YANITTA DÖNMEZ, çereze yazılır: gövdede dönseydi JS onu
    # okuyup saklamak zorunda kalırdı ve tek bir XSS 30 günlük hesap devrine
    # yeterdi (bkz. core/cookies.py).
    set_refresh_cookie(response, refresh, remember=remember)
    return Token(access_token=token)


@router.post("/refresh", response_model=Token)
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Refresh token'ı rotasyonla yeniler (eski revoke, yeni üret).

    Token yalnız ``httpOnly`` çerezden okunur; gövdeden kabul EDİLMEZ. Gövde
    yolu açık bırakılsaydı, çereze geçmenin sağladığı korumayı bir saldırgan
    çalınmış bir token'ı elle göndererek atlatabilirdi.
    """
    raw = get_refresh_cookie(request)
    result = await refresh_token_service.rotate(db, raw_token=raw) if raw else None
    if result is None:
        # Geçersiz/eksik çerezi temizle: tarayıcı ölü bir token'ı her istekte
        # taşımaya devam etmesin. Silme başlığı EXCEPTION ÜZERİNDEN gider —
        # `response`'a yazılan başlıklar hata yanıtında kaybolur.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Oturum süresi doldu, lütfen tekrar giriş yap.",
            headers={"WWW-Authenticate": "Bearer", **clear_refresh_cookie_headers()},
        )
    role_id, user_id, new_refresh, persistent = result
    model = _MODEL_BY_ROLE_ID.get(role_id)
    user = await db.get(model, user_id) if model else None
    if user is None or user.deleted_at is not None or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Hesap bulunamadı veya pasif",
            headers=clear_refresh_cookie_headers(),
        )
    access = create_access_token(
        subject=user.id,
        role=role_name(role_id),
        role_id=role_id,
        auth_version=getattr(user, "auth_version", None),
    )
    await db.commit()
    # "Beni hatırla" tercihi token zincirinden gelir: gelen çerezin kalıcı mı
    # oturumluk mu olduğu HTTP'de görünmez, dolayısıyla isteğe bakarak doğru
    # ömrü seçmek mümkün değil (bkz. refresh_token_service.rotate).
    set_refresh_cookie(response, new_refresh, remember=persistent)
    return Token(access_token=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
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
    # Refresh token'ı da kalıcı olarak geçersiz kıl ve çerezi sil. İkisi de
    # gerekli: yalnız çerezi silmek, token'ı DB'de geçerli bırakırdı (kopyası
    # alınmışsa hâlâ kullanılabilirdi); yalnız revoke etmek ise tarayıcıda ölü
    # bir çerez bırakırdı.
    raw = get_refresh_cookie(request)
    if raw:
        await refresh_token_service.revoke(db, raw_token=raw)
    clear_refresh_cookie(response)


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
async def read_me(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    name_change_service.annotate_change_locks(user, user.role_id)
    if isinstance(user, Admin):
        from services import admin_access_service

        role_code, permissions = await admin_access_service.get_admin_access(db, user.id)
        user.admin_role_code = role_code
        user.admin_permissions = sorted(permissions)
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


@router.get("/me/name-change-requests", response_model=list[NameChangeRequestOut])
async def my_name_change_requests(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Kullanıcının kendi ad/kullanıcı adı değişiklik talepleri (durumlarıyla)."""
    return await name_change_service.list_for_user(
        db, user_id=user.id, role_id=user.role_id
    )


@router.post(
    "/me/phone",
    response_model=PhoneRequestResult,
    dependencies=[Depends(_sms_limit)],
)
async def request_phone_otp(
    payload: PhoneUpdate,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Telefon numarasını kaydeder ve SMS ile OTP gönderir (yeniden gönderim için de
    bu uç çağrılır). Geliştirmede kod backend loglarında görünür."""
    masked = await phone_service.request_otp(db, user, payload.phone)
    return PhoneRequestResult(phone_masked=masked)


@router.post("/me/phone/verify", response_model=UserOut)
async def verify_phone_otp(
    payload: PhoneOtpVerify,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await phone_service.verify_otp(db, user, payload.code)
    return user


@router.post("/me/password", response_model=Token)
async def change_my_password(
    payload: PasswordChange,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Şifreyi değiştirir ve DİĞER tüm oturumları kapatır.

    ``change_password`` kullanıcının tüm refresh token'larını iptal eder (çalınmış
    bir token şifre değişiminden sonra da geçerli kalmasın diye). İşlemi yapan
    cihazın atılmaması için burada yeni bir oturum üretilir: access token gövdede,
    refresh token çerezde döner.
    """
    # Tercih, token'lar iptal edilmeden ÖNCE okunur: change_password kullanıcının
    # tüm refresh token'larını revoke eder ve sonrasında eski çerezin kaydı
    # "geçerli" aramasında bulunamaz.
    persistent = await refresh_token_service.is_persistent(
        db, raw_token=get_refresh_cookie(request)
    )
    await auth_service.change_password(
        db,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    access = create_access_token(
        subject=user.id,
        role=role_name(user.role_id),
        role_id=user.role_id,
        auth_version=getattr(user, "auth_version", None),
    )
    refresh = await refresh_token_service.issue(
        db, role_id=user.role_id, user_id=user.id, persistent=persistent
    )
    await db.commit()
    set_refresh_cookie(response, refresh, remember=persistent)
    return Token(access_token=access)


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


# ── KVKK: veri taşınabilirliği (m.20) ve silme hakkı (m.7/m.11) ─────────────
# `legalContent.ts` kullanıcıya silme taahhüdü veriyordu ama karşılığı olan uç
# yoktu; tek yol admin'in soft-delete'iydi ve soft-delete SİLME DEĞİLDİR.


@router.get("/me/data-export")
async def export_my_data(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Kullanıcının kendi verisinin makine-okunur dökümü (KVKK m.20)."""
    data = await account_deletion_service.export_personal_data(db, user)
    filename = f"verilerim-{user.role_id}-{user.id}.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/me/deletion-eligibility")
async def my_deletion_eligibility(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Hesap şu an silinebilir mi? (Arayüz butonu bunu önceden sorar.)"""
    ok, reason = await account_deletion_service.can_delete(db, user)
    return {"can_delete": ok, "reason": reason}


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    payload: AccountDeleteRequest,
    user: CurrentUser = Depends(get_current_active_user),
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Hesabı anonimleştirir ve kapatır (geri alınamaz).

    Parola yeniden istenir: oturumu ele geçiren birinin hesabı yok etmesini
    zorlaştırır. Mali kayıtlar (sipariş/ödeme) mevzuat gereği SİLİNMEZ; yalnız
    kimlik/iletişim verisi geri döndürülemez biçimde temizlenir.
    """
    if not await verify_password_async(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parola hatalı")

    ok, reason = await account_deletion_service.can_delete(db, user)
    if not ok:
        raise HTTPException(status.HTTP_409_CONFLICT, reason or "Hesap şu an silinemez")

    orphan_files = await account_deletion_service.anonymize_account(db, user)
    await db.commit()

    # Depo silme commit SONRASI ve best-effort (İP-3 §3 açık kararı): DB
    # referansı zaten temizlendi; silme başarısız kalırsa işlem geri alınmaz,
    # yetim nesne ayrı temizlik görevine kalır.
    for key in orphan_files:
        await delete_file(key)

    # Mevcut access token'ı da anında iptal et (refresh'ler zaten revoke edildi).
    try:
        payload_jwt = decode_access_token(token)
        await revoke(payload_jwt.get("jti"), payload_jwt.get("exp"))
    except Exception:  # noqa: BLE001 — silme başarılı, iptal best-effort
        logger.warning("hesap silme: access token iptal edilemedi", exc_info=True)
