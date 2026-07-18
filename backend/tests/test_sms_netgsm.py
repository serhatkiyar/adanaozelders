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
