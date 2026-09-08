"""OAuth `state` çerezi ve dönüş yolu doğrulaması — saf, ağsız.

## İki ayrı saldırı yüzeyi, tek dosya

**`state`** login CSRF'ini kapatır: saldırgan kurbanı KENDİ Google hesabıyla
oturum açtırıp sonra o oturumda biriken veriyi okuyamamalı. Bunun için `state`
tarayıcıya bağlanır (httpOnly çerez) ve callback'te karşılaştırılır.

**Dönüş yolu** açık yönlendirmeyi kapatır: kullanıcı girişten sonra kendi
sitemize dönmeli, saldırganın sitesine değil.

İkisi de "yazması kolay, unutması daha kolay" savunmalardır ve unutulduğunda
akış çalışmaya devam eder. O yüzden nöbetçileri var.
"""
from __future__ import annotations

import datetime

import jwt
import pytest
from fastapi import Request, Response

from core.config import settings
from services import google_oauth_service as gos
from services.google_oauth_service import OAuthAkisHatasi, guvenli_donus_yolu


# ── Donus yolu ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "yol",
    [
        "/",
        "/magaza",
        "/magaza/urun/kitap-42",
        "/egitmenler?ders=matematik&ilce=seyhan",
        "/rezervasyonlar/deneme/17",
        "/kayit",
        # İKİ NOKTA içeren MEŞRU adresler. İlk yazımda "iki nokta içeremez"
        # kuralı vardı ve bunları sessizce ana sayfaya düşürüyordu; ölçüm
        # kuralın tek başına yalnız zararsız göreli yolları yakaladığını
        # gösterdi ve kural kaldırıldı (şemayı `/` ile başlama zorunluluğu
        # zaten imkânsız kılıyor).
        "/takvim?aralik=09:00-17:00",
        "/rezervasyonlar?saat=09:00",
        "/mesajlar?ts=2026-09-07T10:30:00",
    ],
)
def test_site_ici_yollar_kabul_edilir(yol):
    """Ters prova: "her şeyi reddet" de bütün saldırı testlerini geçerdi."""
    assert guvenli_donus_yolu(yol) == yol


@pytest.mark.parametrize(
    "yol, aciklama",
    [
        ("//evil.example", "protokol-göreli MUTLAK adres — en sık kaçırılan biçim"),
        ("///evil.example", "üç bölü de aynı sonucu verir"),
        ("/\\evil.example", "bazı tarayıcılar ters bölüyü bölü gibi çözümler"),
        ("https://evil.example", "düpedüz dış adres"),
        ("http://evil.example", "düpedüz dış adres"),
        ("javascript:alert(1)", "şema enjeksiyonu"),
        ("data:text/html,<script>", "veri şeması"),
        ("//evil.example/magaza", "konak kaçırma, yol masum görünüyor"),
        ("magaza", "bölü ile başlamıyor, göreli"),
        ("", "boş"),
        (None, "hiç verilmemiş"),
        ("/api/v1/auth/me", "site içi ama kullanıcı yüzeyi değil, ham JSON"),
        ("/api", "aynı sınıf"),
        ("/magaza\r\nSet-Cookie: oturum=calindi", "yanıt bölme / başlık enjeksiyonu"),
        ("/magaza\nX-Injected: 1", "satır sonu"),
        ("/magaza\tdeger", "sekme"),
        ("/magaza deger", "boşluk"),
        ("/" + "a" * 600, "sınırın üstünde"),
    ],
)
def test_tehlikeli_yollar_reddedilir(yol, aciklama):
    assert guvenli_donus_yolu(yol) is None, aciklama


def test_sinir_uzunlugu_kabul_edilir():
    """Sınır testi: reddedilen uzunluk sınırın ÜSTÜ, sınırın kendisi değil."""
    tam = "/" + "a" * (gos.DONUS_MAX - 1)
    assert len(tam) == gos.DONUS_MAX
    assert guvenli_donus_yolu(tam) == tam


# ── State cerezi ─────────────────────────────────────────────────────────────


def _istek(cerezler: dict) -> Request:
    ham = "; ".join(f"{k}={v}" for k, v in cerezler.items())
    return Request(
        {
            "type": "http",
            "headers": [(b"cookie", ham.encode())] if ham else [],
        }
    )


def _state_uret(**degisiklikler) -> str:
    yanit = Response()
    gos._state_yaz(
        yanit,
        {
            "csrf": "csrf-degeri",
            "nonce": "nonce-degeri",
            "verifier": "verifier-degeri",
            "mod": "kayit",
            "rol": "client",
            "onay_surumu": "2026-09-06",
            "donus": "/magaza",
            "hatirla": True,
            **degisiklikler,
        },
    )
    ham = yanit.headers["set-cookie"]
    return ham.split("=", 1)[1].split(";", 1)[0]


def test_yazilan_state_geri_okunur():
    veri = gos._state_oku(_istek({gos.STATE_COOKIE: _state_uret()}))
    assert veri["csrf"] == "csrf-degeri"
    assert veri["nonce"] == "nonce-degeri"
    assert veri["verifier"] == "verifier-degeri"
    assert veri["mod"] == "kayit"
    assert veri["rol"] == "client"
    assert veri["onay_surumu"] == "2026-09-06"
    assert veri["donus"] == "/magaza"
    assert veri["hatirla"] is True


def test_cerez_yoksa_hata():
    with pytest.raises(OAuthAkisHatasi) as hata:
        gos._state_oku(_istek({}))
    assert hata.value.kod == "suresi_doldu"


def test_kurcalanmis_imza_reddedilir():
    """İmza olmasaydı kullanıcı kendi `rol`ünü ya da `onay_surumu`nü
    değiştirebilirdi; ikincisi KVKK ispat kaydını sahteler."""
    ham = _state_uret()
    baslik, govde, imza = ham.split(".")
    bozuk = f"{baslik}.{govde}.{imza[:-4] + 'AAAA'}"
    with pytest.raises(OAuthAkisHatasi):
        gos._state_oku(_istek({gos.STATE_COOKIE: bozuk}))


def test_suresi_dolmus_state_reddedilir():
    simdi = datetime.datetime.now(datetime.timezone.utc)
    eski = jwt.encode(
        {
            "typ": gos.STATE_TYP,
            "csrf": "x",
            "iat": simdi - datetime.timedelta(hours=2),
            "exp": simdi - datetime.timedelta(hours=1),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(OAuthAkisHatasi) as hata:
        gos._state_oku(_istek({gos.STATE_COOKIE: eski}))
    assert hata.value.kod == "suresi_doldu"


def test_access_token_state_yerine_gecirilemez():
    """`typ` alanının varlık sebebi.

    `JWT_SECRET_KEY` access token ile ORTAK. Tür denetimi olmasaydı, elindeki
    geçerli access token'ı state çerezi olarak sunan biri doğrulamayı geçerdi
    (`csrf` claim'i `None` gelir ve karşılaştırma da `None` state ile eşleşecek
    biçimde kurgulanabilirdi).
    """
    from core.security import create_access_token

    sahte = create_access_token(subject=1, role="CLIENT", role_id=3, auth_version=1)
    with pytest.raises(OAuthAkisHatasi) as hata:
        gos._state_oku(_istek({gos.STATE_COOKIE: sahte}))
    assert hata.value.kod == "dogrulama"


def test_baska_sirla_imzalanmis_state_reddedilir():
    simdi = datetime.datetime.now(datetime.timezone.utc)
    yabanci = jwt.encode(
        {
            "typ": gos.STATE_TYP,
            "csrf": "saldirganin-degeri",
            "iat": simdi,
            "exp": simdi + datetime.timedelta(minutes=10),
        },
        "tamamen-baska-bir-sir-tamamen-baska-bir-sir",
        algorithm="HS256",
    )
    with pytest.raises(OAuthAkisHatasi):
        gos._state_oku(_istek({gos.STATE_COOKIE: yabanci}))


def test_cerez_httponly_ve_dogru_yolda_yazilir():
    """`httpOnly` olmasaydı bir XSS `verifier`ı okuyup PKCE'yi anlamsız
    kılardı. `SameSite=Lax` ZORUNLU: `Strict` olsaydı Google'dan dönen üst düzey
    gezinmede çerez gönderilmez ve akış her seferinde ölürdü."""
    yanit = Response()
    gos._state_yaz(yanit, {"csrf": "x"})
    ham = yanit.headers["set-cookie"].lower()
    assert "httponly" in ham
    assert "samesite=lax" in ham
    assert f"path={gos.STATE_COOKIE_PATH}".lower() in ham


def test_state_cerezi_silinebiliyor():
    """Callback çerezi HEMEN siler (tek kullanım). Silme ancak aynı `path` ile
    yapılırsa tutar — core/cookies.py'de aynı tuzak belgelenmiş."""
    yanit = Response()
    gos.state_sil(yanit)
    ham = yanit.headers["set-cookie"].lower()
    assert gos.STATE_COOKIE.lower() in ham
    assert f"path={gos.STATE_COOKIE_PATH}".lower() in ham


# ── Yetkilendirme adresi ─────────────────────────────────────────────────────


@pytest.fixture
def _google_acik(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "test-id.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-secret")


def test_yetkilendirme_adresi_pkce_ve_nonce_tasir(_google_acik):
    from urllib.parse import parse_qs, urlparse

    yanit = Response()
    url = gos.yetkilendirme_baslat(
        yanit, mod="kayit", rol="tutor", donus="/magaza", onay_surumu="2026-09-06", hatirla=True
    )
    q = parse_qs(urlparse(url).query)

    assert q["code_challenge_method"] == ["S256"]
    assert q["code_challenge"] and q["nonce"] and q["state"]
    assert q["scope"] == ["openid email profile"]
    assert q["redirect_uri"] == [settings.GOOGLE_OAUTH_REDIRECT_URI]
    # Google'in refresh token'ini istemiyoruz: saklanmasi gereken yeni bir sir dogardi.
    assert q["access_type"] == ["online"]


def test_donus_rol_ve_onay_surumu_GOOGLEA_GITMEZ(_google_acik):
    """Bu alanlar Google'ın loguna ve Referer'a düşmemeli; imzalı çerezde
    taşınırlar. `state`e konsaydı hem sızarlardı hem kurcalanabilirlerdi."""
    yanit = Response()
    url = gos.yetkilendirme_baslat(
        yanit, mod="kayit", rol="tutor", donus="/magaza/sepet",
        onay_surumu="2026-09-06", hatirla=True,
    )
    assert "/magaza/sepet" not in url
    assert "tutor" not in url
    assert "2026-09-06" not in url

    # ...ama cerezde DURUYORLAR (aksi halde bu test bir sey olcmezdi)
    ham = yanit.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    veri = gos._state_oku(_istek({gos.STATE_COOKIE: ham}))
    assert veri["donus"] == "/magaza/sepet"
    assert veri["rol"] == "tutor"
    assert veri["onay_surumu"] == "2026-09-06"


def test_state_parametresi_cerezdeki_csrf_ile_ayni(_google_acik):
    from urllib.parse import parse_qs, urlparse

    yanit = Response()
    url = gos.yetkilendirme_baslat(
        yanit, mod="giris", rol=None, donus=None, onay_surumu=None, hatirla=False
    )
    state = parse_qs(urlparse(url).query)["state"][0]
    ham = yanit.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    assert gos._state_oku(_istek({gos.STATE_COOKIE: ham}))["csrf"] == state


def test_her_akis_TAZE_csrf_nonce_verifier_uretir(_google_acik):
    """Sabit bir değer yeniden oynatmayı (replay) mümkün kılardı."""
    degerler = set()
    for _ in range(5):
        yanit = Response()
        gos.yetkilendirme_baslat(
            yanit, mod="giris", rol=None, donus=None, onay_surumu=None, hatirla=False
        )
        ham = yanit.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
        v = gos._state_oku(_istek({gos.STATE_COOKIE: ham}))
        degerler.add((v["csrf"], v["nonce"], v["verifier"]))
    assert len(degerler) == 5


def test_pkce_challenge_verifierin_sha256_base64url_ozeti():
    """S256 sözleşmesi: yanlış hesaplanırsa Google kodu takas etmez ve hata
    ancak gerçek bir Google turunda görünür."""
    import base64
    import hashlib

    verifier = "test-verifier-degeri"
    beklenen = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    assert gos._pkce_challenge(verifier) == beklenen
    assert "=" not in gos._pkce_challenge(verifier), "padding çıkarılmalı"


def test_gecersiz_mod_reddedilir(_google_acik):
    with pytest.raises(OAuthAkisHatasi):
        gos.yetkilendirme_baslat(
            Response(), mod="hepsi", rol=None, donus=None, onay_surumu=None, hatirla=False
        )


@pytest.mark.parametrize("rol", ["admin", "courier", "library_operator", "", None])
def test_kayitta_yalniz_client_ve_tutor_kabul_edilir(_google_acik, rol):
    """ADMIN/COURIER/LIBRARY_OPERATOR self-servis kayda kapalıdır (admin
    oluşturur). Google kolu bu kapıyı açan bir arka kapı olmamalı."""
    with pytest.raises(OAuthAkisHatasi):
        gos.yetkilendirme_baslat(
            Response(), mod="kayit", rol=rol, donus=None, onay_surumu=None, hatirla=False
        )


def test_tehlikeli_donus_cereze_YAZILMAZ(_google_acik):
    """Doğrulama çereze yazmadan ÖNCE yapılır; çerez imzalı olduğu için
    callback'te ikinci kez kurcalanamaz."""
    yanit = Response()
    gos.yetkilendirme_baslat(
        yanit, mod="giris", rol=None, donus="//evil.example",
        onay_surumu=None, hatirla=False,
    )
    ham = yanit.headers["set-cookie"].split("=", 1)[1].split(";", 1)[0]
    assert gos._state_oku(_istek({gos.STATE_COOKIE: ham}))["donus"] is None
