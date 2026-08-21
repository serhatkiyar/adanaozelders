"""Oturum akışı — GERÇEK HTTP katmanı + gerçek veritabanı.

Bu paketteki diğer dosyalar servis katmanını çağırır; burada **uygulamanın
kendisi** ASGI üzerinden konuşulur, çünkü doğrulanan şey HTTP'nin kendisinde
yaşıyor: çerezin yazılması, tarayıcının onu geri göndermesi, rotasyon ve
silinme. Birim testi çerez başlığının metnini doğrular — gerçekten çalışıp
çalışmadığını değil.

Kapsanan iddia: refresh token JavaScript'e HİÇ görünmez ve gövdeden kabul
edilmez; buna rağmen oturum sessizce yenilenmeye devam eder.
"""
from __future__ import annotations

import itertools
import os

import httpx
import pytest
from httpx import ASGITransport

from core import cookies
from core.security import hash_password
from main import app

pytestmark = pytest.mark.asyncio

PASSWORD = "GucluParola123!"
API = "http://test/api/v1"


@pytest.fixture
async def user(db, factory):
    """Gerçek parolayla giriş yapabilen bir öğrenci."""
    c = await factory.client(db)
    c.hashed_password = hash_password(PASSWORD)
    await db.commit()
    return c


#: Test başına istemci IP'si üretir. Sayaç süreç içinde ARTAR, PID süreçler
#: arasında ayırır — yani iki test (aynı koşuda da, ayrı CI adımlarında da)
#: asla aynı adresi almaz.
_IP_SAYACI = itertools.count()


def _tekil_istemci_ip() -> str:
    n = next(_IP_SAYACI)
    assert n < 254 * 254, "test IP havuzu tükendi"
    return f"10.{os.getpid() % 256}.{n // 254}.{n % 254 + 1}"


@pytest.fixture
async def http():
    """Uygulamayı lifespan ÇALIŞTIRMADAN, **teste özel bir istemci IP'siyle** konuşur.

    Lifespan arka plan döngülerini (hatırlatma, escrow mutabakatı, teslimat
    watchdog) başlatır; oturum testinin ortasında veri değiştirmelerini
    istemiyoruz. `scripts/scale/probe.py` ile aynı gerekçe.

    IP neden teste özel (21 Ağu 2026'da CI'da ölçüldü): `POST /auth/login`
    IP başına limitlidir (`rl:login:{ip}`, `RATE_LIMIT_LOGIN`=10/60 sn) ve
    sayaç **Redis'te** yaşar. `ASGITransport` varsayılan olarak her isteğe
    `127.0.0.1` der; yani depodaki BÜTÜN HTTP testleri — üstelik ayrı CI
    adımlarındakiler bile — tek bir kovayı paylaşıyordu. Bu dosyanın 9
    giriş'i, entegrasyon adımının 5 giriş'iyle (`test_ip3_session_
    invalidation_pg.py`, `ROLLER` üzerinden parametrik) aynı 60 sn'lik
    pencereye düştüğünde toplam 14 > 10 oluyor ve son dördü 429 alıyordu.

    Limiter KAPATILMADI, limit YÜKSELTİLMEDİ: ikisi de gerçek davranışı
    testten kaçırırdı (`tests/verify/test_verify_redis_infra.py` bu paketin
    limiter'ı gerçekten saydığını doğrular ve öyle kalmalıdır). Bunun yerine
    testler gerçek dünyadaki gibi **farklı istemcilerden** konuşur.
    """
    transport = ASGITransport(app=app, client=(_tekil_istemci_ip(), 1))
    async with httpx.AsyncClient(transport=transport, base_url=API) as c:
        yield c


async def _login(http: httpx.AsyncClient, email: str, *, remember: bool = True):
    """Giriş yapar ve BAŞARILI olduğunu doğrular.

    Yardımcı neden iddia ediyor: giriş sessizce başarısız olduğunda (ölçülen
    gerçek vaka: IP rate-limit kovası dolduğu için 429) testler alakasız
    yerlerde `KeyError: 'set-cookie'` / `KeyError: 'access_token'` diye
    patlıyor ve sebep görünmüyordu — CI'da bu tam olarak yaşandı (21 Ağu
    2026). Daha kötüsü, oturum kurulmasını sonuçta ARAMAYAN bir test (bkz.
    `test_pasif_hesap_yenileyemez`) 429'a rağmen YEŞİL kalıyordu: hiç
    oturum açmamış bir hesapla "oturum yenilenemiyor" kanıtlanıyordu.

    Bu yüzden başarısızlık burada, sebebiyle birlikte durur.
    """
    r = await http.post(
        "/auth/login",
        data={"username": email, "password": PASSWORD, "remember": str(remember).lower()},
    )
    assert r.status_code == 200, (
        f"giriş yapılamadı ({r.status_code}): {r.text[:200]}\n"
        "429 ise: `rl:login:{ip}` kovası bu testin dışından doldurulmuş "
        "demektir (kova IP başınadır ve Redis'te CI adımları arasında "
        "yaşar). Testlerin IP izolasyonu için `http` fixture'ına bakın."
    )
    return r


async def test_login_refresh_tokeni_GOVDEDE_dondurmez(http, user):
    r = await _login(http, user.email)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    # Asıl iddia: token gövdede yok. Olsaydı istemci onu saklamak zorunda
    # kalırdı ve tek bir XSS 30 günlük hesap devrine yeterdi.
    assert "refresh_token" not in body
    assert cookies.COOKIE_NAME in r.cookies


async def test_login_cerezi_httponly_yazar(http, user):
    r = await _login(http, user.email)
    raw = r.headers["set-cookie"]
    assert "HttpOnly" in raw
    assert f"Path={cookies.COOKIE_PATH}" in raw


async def test_refresh_cerezle_calisir_ve_rotasyon_yapar(http, user):
    await _login(http, user.email)
    ilk_cerez = http.cookies[cookies.COOKIE_NAME]

    r = await http.post("/auth/refresh")
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]

    # Rotasyon: aynı token ikinci kez kullanılamamalı.
    yeni_cerez = http.cookies[cookies.COOKIE_NAME]
    assert yeni_cerez != ilk_cerez


async def test_eski_token_rotasyondan_sonra_reddedilir(http, user):
    await _login(http, user.email)
    eski = http.cookies[cookies.COOKIE_NAME]
    await http.post("/auth/refresh")

    # Çalınmış bir kopyayı elle geri koy: zincir kırılmalı.
    r = await http.post("/auth/refresh", cookies={cookies.COOKIE_NAME: eski})
    assert r.status_code == 401


async def test_refresh_GOVDEDEN_token_kabul_etmez(http, user):
    """Gövde yolu açık kalsaydı, çereze geçmenin sağladığı koruma çalınmış bir
    token elle gönderilerek atlatılabilirdi."""
    await _login(http, user.email)
    gecerli = http.cookies[cookies.COOKIE_NAME]
    http.cookies.clear()

    r = await http.post("/auth/refresh", json={"refresh_token": gecerli})
    assert r.status_code == 401


async def test_cerezsiz_refresh_401_ve_temizleme(http, user):
    r = await http.post("/auth/refresh")
    assert r.status_code == 401
    # Ölü çerez tarayıcıda bırakılmaz.
    assert cookies.COOKIE_NAME in r.headers.get("set-cookie", "")


async def test_beni_hatirla_kapaliysa_oturum_cerezi(http, user):
    r = await _login(http, user.email, remember=False)
    raw = r.headers["set-cookie"]
    assert "Max-Age" not in raw, "oturumluk seçilmişken kalıcı çerez yazılmış"


async def test_beni_hatirla_tercihi_ROTASYONDA_korunur(http, user):
    """Tercih sunucuda (token zincirinde) yaşar: gelen çerezin kalıcı mı
    oturumluk mu olduğu HTTP'de görünmez, isteğe bakarak seçilemez."""
    await _login(http, user.email, remember=False)
    r = await http.post("/auth/refresh")
    assert r.status_code == 200
    assert "Max-Age" not in r.headers["set-cookie"]


async def test_logout_cerezi_siler_ve_tokeni_iptal_eder(http, user):
    login = await _login(http, user.email)
    access = login.json()["access_token"]
    calinmis_kopya = http.cookies[cookies.COOKIE_NAME]

    r = await http.post(
        "/auth/logout", headers={"Authorization": f"Bearer {access}"}
    )
    assert r.status_code == 204

    # Yalnız çerezi silmek yetmezdi: kopyası alınmış token DB'de geçerli
    # kalsaydı hâlâ kullanılabilirdi.
    r2 = await http.post(
        "/auth/refresh", cookies={cookies.COOKIE_NAME: calinmis_kopya}
    )
    assert r2.status_code == 401


async def test_pasif_hesap_yenileyemez(http, user, db):
    await _login(http, user.email)
    # ÖNCE gerçekten bir oturum kurulduğunu doğrula: bu satır olmadan test,
    # hiç giriş yapamamış (ör. 429 yemiş) bir hesapla da geçiyordu — çünkü
    # oturumu olmayanın `refresh`'i de 401 döner. Yani yeşil, "pasif hesap
    # yenileyemez" değil "oturum yoktu" anlamına geliyordu. 29 Tem 2026'dan
    # 21 Ağu 2026'ya kadar yalancı yeşildi.
    assert cookies.COOKIE_NAME in http.cookies, (
        "giriş çerezi yok — düşürülecek bir oturum kurulmadı, test hiçbir şey "
        "kanıtlamaz"
    )
    user.is_active = False
    await db.commit()

    r = await http.post("/auth/refresh")
    assert r.status_code == 401
