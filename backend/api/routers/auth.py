from __future__ import annotations

import datetime
import logging
import re
import secrets
from urllib.parse import urlencode

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
from fastapi.responses import JSONResponse, RedirectResponse
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
from core import flags
from core.ratelimit import client_ip, enforce, rate_limit
from core.security import (
    create_access_token,
    decode_access_token,
    verify_password_async,
)
from core import google_oidc
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
_oauth_limit = rate_limit(
    key="oauth",
    limit=settings.RATE_LIMIT_LOGIN,
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
    google_oauth_service,
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

#: Onay sürümü biçimi — `schemas/auth.py::RegisterRequest.consent_version`
#: ile AYNI kural. Google kolunda gövde şeması yok (parametreler query
#: string'de geldiği için Pydantic doğrulaması devreye girmez), o yüzden
#: aynı denetim burada elle yapılır.
_ONAY_SURUM_BICIMI = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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


async def _kayit_kapisi(db: AsyncSession) -> None:
    """Yeni üye kaydı bayrağı (admin panelinden yönetilir, 30 Ağu).

    `is_enabled` fail-CLOSED'dır: bayrak okunamazsa kayıt KAPALI kabul edilir,
    yanlışlıkla halka açık kayıt almaktan iyidir. Girişler etkilenmez.
    """
    if not await flags.is_enabled(db, flags.FLAG_REGISTRATION_OPEN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Yeni üye kaydı şu anda kapalı.",
        )


@router.get("/register/open")
async def registration_open(db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    """Public: kayıt açık mı? Frontend 'Kayıt Ol' düğmelerini buna göre gizler."""
    return {"open": await flags.is_enabled(db, flags.FLAG_REGISTRATION_OPEN)}


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
    await _kayit_kapisi(db)
    tutor = await auth_service.register_tutor(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
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
    await _kayit_kapisi(db)
    client = await auth_service.register_client(
        db,
        email=payload.email,
        password=payload.password,
        first_name=payload.first_name,
        last_name=payload.last_name,
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


# ── Google ile giriş ─────────────────────────────────────────────────────────
#
# Uçlar AYRI BİR ROUTER'a taşınmadı: `_kayit_kapisi`, `_record_signup_consents`
# ve rate-limit tanımları bu dosyada yaşıyor; hepsini taşımak tek kullanımlık
# bir soyutlama üretirdi (backend/CLAUDE.md). `api/router.py` bu yüzden
# değişmiyor — uçlar mevcut `auth.router` (prefix `/auth`) altında.


def _google_acik_mi() -> None:
    """Yapılandırılmamışsa 404.

    403 DEĞİL: 403 "burada bir uç var ama izin yok" der ve özelliğin varlığını
    sızdırır. Kapalıyken uç hiç yokmuş gibi davranır.
    """
    if not settings.GOOGLE_OAUTH_ENABLED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")


def _google_donus(kod: str, *, git: str | None, mod: str | None) -> RedirectResponse:
    """Kullanıcıyı frontend'in dönüş sayfasına gönderir.

    Hata da başarı da AYNI sayfaya döner ve yalnız bir KOD taşınır; kullanıcıya
    gösterilecek metni frontend seçer. Hangi denetimin düştüğünü ayrıntısıyla
    söylemek saldırgana geri bildirim verirdi.

    Hedef her zaman `FRONTEND_BASE_URL` + göreli yol olarak kurulur; `git`
    değeri imzalı çerezden gelir ve çereze yazılmadan önce doğrulanmıştır
    (`google_oauth_service.guvenli_donus_yolu`).
    """
    parametreler = {"durum": kod}
    if git:
        parametreler["git"] = git
    if mod:
        parametreler["mod"] = mod
    hedef = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}"
        f"/google-donus?{urlencode(parametreler)}"
    )
    # 303: tarayıcı hedefe GET ile gitsin.
    return RedirectResponse(hedef, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/oauth/providers")
async def oauth_saglayicilari() -> dict:
    """Public: hangi sosyal giriş açık ve akış NEREDEN başlatılır?

    Frontend tarafı bilinçli olarak FAIL-CLOSED okur (`useKayitAcik`in
    fail-open'ının tersi): yapılandırılmamış bir sağlayıcının düğmesi
    kullanıcıyı 404'e götürürdü.

    `google_start_url` MUTLAK adrestir ve bu ZORUNLU — ölçülmüş bir kusurun
    düzeltmesi. Düğme önce göreli adres (`/api/v1/auth/google/start`)
    kullanıyordu; geliştirmede tarayıcı o adrese Vite dev sunucusu üzerinden
    gidiyor ve Vite'ın proxy'si dış bir siteye (accounts.google.com) giden
    303'ü iletemeyip **500** üretiyordu. Akış bir XHR değil, tam sayfa
    gezinmedir: proxy'ye hiç uğramamalı, doğrudan API köküne gitmeli.

    Kök `BACKEND_BASE_URL`den türetilir — `GOOGLE_OAUTH_REDIRECT_URI` ile aynı
    kaynak, dolayısıyla ikisi hiçbir ortamda ayrışamaz. Üretimde ön yüz ve API
    zaten aynı origin'de olduğu için değer orada da doğrudur.
    """
    return {
        "google": settings.GOOGLE_OAUTH_ENABLED,
        "google_start_url": (
            f"{settings.BACKEND_BASE_URL.rstrip('/')}"
            f"{settings.API_V1_PREFIX}/auth/google/start"
            if settings.GOOGLE_OAUTH_ENABLED
            else None
        ),
    }


@router.get("/google/start", dependencies=[Depends(_oauth_limit)])
async def google_start(
    mod: str = "giris",
    rol: str | None = None,
    donus: str | None = None,
    onay_surumu: str | None = None,
    hatirla: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """Google'ın onay ekranına yönlendirir; `state` çerezini yazar."""
    _google_acik_mi()

    if mod == "kayit":
        # Kapı burada VE callback'te denetlenir. Buradaki denetim kullanıcıyı
        # boşuna Google'a göndermemek için; asıl kilit callback'tekidir, çünkü
        # aradaki pencere kullanıcının Google ekranında geçirdiği süre kadar
        # geniştir ve admin o sırada kaydı kapatmış olabilir.
        await _kayit_kapisi(db)
        # Onay sürümü kayıt uçlarıyla AYNI biçimde doğrulanır (RegisterRequest).
        # Gevşek bırakmak KVKK ispat kaydına çöp yazardı.
        if not onay_surumu or not _ONAY_SURUM_BICIMI.match(onay_surumu):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Onay sürümü geçersiz."
            )

    tasiyici = Response()
    try:
        hedef = google_oauth_service.yetkilendirme_baslat(
            tasiyici,
            mod=mod,
            rol=rol,
            donus=donus,
            onay_surumu=onay_surumu,
            hatirla=hatirla,
        )
    except google_oauth_service.OAuthAkisHatasi as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Geçersiz istek"
        ) from exc

    yonlendirme = RedirectResponse(hedef, status_code=status.HTTP_303_SEE_OTHER)
    # `state` çerezi `tasiyici` üzerine yazıldı; başlığı yönlendirmeye taşı.
    for anahtar, deger in tasiyici.raw_headers:
        yonlendirme.raw_headers.append((anahtar, deger))
    return yonlendirme


@router.get("/google/callback", dependencies=[Depends(_oauth_limit)])
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Google'dan dönüşü karşılar, oturumu açar ve frontend'e yönlendirir.

    `create_access_token` BURADA ÇAĞRILMAZ, bilinçli: yanıt bir yönlendirmedir
    ve access token'ı URL'de taşımak onu tarayıcı geçmişine, `Referer` başlığına
    ve ara sunucu loglarına yazardı. Yalnız refresh çerezi yazılır; frontend
    dönüş sayfasında mevcut `POST /auth/refresh` ile access token'ını alır.

    Yan etkisi de doğru yönde: yeni bir token üretim yolu doğmadığı için
    `tests/test_auth_version_token_contract.py` envanteri büyümüyor ve
    `auth_version` sözleşmesine yeni bir çağrı yeri eklenmiyor.
    """
    _google_acik_mi()

    try:
        durum = google_oauth_service._state_oku(request)
    except google_oauth_service.OAuthAkisHatasi as exc:
        yanit = _google_donus(exc.kod, git=None, mod=None)
        google_oauth_service.state_sil(yanit)
        return yanit

    git = durum.get("donus")
    mod = durum.get("mod")

    def _bitir(kod: str) -> RedirectResponse:
        yanit = _google_donus(kod, git=git, mod=mod)
        # Çerez HER durumda silinir: tek kullanımlıktır ve aynı `state` ile
        # ikinci bir callback yeniden oynatma (replay) olurdu.
        google_oauth_service.state_sil(yanit)
        return yanit

    if error or not code or not state:
        # Kullanıcı Google ekranında vazgeçti ya da yanıt eksik geldi.
        return _bitir("iptal" if error else "dogrulama")

    if not secrets.compare_digest(state, durum.get("csrf") or ""):
        return _bitir("dogrulama")

    try:
        ham_token = await google_oauth_service.kodu_takas_et(
            code, verifier=durum.get("verifier") or ""
        )
        claims = await google_oidc.verify_id_token(
            ham_token, nonce=durum.get("nonce") or ""
        )
    except google_oauth_service.OAuthAkisHatasi as exc:
        logger.info("google oauth akış hatası: %s", exc)
        return _bitir(exc.kod)
    except google_oidc.GoogleKimlikHatasi as exc:
        logger.warning("google id_token doğrulanamadı: %s", exc)
        return _bitir("dogrulama")

    if mod == "kayit":
        # Yeni hesap açma kolu form kaydıyla AYNI kovayı tüketir; ayrı kova
        # olsaydı Google paralel ve limitsiz bir kayıt kanalı olurdu.
        await enforce(
            bucket=f"rl:register:{client_ip(request)}",
            limit=settings.RATE_LIMIT_REGISTER,
            window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
        )

    try:
        user, olay = await google_oauth_service.cozumle(
            db,
            claims,
            mod=mod or "giris",
            rol=durum.get("rol"),
            onay_surumu=durum.get("onay_surumu"),
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            kayit_kapisi=_kayit_kapisi,
        )
    except google_oauth_service.OAuthAkisHatasi as exc:
        logger.info("google kimlik çözümlenemedi: %s", exc)
        await db.rollback()
        return _bitir(exc.kod)
    except HTTPException as exc:
        await db.rollback()
        return _bitir(
            "kayit_kapali" if exc.status_code == status.HTTP_403_FORBIDDEN else "dogrulama"
        )

    hatirla = bool(durum.get("hatirla", True))
    user.last_seen_at = datetime.datetime.now(datetime.timezone.utc)
    refresh = await refresh_token_service.issue(
        db, role_id=user.role_id, user_id=user.id, persistent=hatirla
    )
    await db.commit()

    # Yeni eğitmen doğrudan ilan sihirbazına düşer — form kaydının davranışı
    # (`Register.tsx`, `AuthModal.tsx`). Google kolu farklı davransaydı aynı
    # ürün kararı iki yerde ayrışırdı.
    hedef = git
    if olay == "kayit" and durum.get("rol") == "tutor":
        hedef = "/ilanini-olustur"

    yanit = _google_donus("ok", git=hedef, mod=mod)
    google_oauth_service.state_sil(yanit)
    set_refresh_cookie(yanit, refresh, remember=hatirla)
    return yanit


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


@router.post(
    "/me/delete/request",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=MessageResponse,
    dependencies=[Depends(_email_limit)],
)
async def request_account_deletion(
    user: CurrentUser = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Parolasız hesap için silme onay bağlantısı yollar.

    Parolalı hesapta çağrılırsa 400: orada onay parola ile veriliyor ve ikinci
    bir yol açmak silme kapısını zayıflatırdı (bkz. `delete_my_account`).
    """
    if user.hashed_password is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bu hesapta silme onayı parola ile veriliyor.",
        )
    # Uygunluk ÖNCE denetlenir: silinemeyecek bir hesap için onay maili yollamak
    # kullanıcıyı boşuna yolculuğa çıkarır (açık siparişi varsa nasılsa 409 alır).
    ok, reason = await account_deletion_service.can_delete(db, user)
    if not ok:
        raise HTTPException(status.HTTP_409_CONFLICT, reason or "Hesap şu an silinemez")

    await verification_service.send_account_delete_confirm(db, user)
    await db.commit()
    return MessageResponse(
        detail="Silme onayı bağlantısı e-posta adresine gönderildi."
    )


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    payload: AccountDeleteRequest,
    user: CurrentUser = Depends(get_current_active_user),
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Hesabı anonimleştirir ve kapatır (geri alınamaz).

    Onay yeniden istenir: oturumu ele geçiren birinin hesabı yok etmesini
    zorlaştırır. Mali kayıtlar (sipariş/ödeme) mevzuat gereği SİLİNMEZ; yalnız
    kimlik/iletişim verisi geri döndürülemez biçimde temizlenir.

    İki kanıt kolu KARŞILIKLI DIŞLAYICIDIR ve hangisinin geçerli olduğunu
    hesabın durumu belirler, isteğin içeriği değil:

    - Parolalı hesap YALNIZ parola kabul eder. Aksi halde parolalı bir hesap
      için de e-posta token'ı istenebilir ve silme, tek bir kanıt sınıfına
      (e-posta kutusu) indirgenirdi.
    - Parolasız (Google) hesap YALNIZ token kabul eder; parola diye bir şeyi
      yoktur ve `verify_password` her denemede `False` döndüğü için kullanıcı
      "parola hatalı" duvarında sıkışırdı.
    """
    if user.hashed_password is not None:
        if not payload.password:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Bu hesap için parola gerekiyor."
            )
        if not await verify_password_async(payload.password, user.hashed_password):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parola hatalı")
    else:
        if not payload.token:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Bu hesapta parola yok. Silme onayı e-posta bağlantısıyla verilir.",
            )
        onaylanan = await verification_service.consume_token(
            db, raw_token=payload.token, purpose=TokenPurpose.ACCOUNT_DELETE
        )
        # Token'ın BAŞKA bir hesaba ait olmadığı ayrıca denetlenir: yalnız
        # "geçerli bir token" aramak, elinde kendi silme bağlantısı olan birinin
        # onu başka bir oturumda kullanmasına izin verirdi.
        if (
            onaylanan is None
            or onaylanan.id != user.id
            or onaylanan.role_id != user.role_id
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Onay bağlantısı geçersiz veya süresi dolmuş.",
            )

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
    # TTL = kalan ömür (logout ile aynı hesap) — `exp` mutlak epoch'tur, doğrudan
    # TTL olarak verilirse Redis anahtarı ~55 yıl yaşar (kaynak sızıntısı).
    try:
        payload_jwt = decode_access_token(token)
        jti, exp = payload_jwt.get("jti"), payload_jwt.get("exp")
        if jti and exp:
            now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            await revoke(jti, max(int(exp) - now, 1))
    except Exception:  # noqa: BLE001 — silme başarılı, iptal best-effort
        logger.warning("hesap silme: access token iptal edilemedi", exc_info=True)
