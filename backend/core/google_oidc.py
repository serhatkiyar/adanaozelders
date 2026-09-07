"""Google'ın ``id_token``'ını doğrular. DB bilmez, oturum bilmez — saf sınır.

## Neden `google-auth` değil

Doğrulama için gereken her şey depoda zaten var: ``pyjwt`` (RS256 + ``PyJWKSet``),
``cryptography`` (RSA) ve ``httpx``. ``google-auth`` eklemek dört yeni bağımlılık
(``rsa``, ``pyasn1``, ``pyasn1-modules``, ``cachetools``) getirir ve karşılığında
aynı işi yapar. Kök CLAUDE.md gereksiz soyutlama/bağımlılık istemiyor.

## Neden imza doğrulaması atlanmıyor

OIDC Core §3.1.3.7, token'ı doğrudan token endpoint'inden TLS üzerinden alan bir
istemcinin imza doğrulamasını atlayabileceğini söyler. Bu muafiyete
DAYANILMIYOR: maliyeti bir JWKS isteği (önbellekli), kazancı ise sağlayıcı
yanıtına duyulan güvenin tek dayanak olmaktan çıkması. ``aud``/``iss``/``nonce``
zaten denetleniyor; imza onların üstüne konan dördüncü kilit.

## Fail-CLOSED

JWKS çekilemezse doğrulama BAŞARISIZ olur, giriş reddedilir. Buradaki fail-open
"imzayı doğrulayamadım, yine de kabul ediyorum" demek olurdu.
"""
from __future__ import annotations

import logging
import time

import httpx
import jwt

from core.config import settings

logger = logging.getLogger("adana.google_oidc")

#: Google'ın imza anahtarları. Sabit adres, ``kid`` ile seçim yapılır.
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

#: Kabul edilen ``iss`` değerleri. Google tarihsel olarak ikisini de üretir.
GECERLI_ISS = ("accounts.google.com", "https://accounts.google.com")

#: Yalnız RS256. Allowlist YAZILMADAN `jwt.decode` çağrılırsa saldırgan `alg`'i
#: HS256'ya çevirip public anahtarı HMAC sırrı gibi kullanabilir (anahtar
#: karışıklığı); `alg: none` ise imzayı tümden atlatır.
IZINLI_ALG = ["RS256"]

#: Saat kaymasına tolerans. Google'ın `iat`'ı bizim saatimizden birkaç saniye
#: ileri olabilir; tolerans olmadan geçerli token'lar reddedilirdi.
LEEWAY_SANIYE = 60

_TIMEOUT = httpx.Timeout(10.0)
#: Anahtar seti + geçerlilik sonu. Google `Cache-Control: max-age` gönderir;
#: onu okuyup kendi TTL'imizle sınırlarız.
_jwks_onbellek: tuple[float, jwt.PyJWKSet] | None = None
_VARSAYILAN_TTL = 3600.0
_EN_UZUN_TTL = 24 * 3600.0

_client: httpx.AsyncClient | None = None


class GoogleKimlikHatasi(Exception):
    """Token doğrulanamadı. Mesaj LOG içindir, kullanıcıya gösterilmez.

    Çağıran tek tip bir hata döndürmelidir: hangi denetimin düştüğünü söylemek
    (``aud`` mu, ``nonce`` mı, süre mi) saldırgana geri bildirim verir.
    """


def _http() -> httpx.AsyncClient:
    """Paylaşılan istemci (keep-alive) — geocode_service ile aynı desen."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def onbellegi_temizle() -> None:
    """Testler için. Süreç içi anahtar setini düşürür."""
    global _jwks_onbellek
    _jwks_onbellek = None


def _ttl_hesapla(yanit: httpx.Response) -> float:
    """`Cache-Control: max-age` değerini makul sınırlar içinde kullanır."""
    ham = yanit.headers.get("cache-control", "")
    for parca in ham.split(","):
        parca = parca.strip()
        if parca.startswith("max-age="):
            try:
                return min(max(float(parca[len("max-age="):]), 0.0), _EN_UZUN_TTL)
            except ValueError:
                break
    return _VARSAYILAN_TTL


async def _jwks(*, zorla_tazele: bool = False) -> jwt.PyJWKSet:
    global _jwks_onbellek
    simdi = time.monotonic()
    if not zorla_tazele and _jwks_onbellek is not None:
        gecerli_son, kume = _jwks_onbellek
        if simdi < gecerli_son:
            return kume
    try:
        yanit = await _http().get(JWKS_URL)
        yanit.raise_for_status()
        kume = jwt.PyJWKSet.from_dict(yanit.json())
    except Exception as exc:  # ağ, HTTP, JSON, biçim — hepsi aynı sonuç
        raise GoogleKimlikHatasi(f"JWKS alınamadı: {exc}") from exc
    _jwks_onbellek = (simdi + _ttl_hesapla(yanit), kume)
    return kume


async def _imza_anahtari(kid: str) -> jwt.PyJWK:
    """`kid` ile anahtarı seçer; bulunamazsa BİR KEZ tazeler.

    Google anahtarlarını düzenli döndürür. Tazeleme olmasaydı her rotasyondan
    sonra girişler önbellek TTL'i dolana kadar (bir saate kadar) ölürdü.
    """
    for zorla in (False, True):
        kume = await _jwks(zorla_tazele=zorla)
        for anahtar in kume.keys:
            if anahtar.key_id == kid:
                return anahtar
    raise GoogleKimlikHatasi(f"JWKS'te {kid!r} kimlikli anahtar yok")


async def verify_id_token(ham_token: str, *, nonce: str) -> dict:
    """``id_token``'ı doğrular ve claim'leri döner. Her hata tek tip istisna.

    Denetlenenler: imza (RS256 + JWKS), ``aud``, ``iss``, ``exp``/``iat``,
    ``nonce`` ve ``email_verified``.

    ``email_verified`` bir GÜVENLİK kapısıdır, kolaylık değil: doğrulanmamış bir
    e-postayla mevcut hesaba bağlanmak, o adresi yazabilen herkese hesabı
    devretmek demektir.
    """
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise GoogleKimlikHatasi("GOOGLE_OAUTH_CLIENT_ID tanımsız")

    try:
        baslik = jwt.get_unverified_header(ham_token)
    except jwt.PyJWTError as exc:
        raise GoogleKimlikHatasi(f"token başlığı okunamadı: {exc}") from exc

    # `alg`ı anahtarı ARAMADAN ÖNCE denetle: `none` durumunda `kid` bile olmaz.
    if baslik.get("alg") not in IZINLI_ALG:
        raise GoogleKimlikHatasi(f"beklenmeyen alg: {baslik.get('alg')!r}")
    kid = baslik.get("kid")
    if not kid:
        raise GoogleKimlikHatasi("token `kid` taşımıyor")

    anahtar = await _imza_anahtari(kid)

    try:
        claims = jwt.decode(
            ham_token,
            anahtar.key,
            algorithms=IZINLI_ALG,
            audience=settings.GOOGLE_OAUTH_CLIENT_ID,
            issuer=list(GECERLI_ISS),
            leeway=LEEWAY_SANIYE,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise GoogleKimlikHatasi(f"token doğrulanamadı: {exc}") from exc

    # `nonce` OIDC replay korumasıdır: yetkilendirme isteğinde ürettiğimiz değer
    # token içinde geri gelir. `secrets.compare_digest` gerekmiyor -- nonce gizli
    # bir sır değil, tek kullanımlık bir eşleştirme etiketidir; ayrıca karşılığı
    # zaten imzalı çerezden gelir.
    if not nonce or claims.get("nonce") != nonce:
        raise GoogleKimlikHatasi("nonce eşleşmedi")

    if claims.get("email_verified") is not True:
        raise GoogleKimlikHatasi("Google e-postayı doğrulanmış bildirmedi")
    if not claims.get("email"):
        raise GoogleKimlikHatasi("token e-posta taşımıyor")

    return claims
