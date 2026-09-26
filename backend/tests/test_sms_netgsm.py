"""Netgsm yanıt gövdesi doğrulaması (Faz 4) — saf birim testleri.

Netgsm başarısız gönderimi de HTTP 200 ile gövdede hata koduyla döndürür;
gövde kontrolü olmadan başarısız SMS 'gönderildi' sayılırdı (fail-open yalanı).
"""

from core.sms.netgsm import (
    NETGSM_SUCCESS_CODES,
    netgsm_response_ok,
    parse_netgsm_code,
)


def test_parse_kod_ilk_token():
    assert parse_netgsm_code("00 1234567") == "00"
    assert parse_netgsm_code("30") == "30"
    assert parse_netgsm_code("  01  9988 ") == "01"
    assert parse_netgsm_code("") == ""


def test_basari_kodlari():
    assert netgsm_response_ok("00 1234567") is True
    assert netgsm_response_ok("01 1234567") is True
    assert NETGSM_SUCCESS_CODES == {"00", "01"}


def test_hata_kodlari_gonderildi_sayilmaz():
    # HTTP 200 olsa da bunlar BAŞARISIZ (kimlik/başlık/İYS/parametre...).
    for bad in ("20", "30 x", "40", "50", "51", "70", "85", "", "hata"):
        assert netgsm_response_ok(bad) is False


async def test_http_hatasi_parolayi_ve_otpyi_sizdirmaz(monkeypatch):
    """httpx hata metni istek URL'sini taşır; Netgsm'de URL parola + OTP içerir."""
    import httpx
    import pytest

    from core.config import settings
    from core.sms.base import SmsMessage
    from core.sms.netgsm import NetgsmSmsSender

    monkeypatch.setattr(settings, "NETGSM_USERCODE", "8500000000")
    monkeypatch.setattr(settings, "NETGSM_PASSWORD", "GizliParola123")

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, request=request)

    gercek_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: gercek_client(transport=httpx.MockTransport(_handler), **kw),
    )

    with pytest.raises(RuntimeError) as exc:
        await NetgsmSmsSender().send(SmsMessage(to="+905551112233", text="Kodun: 482913"))

    metin = str(exc.value)
    assert "HTTP 500" in metin
    for gizli in ("GizliParola123", "482913", "usercode", "api.netgsm"):
        assert gizli not in metin
    assert exc.value.__cause__ is None and exc.value.__suppress_context__ is True


def test_httpx_istek_satiri_info_seviyesinde_loglanmaz():
    import logging

    from core.observability import configure_logging

    root = logging.getLogger()
    eski = (root.handlers[:], root.level, logging.getLogger("httpx").level)
    try:
        configure_logging()
        assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    finally:
        root.handlers[:] = eski[0]
        root.setLevel(eski[1])
        logging.getLogger("httpx").setLevel(eski[2])
