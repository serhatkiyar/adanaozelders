"""Google ile giriş — yetkilendirme isteği, kod takası, kimlik çözümleme.

## Akışın biçimi ve nedeni

Sunucu tarafı **authorization code + PKCE**, tam sayfa yönlendirme. Google'ın
tarayıcı kütüphanesi (GSI / One Tap) bilerek kullanılmıyor: o script sayfa
açılır açılmaz Google'a istek atar, yani kullanıcı hiçbir onay vermeden üçüncü
tarafa veri gider. Bu deponun KVKK kararına ters (`frontend
__guards__/disFont.test.ts`) ve CSP'deki `script-src 'self'`i de delerdi
(`frontend/nginx-security-headers.conf`). Bu akışta güvenlik başlıklarına hiç
dokunulmaz: yönlendirme, form gönderimi değildir.

## `state` neden imzalı çerezde

`state` parametresine YALNIZ rastgele bir `csrf` değeri konur. Dönüş adresi,
rol ve onay sürümü Google'a hiç gitmez (sağlayıcının loguna ve Referer'a
düşmez); imzalı, httpOnly, tek kullanımlık bir çerezde taşınır.

Redis reddedildi: `core/ratelimit.py` Redis'i bilinçli olarak **fail-open**
kullanıyor. State doğrulaması fail-open olamaz, Redis düştüğünde girişin tümden
ölmesi de kabul edilemez. Çerez ikisini birden çözer ve altyapı gerektirmez.

Verinin URL'de taşındığı "kendi kendine yeten JWT state" de reddedildi: tarayıcıya
bağlanmadığı için login CSRF'i (saldırganın kurbanı KENDİ Google hesabıyla
oturum açtırması) açık kalırdı.
"""
from __future__ import annotations

import datetime
import hashlib
import base64
import logging
import secrets
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.oauth_identity import OAuthIdentity
from models.role import RoleType
from services import auth_service, refresh_token_service

logger = logging.getLogger("adana.google_oauth")

YETKILENDIRME_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SAGLAYICI = "google"

#: `state` çerezinin adı ve yolu. Yol refresh çereziyle aynı: yalnız kimlik
#: uçlarına gönderilir, her API isteğinde ağda dolaşmaz.
STATE_COOKIE = "g_oauth_state"
STATE_COOKIE_PATH = "/api/v1/auth"

#: Çerezin içindeki JWT'nin türü. `JWT_SECRET_KEY` access token ile ORTAK
#: olduğundan bu alan zorunlu: olmasaydı bir access token state olarak
#: sunulabilirdi.
STATE_TYP = "google_oauth_state"

#: Kayıt akışında kabul edilen roller. ADMIN/COURIER/LIBRARY_OPERATOR burada
#: YOKTUR: onların self-servis kaydı zaten yok (admin oluşturur).
IZINLI_ROLLER = {"client": RoleType.CLIENT, "tutor": RoleType.TUTOR}

IZINLI_MODLAR = {"giris", "kayit"}

#: Dönüş yolunun üst sınırı. Uzunluk kendi başına bir saldırı değil ama
#: sınırsız bir değeri imzalı çerezde taşımak başlık boyutunu şişirir.
DONUS_MAX = 512


class OAuthAkisHatasi(Exception):
    """Akış güvenli biçimde tamamlanamadı.

    ``kod`` kullanıcıya gösterilecek mesajı SEÇER ama mesajın kendisi değildir:
    hangi denetimin düştüğünü ayrıntısıyla söylemek saldırgana geri bildirim
    verir. Frontend bu kodu bilinen bir metne çevirir.
    """

    def __init__(self, kod: str, detay: str = ""):
        super().__init__(detay or kod)
        self.kod = kod


# ── Donus yolu (acik yonlendirme korumasi) ───────────────────────────────────


def guvenli_donus_yolu(deger: str | None) -> str | None:
    """Kullanıcıyı geri göndereceğimiz SİTE İÇİ yolu doğrular.

    Kabul: tek ``/`` ile başlayan, şema/konak taşımayan, satır sonu içermeyen
    kısa bir yol. Reddedilenlerin her biri gerçek bir saldırı biçimidir:

    ``//evil.com``   Tarayıcı bunu protokol-göreli MUTLAK adres sayar. En sık
                     kaçırılan açık yönlendirme biçimi budur.
    ``/\\evil.com``   Bazı tarayıcılar ters bölüyü bölü gibi çözümler.
    ``https://...``  Düpedüz dış adres.
    ``\\r\\n``         Başlık enjeksiyonu (yanıt bölme).
    ``/api/...``     Site içi ama kullanıcı yüzeyi değil; oraya yönlendirmek
                     ham JSON gösterir.

    İlk yazımda bir de "iki nokta içeremez" kuralı vardı (şema engeli niyetiyle).
    ÖLÇÜLDÜ ve kaldırıldı: tek başına yakaladığı üç girdinin üçü de zararsız
    göreli yoldu, buna karşılık MEŞRU adresleri sessizce düşürüyordu —
    ``/takvim?aralik=09:00-17:00`` gibi saat taşıyan her query string. Şemayı
    zaten "tek ``/`` ile başlamalı" kuralı imkânsız kılıyor: ``javascript:``,
    ``https://`` ve ``data:`` bölüyle başlamadıkları için daha ilk adımda düşer.
    Ölçmeyen ama zarar veren bir kural, yanlış güven verir.

    ``None`` döner ve çağıran varsayılana düşer — akış hata ile KESİLMEZ:
    bozuk bir dönüş adresi kullanıcının girişini engellememeli.
    """
    if not deger or not isinstance(deger, str):
        return None
    if len(deger) > DONUS_MAX:
        return None
    if any(k in deger for k in ("\r", "\n", "\t", " ", "\x00")):
        return None
    if not deger.startswith("/"):
        return None
    if deger.startswith("//") or deger.startswith("/\\"):
        return None
    if deger == "/api" or deger.startswith("/api/"):
        return None
    return deger


# ── State cerezi ─────────────────────────────────────────────────────────────


def _state_yaz(response: Response, veri: dict) -> None:
    simdi = datetime.datetime.now(datetime.timezone.utc)
    token = jwt.encode(
        {
            **veri,
            "typ": STATE_TYP,
            "iat": simdi,
            "exp": simdi
            + datetime.timedelta(seconds=settings.GOOGLE_OAUTH_STATE_TTL_SECONDS),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    response.set_cookie(
        key=STATE_COOKIE,
        value=token,
        httponly=True,
        secure=settings.is_production,
        # `lax` ZORUNLU: `strict` olsaydı Google'dan dönen üst düzey gezinmede
        # çerez GÖNDERİLMEZ ve akış her seferinde "süresi doldu" ile ölürdü.
        # Aynı gerekçe core/cookies.py'de de yazılı.
        samesite="lax",
        path=STATE_COOKIE_PATH,
        max_age=settings.GOOGLE_OAUTH_STATE_TTL_SECONDS,
    )


def state_sil(response: Response) -> None:
    """Çerezi düşürür. Silme ancak aynı ``path`` ile yapılırsa tutar."""
    response.delete_cookie(key=STATE_COOKIE, path=STATE_COOKIE_PATH)


def _state_oku(request: Request) -> dict:
    ham = request.cookies.get(STATE_COOKIE)
    if not ham:
        raise OAuthAkisHatasi("suresi_doldu", "state çerezi yok")
    try:
        veri = jwt.decode(
            ham,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise OAuthAkisHatasi("suresi_doldu", f"state çözülemedi: {exc}") from exc
    if veri.get("typ") != STATE_TYP:
        # Access token'lar aynı sırla imzalanıyor; tür alanı olmasaydı bir
        # access token state yerine geçirilebilirdi.
        raise OAuthAkisHatasi("dogrulama", "state türü beklenenden farklı")
    return veri


# ── Yetkilendirme istegi ─────────────────────────────────────────────────────


def _pkce_challenge(verifier: str) -> str:
    ozet = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(ozet).rstrip(b"=").decode("ascii")


def yetkilendirme_baslat(
    response: Response,
    *,
    mod: str,
    rol: str | None,
    donus: str | None,
    onay_surumu: str | None,
    hatirla: bool,
) -> str:
    """`state` çerezini yazar ve Google'a gidilecek adresi döner.

    PKCE (S256) confidential client için zorunlu değil ama uygulanıyor: maliyeti
    birkaç satır, kazancı yetkilendirme kodunun araya girilerek (kötü niyetli
    eklenti, loga düşen redirect, yanlış yapılandırılmış proxy) başka bir
    istemcide kullanılamaması. OAuth 2.1 bunu her istemci için öneriyor.
    """
    if mod not in IZINLI_MODLAR:
        raise OAuthAkisHatasi("dogrulama", f"bilinmeyen mod: {mod!r}")
    if mod == "kayit" and rol not in IZINLI_ROLLER:
        raise OAuthAkisHatasi("dogrulama", f"bilinmeyen rol: {rol!r}")

    csrf = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)

    _state_yaz(
        response,
        {
            "csrf": csrf,
            "nonce": nonce,
            "verifier": verifier,
            "mod": mod,
            "rol": rol if mod == "kayit" else None,
            "onay_surumu": onay_surumu if mod == "kayit" else None,
            "donus": guvenli_donus_yolu(donus),
            "hatirla": bool(hatirla),
        },
    )

    return YETKILENDIRME_URL + "?" + urlencode(
        {
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "state": csrf,
            "nonce": nonce,
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
            # Google'ın refresh token'ını istemiyoruz: Google API'lerine kullanıcı
            # adına çağrı yapmıyoruz, yalnız kimliği öğreniyoruz. İstenseydi
            # saklanması ve korunması gereken yeni bir sır doğardı.
            "access_type": "online",
            "prompt": "select_account",
        }
    )


# ── Kod takasi ───────────────────────────────────────────────────────────────


_TIMEOUT = httpx.Timeout(10.0)
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def kodu_takas_et(code: str, *, verifier: str) -> str:
    """Yetkilendirme kodunu ``id_token`` ile değiştirir. Ham token döner."""
    try:
        yanit = await _http().post(
            TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
                "code_verifier": verifier,
            },
        )
        yanit.raise_for_status()
        govde = yanit.json()
    except Exception as exc:
        logger.warning("Google kod takası başarısız: %s", exc)
        raise OAuthAkisHatasi("saglayici", f"kod takası: {exc}") from exc

    ham = govde.get("id_token")
    if not ham:
        raise OAuthAkisHatasi("saglayici", "yanıtta id_token yok")
    return ham


# ── Kimlik cozumleme ─────────────────────────────────────────────────────────


def _ad_soyad(claims: dict) -> tuple[str, str]:
    """Ad/soyad üretir. Boş bırakılamaz: ``NameMixin`` iki alanı da NOT NULL.

    Google `given_name`/`family_name` göndermeyebilir (bazı hesaplarda yalnız
    `name` vardır, kurumsal hesaplarda hiçbiri olmayabilir). Kullanıcı bunları
    sonradan `/ayarlar`dan düzeltebilir; kayıt anında akışı kesmek yanlış olur.
    """
    ad = (claims.get("given_name") or "").strip()
    soyad = (claims.get("family_name") or "").strip()
    if not ad and not soyad:
        tam = (claims.get("name") or "").strip()
        if tam:
            parcalar = tam.split()
            ad = parcalar[0]
            soyad = " ".join(parcalar[1:])
    if not ad:
        ad = (claims.get("email") or "kullanici").split("@", 1)[0][:75] or "Kullanıcı"
    if not soyad:
        soyad = "-"
    return ad[:75], soyad[:75]


async def _kimlik_bul(db: AsyncSession, subject: str) -> OAuthIdentity | None:
    stmt = select(OAuthIdentity).where(
        OAuthIdentity.provider == SAGLAYICI, OAuthIdentity.subject == subject
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _kimlik_bagla(db: AsyncSession, user, *, subject: str, email: str) -> None:
    db.add(
        OAuthIdentity(
            provider=SAGLAYICI,
            subject=subject,
            role_id=user.role_id,
            user_id=user.id,
            email=email,
        )
    )
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError as exc:
        # `uq_oauth_identities_provider_user`: bu hesaba zaten BAŞKA bir Google
        # hesabı bağlı. Sessizce ikinci bir bağ eklemek "hangi Google hesabı bu
        # hesabı açar" sorusunu cevapsız bırakırdı.
        raise OAuthAkisHatasi("baska_google_bagli", str(exc)) from exc


async def cozumle(
    db: AsyncSession,
    claims: dict,
    *,
    mod: str,
    rol: str | None,
    onay_surumu: str | None,
    ip: str | None,
    user_agent: str | None,
    kayit_kapisi,
) -> tuple[object, str]:
    """Google claim'lerinden oturum açılacak kullanıcıyı bulur ya da yaratır.

    Üç kol var ve sırası önemli:

    1. **Kimlik zaten bağlı** — en sık yol. `sub` ile bulunur; e-posta
       değişmişse yalnız iz güncellenir, kullanıcının kendi ``email``i ASLA
       değiştirilmez (ÜK-5 tekilliği ve hesap devri riski).
    2. **E-posta eşleşiyor** — otomatik bağlama (ürün kararı). Google
       ``email_verified`` döndüğü için adresin sahibi kanıtlanmıştır.
    3. **Hiçbiri** — yalnız ``mod="kayit"`` ise yeni hesap açılır. ``mod="giris"``
       hesap AÇMAZ: giriş düğmesine basan kişi hesabı olduğunu sanıyordur;
       sessizce ikinci bir hesap yaratmak onu kendi verisinden ayırır.

    ``kayit_kapisi`` çağrılabilir olarak dışarıdan gelir (router'daki
    ``_kayit_kapisi``): servisin router'a ters bağımlılığı olmasın diye.
    """
    subject = claims["sub"]
    email = (claims.get("email") or "").strip().lower()

    kimlik = await _kimlik_bul(db, subject)
    if kimlik is not None:
        model = auth_service.MODEL_BY_ROLE_ID.get(kimlik.role_id)
        user = await db.get(model, kimlik.user_id) if model else None
        if user is None or user.deleted_at is not None:
            raise OAuthAkisHatasi("hesap_yok", "bağlı hesap silinmiş")
        if not user.is_active:
            raise OAuthAkisHatasi("pasif", "hesap pasif")
        if kimlik.email != email:
            kimlik.email = email
        return user, "giris"

    user = await auth_service.find_by_email(db, email=email)
    if user is not None:
        if not user.is_active:
            raise OAuthAkisHatasi("pasif", "hesap pasif")
        await _kimlik_bagla(db, user, subject=subject, email=email)
        # E-postası HİÇ doğrulanmamış bir hesaba bağlanıyorsak: o hesabı
        # doğrulanmamış bir adresle açan kişi adresin sahibi olmayabilir.
        # Adresin gerçek sahibi Google ile kanıtlayıp geldiğinde kanıtsız
        # oturumlar düşer (auth_version + refresh iptali).
        if getattr(user, "email_verified_at", None) is None:
            user.email_verified_at = datetime.datetime.now(datetime.timezone.utc)
            user.auth_version = int(user.auth_version or 0) + 1
            await db.flush()
            await refresh_token_service.revoke_all_for_user(
                db, role_id=user.role_id, user_id=user.id
            )
        return user, "baglandi"

    if mod != "kayit":
        raise OAuthAkisHatasi("hesap_yok", "giriş modunda hesap açılmaz")

    # Kayıt kapısı BURADA tekrar denetlenir: `start` ile `callback` arasında
    # admin bayrağı kapatmış olabilir ve o pencere Google'ın ekranında geçen
    # süre kadar geniştir.
    await kayit_kapisi(db)

    rol_tipi = IZINLI_ROLLER.get(rol or "")
    if rol_tipi is None:
        raise OAuthAkisHatasi("dogrulama", f"kayıt için geçersiz rol: {rol!r}")

    ad, soyad = _ad_soyad(claims)
    try:
        user = await auth_service.register_google_user(
            db, rol=rol_tipi, email=email, first_name=ad, last_name=soyad
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_409_CONFLICT:
            # `find_by_email` ile bu nokta arasında aynı e-posta kaydolmuş
            # (yarış). Yeni hesap açmak yerine mevcuda bağlanmak doğru sonuç.
            mevcut = await auth_service.find_by_email(db, email=email)
            if mevcut is not None:
                await _kimlik_bagla(db, mevcut, subject=subject, email=email)
                return mevcut, "baglandi"
        raise

    await _kimlik_bagla(db, user, subject=subject, email=email)

    # KVKK ispat kaydı: kullanıcı onay kutusunu Kayıt ekranında işaretledi ve
    # sürüm imzalı state çerezinde taşındı. Kayıt olmadan hesap açılamaz.
    from services import consent_service

    await consent_service.record_signup_consents(
        db,
        user_id=user.id,
        role_id=user.role_id,
        doc_version=onay_surumu,
        ip=ip,
        user_agent=user_agent,
    )
    return user, "kayit"


__all__ = [
    "OAuthAkisHatasi",
    "STATE_COOKIE",
    "STATE_COOKIE_PATH",
    "aclose",
    "cozumle",
    "guvenli_donus_yolu",
    "kodu_takas_et",
    "state_sil",
    "yetkilendirme_baslat",
    "_state_oku",
]
