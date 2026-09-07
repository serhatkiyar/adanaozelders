"""Google giriş uçları — kapalı yapılandırma, kayıt kapısı, CSRF, iptal.

Gerçek HTTP katmanı (TestClient) kullanılır ama DB'ye yazılmaz: buradaki
iddiaların hepsi `auth_service`e ULAŞILMADAN önce alınan kararlardır. Kimlik
çözümlemesinin kendisi gerçek Postgres ile
`tests/integration/test_google_oauth_pg.py` içinde ölçülür.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from services import google_oauth_service as gos

ISTEMCI_ID = "test-id.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def client():
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _limitsiz(monkeypatch):
    """Bu dosyada IP rate-limit'i kapalı.

    Yerelde Redis ayakta olduğunda testler aynı IP'den `RATE_LIMIT_LOGIN`
    (varsayılan 10) sınırını aşıp 429 alıyordu; ölçmek istediğimiz şey limit
    değil, limitten SONRAKI kararlar. Limitin uçlara gerçekten bağlı olduğu
    ayrıca çıpalanıyor (`test_uclar_rate_limit_bagimliligi_tasir`).
    """
    from core import ratelimit

    cagrilar: list[str] = []

    async def _serbest(*, bucket, **kwargs):
        cagrilar.append(bucket)
        return None

    monkeypatch.setattr(ratelimit, "enforce", _serbest)
    monkeypatch.setattr("api.routers.auth.enforce", _serbest)
    return cagrilar


@pytest.fixture(autouse=True)
def _temiz_bayrak_onbellegi():
    from core import flags

    flags.reset_cache()
    yield
    flags.reset_cache()


@pytest.fixture
def bayrak(monkeypatch):
    from core import flags

    durum: dict[str, bool] = {}

    def _varsayilan(key: str) -> bool:
        return next(s.default for s in flags.FLAG_SPECS if s.key == key)

    async def _sahte(db, key):  # noqa: ANN001
        return durum.get(key, _varsayilan(key))

    monkeypatch.setattr(flags, "is_enabled", _sahte)
    return durum


@pytest.fixture
def google_acik(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ISTEMCI_ID)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-secret")


@pytest.fixture
def google_kapali(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", None)


# ── Yapilandirilmamis durum ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "yol",
    ["/api/v1/auth/google/start", "/api/v1/auth/google/callback"],
)
def test_google_kapaliyken_uclar_404(client, google_kapali, yol):
    """403 DEĞİL 404: 403 "burada bir uç var ama izin yok" der ve kapalı bir
    özelliğin varlığını sızdırır."""
    r = client.get(yol, follow_redirects=False)
    assert r.status_code == 404, r.text


def test_yarim_yapilandirma_kapali_sayilir(client, monkeypatch):
    """Yalnız CLIENT_ID doldurulmuşsa özellik AÇILMAZ. Yarım yapılandırmada
    "çalışıyor sanmak" en kötü durum: düğme görünür, akış 404 verir."""
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ISTEMCI_ID)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", None)
    assert settings.GOOGLE_OAUTH_ENABLED is False
    r = client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert r.status_code == 404


def test_saglayici_ucu_durumu_soyler(client, google_kapali):
    r = client.get("/api/v1/auth/oauth/providers")
    assert r.status_code == 200
    govde = r.json()
    assert govde["google"] is False
    assert govde["google_start_url"] is None


def test_saglayici_ucu_acikken_MUTLAK_adres_verir(client, google_acik):
    """ÖLÇÜLMÜŞ kusurun nöbetçisi.

    Düğme önce adresi göreli (`/api/v1/...`) kuruyordu; geliştirmede tarayıcı
    oraya Vite dev sunucusu üzerinden gidiyor ve Vite'ın proxy'si dış bir
    siteye (accounts.google.com) giden 303'ü iletemeyip **500** veriyordu.
    Ölçüm: proxy üzerinden 500, doğrudan API kökünden 303.

    Backend testlerinin hiçbiri bunu göremezdi çünkü hepsi API'ye DOĞRUDAN
    gidiyor. Sözleşme bu yüzden burada çıpalanıyor: adres mutlak olmalı ve
    `GOOGLE_OAUTH_REDIRECT_URI` ile AYNI kökten türemeli — ayrışırlarsa biri
    çalışırken diğeri sessizce kırılır.
    """
    r = client.get("/api/v1/auth/oauth/providers")
    govde = r.json()
    assert govde["google"] is True

    adres = govde["google_start_url"]
    assert adres.startswith(("http://", "https://")), f"mutlak olmalı: {adres!r}"
    assert adres.endswith("/auth/google/start")

    from core.config import settings

    kok = settings.BACKEND_BASE_URL.rstrip("/")
    assert adres.startswith(kok)
    assert settings.GOOGLE_OAUTH_REDIRECT_URI.startswith(kok), (
        "start adresi ile redirect URI aynı kökten türemeli"
    )


# ── Yetkilendirme baslatma ───────────────────────────────────────────────────


def test_giris_modu_googlea_yonlendirir(client, google_acik):
    r = client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    assert r.status_code == 303
    hedef = r.headers["location"]
    assert hedef.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert gos.STATE_COOKIE in r.headers.get("set-cookie", "")


def test_kayit_modunda_onay_surumu_ZORUNLU(client, google_acik, bayrak):
    """KVKK ispat zincirinin kapısı.

    Onay sürümü olmadan kayıt açılamaz; form kaydında bunu Pydantic zorluyor
    (`RegisterRequest.consent_version`), Google kolunda parametreler query
    string'de geldiği için aynı denetim elle yapılır.
    """
    r = client.get(
        "/api/v1/auth/google/start?mod=kayit&rol=client", follow_redirects=False
    )
    assert r.status_code == 422, r.text


def test_kayit_modunda_bozuk_onay_surumu_reddedilir(client, google_acik, bayrak):
    r = client.get(
        "/api/v1/auth/google/start?mod=kayit&rol=client&onay_surumu=dun",
        follow_redirects=False,
    )
    assert r.status_code == 422


def test_kayit_modu_gecerli_surumle_calisir(client, google_acik, bayrak):
    """Ters prova: yukarıdaki iki test "kayıt modu hep 422" diye geçmiyor."""
    r = client.get(
        "/api/v1/auth/google/start?mod=kayit&rol=client&onay_surumu=2026-09-06",
        follow_redirects=False,
    )
    assert r.status_code == 303


def test_kayit_kapaliyken_google_ARKA_KAPI_ACMAZ(client, google_acik, bayrak):
    """`registration_open` fail-closed bir kapı. Google kolu bu kapıyı
    atlasaydı, lansman öncesi halka kapalı çalışma kararı delinirdi."""
    from core import flags

    bayrak[flags.FLAG_REGISTRATION_OPEN] = False
    r = client.get(
        "/api/v1/auth/google/start?mod=kayit&rol=client&onay_surumu=2026-09-06",
        follow_redirects=False,
    )
    assert r.status_code == 403, r.text
    assert "kapalı" in r.json()["detail"]


def test_kayit_kapaliyken_GIRIS_etkilenmez(client, google_acik, bayrak):
    """Kapı yalnız yeni kaydı durdurur; mevcut hesapların girişi sürmeli."""
    from core import flags

    bayrak[flags.FLAG_REGISTRATION_OPEN] = False
    r = client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    assert r.status_code == 303


@pytest.mark.parametrize("rol", ["admin", "courier", "library_operator", "yonetici"])
def test_kayitta_ayricalikli_roller_reddedilir(client, google_acik, bayrak, rol):
    """ADMIN/COURIER/LIBRARY_OPERATOR self-servis kayda kapalıdır (admin
    oluşturur). Google kolu bu kapının arka kapısı olmamalı."""
    r = client.get(
        f"/api/v1/auth/google/start?mod=kayit&rol={rol}&onay_surumu=2026-09-06",
        follow_redirects=False,
    )
    assert r.status_code == 422, r.text


def test_bilinmeyen_mod_reddedilir(client, google_acik):
    r = client.get("/api/v1/auth/google/start?mod=hepsi", follow_redirects=False)
    assert r.status_code == 422


# ── Callback: kimlige ULASMADAN once alinan kararlar ─────────────────────────


def _durum(yanit) -> str:
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(yanit.headers["location"]).query)["durum"][0]


def test_state_cerezi_yoksa_suresi_doldu(client, google_acik):
    client.cookies.clear()
    r = client.get(
        "/api/v1/auth/google/callback?code=x&state=y", follow_redirects=False
    )
    assert r.status_code == 303
    assert _durum(r) == "suresi_doldu"


def test_state_uyusmazsa_dogrulama_hatasi(client, google_acik):
    """CSRF kapısı: saldırganın ürettiği `state` kurbanın çereziyle eşleşmez.

    Bu kapı olmadan "login CSRF" mümkün olurdu: saldırgan kurbanı KENDİ Google
    hesabıyla oturum açtırır, kurban farkında olmadan saldırganın hesabında
    işlem yapar.
    """
    client.cookies.clear()
    baslat = client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    assert baslat.status_code == 303

    r = client.get(
        "/api/v1/auth/google/callback?code=x&state=saldirganin-degeri",
        follow_redirects=False,
    )
    assert _durum(r) == "dogrulama"


def test_kullanici_google_ekraninda_vazgecerse_iptal(client, google_acik):
    client.cookies.clear()
    client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    r = client.get(
        "/api/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )
    assert _durum(r) == "iptal"


def test_callback_state_cerezini_HER_DURUMDA_siler(client, google_acik):
    """Tek kullanımlık: aynı `state` ile ikinci bir callback yeniden oynatma
    (replay) olurdu."""
    client.cookies.clear()
    client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    r = client.get(
        "/api/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )
    silme = r.headers.get("set-cookie", "")
    assert gos.STATE_COOKIE in silme
    assert 'g_oauth_state=""' in silme or "Max-Age=0" in silme or "01 Jan 1970" in silme


def test_BOZUK_state_cerezi_de_silinir(client, google_acik):
    """Çerez var ama çözülemiyorsa da düşürülmeli.

    Mutasyon provasında ölçüldü: bu daldaki `state_sil` çağrısı kaldırıldığında
    hiçbir test kırılmıyordu, çünkü diğer testler çerez HİÇ YOKKEN çalışıyor.
    Bozuk bir çerez temizlenmezse tarayıcıda kalır ve kullanıcı her denemede
    aynı "süresi doldu" duvarına çarpar — kendi kendini onaramayan bir kilit.
    """
    client.cookies.clear()
    client.cookies.set(gos.STATE_COOKIE, "bu-gecerli-bir-jwt-degil", path="/")
    r = client.get(
        "/api/v1/auth/google/callback?code=x&state=y", follow_redirects=False
    )
    assert _durum(r) == "suresi_doldu"
    silme = r.headers.get("set-cookie", "")
    assert gos.STATE_COOKIE in silme, "bozuk çerez temizlenmedi"
    client.cookies.clear()


def test_donus_adresi_state_cerezinden_TASINIR(client, google_acik):
    """Dönüş adresi Google'a hiç gitmez ama akış sonunda korunur."""
    from urllib.parse import parse_qs, urlparse

    client.cookies.clear()
    client.get(
        "/api/v1/auth/google/start?mod=giris&donus=/magaza/urun/kitap-42",
        follow_redirects=False,
    )
    r = client.get(
        "/api/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["git"] == ["/magaza/urun/kitap-42"]


def test_tehlikeli_donus_adresi_akista_TASINMAZ(client, google_acik):
    """Açık yönlendirme: `//evil.example` çereze hiç yazılmaz, dönüşte de yok."""
    from urllib.parse import parse_qs, urlparse

    client.cookies.clear()
    client.get(
        "/api/v1/auth/google/start?mod=giris&donus=//evil.example",
        follow_redirects=False,
    )
    r = client.get(
        "/api/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )
    hedef = r.headers["location"]
    assert "evil.example" not in hedef
    assert hedef.startswith(settings.FRONTEND_BASE_URL.rstrip("/"))
    assert "git" not in parse_qs(urlparse(hedef).query)


def test_callback_her_zaman_KENDI_SITEMIZE_doner(client, google_acik):
    client.cookies.clear()
    client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    r = client.get(
        "/api/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )
    assert r.headers["location"].startswith(settings.FRONTEND_BASE_URL.rstrip("/"))


def test_uclar_rate_limit_KOVASINI_TUKETIR(client, google_acik, _limitsiz):
    """Limitin uçlara gerçekten bağlı olduğunu DAVRANIŞLA çıpalar.

    `_limitsiz` fixture'ı limiti kapatıyor (yerelde Redis ayaktayken testler
    kendi aralarında 429 üretiyordu), ama kapatılan şeyin var olduğu ayrıca
    ölçülmeli: biri `dependencies=[Depends(_oauth_limit)]`i silse bu dosyadaki
    başka hiçbir test kırılmazdı ve OAuth uçları limitsiz kalırdı. Kod takası
    her çağrıda Google'a giden bir dış istektir; limitsiz bırakılamaz.
    """
    _limitsiz.clear()
    client.cookies.clear()
    client.get("/api/v1/auth/google/start?mod=giris", follow_redirects=False)
    assert any(k.startswith("rl:oauth:") for k in _limitsiz), (
        f"/google/start rate-limit kovasına dokunmadı: {_limitsiz}"
    )

    _limitsiz.clear()
    client.get("/api/v1/auth/google/callback?error=access_denied", follow_redirects=False)
    assert any(k.startswith("rl:oauth:") for k in _limitsiz), (
        f"/google/callback rate-limit kovasına dokunmadı: {_limitsiz}"
    )
