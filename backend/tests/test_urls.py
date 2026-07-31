"""core/urls.ensure_http_url — kullanıcı URL'lerinde şema whitelist'i.

Bu alanlar (kütüphane website/cover/logo, ders kaynağı) frontend'de doğrudan
``href`` olarak render ediliyor; javascript:/data: kabul edilirse depolanmış XSS
olur.
"""
from __future__ import annotations

import pytest

from core.urls import ensure_http_url


@pytest.mark.parametrize(
    "value",
    [
        "http://ornek.com",
        "https://ornek.com/yol?a=1",
        "HTTPS://BUYUK.COM",
        "  https://bosluklu.com  ",
    ],
)
def test_gecerli_http_urller_kabul_edilir(value: str) -> None:
    out = ensure_http_url(value)
    assert out is not None
    assert out == value.strip()


@pytest.mark.parametrize("value", [None, "", "   "])
def test_bos_deger_none_doner(value: str | None) -> None:
    assert ensure_http_url(value) is None


@pytest.mark.parametrize(
    "value",
    [
        "javascript:alert(1)",
        "JavaScript:fetch('https://evil')",
        "  javascript:alert(1)  ",  # baştaki boşlukla gizleme
        "data:text/html;base64,PHNjcmlwdD4=",
        "vbscript:msgbox(1)",
        "mailto:a@b.com",  # anti-disintermediation
        "tel:+905550000000",
        "file:///etc/passwd",
        "//protokolsuz.com",
        "ornek.com",  # şemasız
    ],
)
def test_tehlikeli_semalar_reddedilir(value: str) -> None:
    with pytest.raises(ValueError):
        ensure_http_url(value)


@pytest.mark.parametrize(
    "value",
    ["java\x00script:alert(1)", "java\tscript:alert(1)", "https://a.com\n"],
)
def test_kontrol_karakteri_reddedilir(value: str) -> None:
    # Bazı tarayıcılar şema ayrıştırmasında kontrol karakterlerini yok sayar;
    # strip() sonrası hâlâ içeride kalan varsa kabul etmiyoruz.
    stripped = value.strip()
    if any(ch < " " or ch == "\x7f" for ch in stripped):
        with pytest.raises(ValueError):
            ensure_http_url(value)
    else:
        assert ensure_http_url(value) == stripped


def test_hata_mesaji_alan_adini_icerir() -> None:
    with pytest.raises(ValueError, match="Web sitesi"):
        ensure_http_url("javascript:1", field="Web sitesi")
