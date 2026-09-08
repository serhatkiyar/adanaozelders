"""Google `id_token` doğrulaması — imza, aud, iss, exp, nonce, email_verified.

## Bu dosya neden bu paketin en değerli testi

`id_token` bir kimlik iddiasıdır: "bu e-postanın sahibi bu kişi". Doğrulamanın
herhangi bir dalı gevşerse sonuç doğrudan **hesap ele geçirme** olur, ve bu
gevşeme SESSİZDİR — akış çalışmaya devam eder, yalnız artık uydurma token da
kabul edilir. O yüzden burada mutlu yol değil, REDDEDİLMESİ GEREKENLER
çıpalanır.

Ağ yoktur: gerçek bir RSA anahtar çifti üretilir, JWKS `httpx.MockTransport`
ile sunulur. Yani test Google'a bağımlı değildir ve CI'da da koşar.

## Sınır (kök CLAUDE.md → C)

Burada ölçülen `verify_id_token`in kendisidir. Kodun Google ile gerçekten
konuştuğu (redirect URI, kod takası, consent screen) elle doğrulanır; bu dosya
onun yerine geçmez.
"""
from __future__ import annotations

import datetime
import json

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from core import google_oidc
from core.google_oidc import GoogleKimlikHatasi, verify_id_token

ISTEMCI_ID = "test-client-id.apps.googleusercontent.com"
KID = "test-anahtar-1"
NONCE = "n-0S6_WzA2Mj"

#: Claim'i tamamen SİLMEK için işaret (None geçerli bir değer olabileceğinden
#: ayırt edilmesi gerekir).
YOK = object()


@pytest.fixture(scope="module")
def anahtar():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def jwks_govdesi(anahtar):
    pub = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(anahtar.public_key()))
    pub.update({"kid": KID, "use": "sig", "alg": "RS256"})
    return {"keys": [pub]}


@pytest.fixture(autouse=True)
def sahte_google(monkeypatch, jwks_govdesi):
    """Ayarları kurar, JWKS'i sahte ağa bağlar, önbelleği testler arasında sıfırlar.

    Önbellek sıfırlaması ZORUNLU: modül düzeyinde yaşıyor; bir testte doldurulup
    diğerine sızsaydı önbellek testi yalancı yeşil olurdu.
    """
    from core.config import settings

    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ISTEMCI_ID)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-secret")

    sayac = {"n": 0}

    def _isle(request: httpx.Request) -> httpx.Response:
        sayac["n"] += 1
        return httpx.Response(
            200,
            content=json.dumps(jwks_govdesi),
            headers={
                "content-type": "application/json",
                "cache-control": "max-age=3600",
            },
        )

    monkeypatch.setattr(
        google_oidc, "_client", httpx.AsyncClient(transport=httpx.MockTransport(_isle))
    )
    google_oidc.onbellegi_temizle()
    yield sayac
    google_oidc.onbellegi_temizle()


def _token(anahtar, **degisiklikler) -> str:
    simdi = datetime.datetime.now(datetime.timezone.utc)
    claims = {
        "iss": "https://accounts.google.com",
        "aud": ISTEMCI_ID,
        "sub": "1147483647",
        "email": "ada@ornek.com",
        "email_verified": True,
        "given_name": "Ada",
        "family_name": "Deneme",
        "nonce": NONCE,
        "iat": simdi,
        "exp": simdi + datetime.timedelta(minutes=10),
    }
    claims.update(degisiklikler)
    claims = {k: v for k, v in claims.items() if v is not YOK}
    return jwt.encode(claims, anahtar, algorithm="RS256", headers={"kid": KID})


# ── Mutlu yol: ters prova, "her seyi reddeden" bir dogrulayici da yesil olurdu ──


@pytest.mark.asyncio
async def test_gecerli_token_kabul_edilir(anahtar):
    claims = await verify_id_token(_token(anahtar), nonce=NONCE)
    assert claims["sub"] == "1147483647"
    assert claims["email"] == "ada@ornek.com"
    assert claims["given_name"] == "Ada"


# ── Reddedilmesi gerekenler ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_baska_istemci_icin_uretilmis_token_reddedilir(anahtar):
    """`aud` denetimi olmasaydı, aynı Google anahtarlarıyla imzalanmış BAŞKA bir
    uygulamanın token'ı burada geçerdi ve imza gerçekten Google'ın olurdu."""
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(
            _token(anahtar, aud="baska-app.apps.googleusercontent.com"), nonce=NONCE
        )


@pytest.mark.asyncio
async def test_yanlis_issuer_reddedilir(anahtar):
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(
            _token(anahtar, iss="https://kotu-saglayici.example"), nonce=NONCE
        )


@pytest.mark.asyncio
async def test_suresi_dolmus_token_reddedilir(anahtar):
    simdi = datetime.datetime.now(datetime.timezone.utc)
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(
            _token(
                anahtar,
                iat=simdi - datetime.timedelta(hours=2),
                exp=simdi - datetime.timedelta(hours=1),
            ),
            nonce=NONCE,
        )


@pytest.mark.asyncio
async def test_nonce_eslesmezse_reddedilir(anahtar):
    """Replay koruması: başka bir oturumda yakalanmış GEÇERLİ bir token, bu
    oturumun nonce'unu taşımadığı için kabul edilmemeli."""
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar), nonce="baska-oturumun-nonce-u")


@pytest.mark.asyncio
async def test_nonce_claimi_hic_yoksa_reddedilir(anahtar):
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, nonce=YOK), nonce=NONCE)


@pytest.mark.asyncio
async def test_dogrulanmamis_eposta_reddedilir(anahtar):
    """GÜVENLİK kapısı, kolaylık değil: doğrulanmamış bir adresle mevcut hesaba
    bağlanmak, o adresi yazabilen herkese hesabı devretmek demektir."""
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, email_verified=False), nonce=NONCE)


@pytest.mark.asyncio
async def test_eposta_dogrulamasi_string_true_ile_gecilemez(anahtar):
    """`is not True` yerine truthy kontrolü yazılsaydı `"false"` dizesi bile
    geçerdi. Kontrolün kimliğe (identity) bakması bilinçli."""
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, email_verified="false"), nonce=NONCE)


@pytest.mark.asyncio
async def test_eposta_iddiasi_yoksa_reddedilir(anahtar):
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, email=YOK), nonce=NONCE)


@pytest.mark.asyncio
async def test_imzasiz_token_reddedilir(anahtar):
    """`alg: none` — imzayı tümden atlatma denemesi."""
    ham = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": ISTEMCI_ID,
            "sub": "1",
            "email": "ada@ornek.com",
            "email_verified": True,
            "nonce": NONCE,
        },
        key="",
        algorithm="none",
        headers={"kid": KID},
    )
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(ham, nonce=NONCE)


@pytest.mark.asyncio
async def test_hmac_ile_imzalanmis_token_reddedilir(anahtar):
    """Anahtar karışıklığı (algorithm confusion).

    Saldırgan `alg`ı HS256'ya çevirip HERKESE AÇIK RSA anahtarını HMAC sırrı gibi
    kullanır. `jwt.decode`a `algorithms` allowlist'i verilmeseydi kütüphane
    token'ın kendi söylediği algoritmaya uyar ve bu token DOĞRULANIRDI.
    """
    import base64
    import hashlib
    import hmac

    from cryptography.hazmat.primitives import serialization

    pem = anahtar.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    # Token ELLE kuruluyor: PyJWT PEM'i HMAC sırrı olarak kullanmayı kendi
    # reddediyor (InvalidKeyError), yani bu token'ı PyJWT ile ÜRETEMEYİZ.
    # Saldırganın böyle bir kısıtı yok; saldırı iki satır Python'la kurulur.
    # Ölçülen şey token'ın nasıl üretildiği değil, BİZİM onu reddettiğimizdir.
    def _b64(ham_bayt: bytes) -> bytes:
        return base64.urlsafe_b64encode(ham_bayt).rstrip(b"=")

    simdi = datetime.datetime.now(datetime.timezone.utc)
    baslik = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    govde = _b64(
        json.dumps(
            {
                "iss": "https://accounts.google.com",
                "aud": ISTEMCI_ID,
                "sub": "1",
                "email": "ada@ornek.com",
                "email_verified": True,
                "nonce": NONCE,
                "iat": int(simdi.timestamp()),
                "exp": int((simdi + datetime.timedelta(minutes=10)).timestamp()),
            }
        ).encode()
    )
    imzalanan = baslik + b"." + govde
    imza = _b64(hmac.new(pem, imzalanan, hashlib.sha256).digest())
    ham = (imzalanan + b"." + imza).decode()

    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(ham, nonce=NONCE)


@pytest.mark.asyncio
async def test_baska_anahtarla_imzalanmis_token_reddedilir():
    """Biçimi kusursuz ama BAŞKA bir RSA anahtarıyla imzalanmış token: `kid`
    bizim JWKS'imizde var, imza tutmaz."""
    sahte = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(sahte), nonce=NONCE)


@pytest.mark.asyncio
async def test_bilinmeyen_kid_reddedilir(anahtar):
    simdi = datetime.datetime.now(datetime.timezone.utc)
    ham = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": ISTEMCI_ID,
            "sub": "1",
            "email": "ada@ornek.com",
            "email_verified": True,
            "nonce": NONCE,
            "iat": simdi,
            "exp": simdi + datetime.timedelta(minutes=10),
        },
        anahtar,
        algorithm="RS256",
        headers={"kid": "bilinmeyen-kid"},
    )
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(ham, nonce=NONCE)


@pytest.mark.asyncio
async def test_jwks_alinamazsa_FAIL_CLOSED(monkeypatch, anahtar):
    """Ağ hatasında giriş REDDEDİLİR.

    Buradaki fail-open "imzayı doğrulayamadım ama yine de kabul ediyorum"
    demek olurdu. Rate limit'in bilinçli fail-open'ından (core/ratelimit.py)
    ayrıldığımız yer burası ve ayrım kasıtlı.
    """

    def _patla(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("ağ yok")

    monkeypatch.setattr(
        google_oidc, "_client", httpx.AsyncClient(transport=httpx.MockTransport(_patla))
    )
    google_oidc.onbellegi_temizle()
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar), nonce=NONCE)


@pytest.mark.asyncio
async def test_client_id_tanimsizsa_reddedilir(monkeypatch, anahtar):
    from core.config import settings

    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", None)
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar), nonce=NONCE)


@pytest.mark.asyncio
async def test_exp_claimi_olmayan_token_reddedilir(anahtar):
    """`options={"require": [...]}` olmadan bu token GEÇERDİ.

    PyJWT `exp` claim'i YOKSA süre denetimini hiç yapmaz — yani süresiz, sonsuza
    kadar geçerli bir token doğar. Mutasyon provasında ölçüldü: `require`
    listesi silindiğinde hiçbir test kırılmıyordu, çünkü bütün örneklerde `exp`
    zaten vardı. Eksikliğin kendisi çıpalanmalıydı.
    """
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, exp=YOK), nonce=NONCE)


@pytest.mark.asyncio
async def test_sub_claimi_olmayan_token_reddedilir(anahtar):
    """`sub` sağlayıcıdaki kalıcı kullanıcı kimliğidir ve `oauth_identities`
    bağının anahtarıdır. Yoksa bağlanacak bir kimlik yok demektir."""
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, sub=YOK), nonce=NONCE)


@pytest.mark.asyncio
async def test_iat_claimi_olmayan_token_reddedilir(anahtar):
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(_token(anahtar, iat=YOK), nonce=NONCE)


@pytest.mark.asyncio
async def test_alg_denetimi_JWKSe_GITMEDEN_reddeder(anahtar, sahte_google):
    """`alg` ön-denetiminin kendi nöbetçisi.

    Mutasyon provasında ölçüldü: ön-denetim kaldırıldığında hiçbir test
    kırılmıyordu, çünkü `jwt.decode`daki allowlist aynı sonucu üretiyor. İki
    katmanı ayıran gözlem, JWKS'e gidilip gidilmediğidir: kabul etmeyeceğimiz
    bir algoritma için Google'a ağ isteği atmanın anlamı yok ve `alg: none`
    token'ı `kid` bile taşımayabilir.
    """
    onceki = sahte_google["n"]
    ham = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": ISTEMCI_ID,
            "sub": "1",
            "email": "ada@ornek.com",
            "email_verified": True,
            "nonce": NONCE,
        },
        key="",
        algorithm="none",
        headers={"kid": KID},
    )
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(ham, nonce=NONCE)

    assert sahte_google["n"] == onceki, (
        "kabul edilmeyen bir `alg` için JWKS çekildi — ön-denetim kaldırılmış olmalı"
    )


# ── Onbellek ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_jwks_onbelleklenir(anahtar, sahte_google):
    """Aksi halde HER giriş Google'a fazladan bir HTTP isteği eklerdi."""
    await verify_id_token(_token(anahtar), nonce=NONCE)
    ilk = sahte_google["n"]
    await verify_id_token(_token(anahtar), nonce=NONCE)
    assert ilk >= 1, "JWKS hiç çekilmediyse bu test bir şey ölçmüyor"
    assert sahte_google["n"] == ilk, "JWKS ikinci kez çekildi — önbellek çalışmıyor"


@pytest.mark.asyncio
async def test_bilinmeyen_kid_anahtarlari_BIR_KEZ_tazeler(anahtar, sahte_google):
    """Google anahtarlarını düzenli döndürür. Tazeleme olmasaydı her rotasyondan
    sonra girişler önbellek TTL'i dolana kadar (bir saate kadar) ölürdü."""
    await verify_id_token(_token(anahtar), nonce=NONCE)
    ilk = sahte_google["n"]

    simdi = datetime.datetime.now(datetime.timezone.utc)
    ham = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": ISTEMCI_ID,
            "sub": "1",
            "email": "ada@ornek.com",
            "email_verified": True,
            "nonce": NONCE,
            "iat": simdi,
            "exp": simdi + datetime.timedelta(minutes=10),
        },
        anahtar,
        algorithm="RS256",
        headers={"kid": "yeni-rotasyon-kid"},
    )
    with pytest.raises(GoogleKimlikHatasi):
        await verify_id_token(ham, nonce=NONCE)

    assert sahte_google["n"] == ilk + 1, (
        "bilinmeyen kid görüldüğünde JWKS tam bir kez tazelenmeliydi "
        f"(önce {ilk}, sonra {sahte_google['n']})"
    )
