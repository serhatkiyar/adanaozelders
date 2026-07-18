"""Audit redaction katmanı (devir belgesi Öncelik 1) — saf testler.

Kural: şifre/token/TCKN/IBAN/OTP/secret audit'e ASLA girmez; alanın değiştiği
görünür ("[gizlendi]"), içeriği görünmez.
"""
from services.audit_service import redact


def test_hassas_anahtarlar_maskelenir():
    out = redact(
        {
            "email": "a@b.c",
            "hashed_password": "x123",
            "refresh_token": "raw",
            "tckn": "12345678901",
            "iban_no": "TR12",
            "otp_hash": "abc",
            "api_key": "k",
        }
    )
    assert out["email"] == "a@b.c"
    for key in ("hashed_password", "refresh_token", "tckn", "iban_no", "otp_hash", "api_key"):
        assert out[key] == "[gizlendi]", key


def test_ic_ice_yapilar_gezilir():
    out = redact({"user": {"name": "Ali", "password": "p"}, "items": [{"secret": "s", "n": 1}]})
    assert out["user"]["password"] == "[gizlendi]"
    assert out["user"]["name"] == "Ali"
    assert out["items"][0]["secret"] == "[gizlendi]"
    assert out["items"][0]["n"] == 1


def test_derinlik_siniri_kirpilir():
    deep = {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}
    out = redact(deep)
    assert out["a"]["b"]["c"]["d"] == "[derin]"


def test_none_gecirgen():
    assert redact(None) is None
