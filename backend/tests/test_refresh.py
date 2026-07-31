"""Refresh token: saf yardımcılar + şema + çerez sözleşmesi (DB'siz).

issue/rotate/revoke DB gerektirir (entegrasyon); burada hash, şema, çerez
ayarları ve refresh sırasında kullanılan role_id->rol adı eşlemesi test edilir.
"""
from fastapi import Response

from core import cookies
from core.config import settings
from models.role import ROLE_IDS, RoleType, role_name
from schemas.auth import Token
from services import refresh_token_service as rts


def test_hash_deterministic_sha256():
    h = rts._hash("refresh-abc")
    assert h == rts._hash("refresh-abc")
    assert len(h) == 64
    assert h != rts._hash("refresh-abd")


def test_token_semasi_refresh_token_ICERMEZ():
    """Regresyon: alan geri eklenirse refresh token gövdede sızar ve çereze
    geçmenin tüm anlamı kaybolur (JS onu okuyup saklamak zorunda kalır)."""
    assert "refresh_token" not in Token.model_fields
    assert Token(access_token="a").model_dump() == {
        "access_token": "a",
        "token_type": "bearer",
    }


def _set_cookie_header(*, remember: bool) -> str:
    resp = Response()
    cookies.set_refresh_cookie(resp, "ham-token", remember=remember)
    return resp.headers["set-cookie"]


def test_cerez_httponly_ve_dar_yollu():
    header = _set_cookie_header(remember=True)
    assert "refresh_token=ham-token" in header
    # httpOnly: bu değişikliğin tüm amacı — JS token'ı okuyamamalı.
    assert "HttpOnly" in header
    # Lax: /auth/refresh bir POST'tur, site-dışı POST'ta çerez gönderilmez
    # (ayrı bir CSRF token'ı gerekmemesinin sebebi budur).
    assert "SameSite=lax" in header.lower().replace("samesite=lax", "SameSite=lax")
    assert f"Path={cookies.COOKIE_PATH}" in header


def test_beni_hatirla_cerez_omrunu_belirler():
    kalici = _set_cookie_header(remember=True)
    oturumluk = _set_cookie_header(remember=False)
    assert "Max-Age" in kalici
    # Oturum çerezi: Max-Age yok → tarayıcı kapanınca silinir. "Beni hatırla"
    # işaretlenmediğinde beklenen davranış budur ve bunu tarayıcıya söylemenin
    # yolu çerezin ömrüdür.
    assert "Max-Age" not in oturumluk


def test_gelistirmede_secure_kapali_uretimde_acik():
    """`secure` çerez düz HTTP'de HİÇ gönderilmez; yerelde oturum sessizce
    çalışmaz hale gelirdi."""
    header = _set_cookie_header(remember=True)
    assert ("Secure" in header) is settings.is_production


def test_cerez_silme_ayni_yolu_kullanir():
    """Silme yalnız aynı `path` ile yapılırsa tutar."""
    resp = Response()
    cookies.clear_refresh_cookie(resp)
    header = resp.headers["set-cookie"]
    assert f"Path={cookies.COOKIE_PATH}" in header


def test_role_name_reverse_mapping():
    # /auth/refresh, rotate'tan dönen role_id'yi access token rolüne çevirir.
    assert role_name(ROLE_IDS[RoleType.ADMIN]) == "ADMIN"
    assert role_name(ROLE_IDS[RoleType.TUTOR]) == "TUTOR"
    assert role_name(ROLE_IDS[RoleType.CLIENT]) == "CLIENT"
