"""Centrifugo sınırının saf/kritik davranışları.

Kapsam bilinçli olarak dar: kanal adı biçimi, token'ın HANGİ sırla imzalandığı,
yapılandırma guard'ı ve özellik kapalıyken ağa hiç çıkılmaması. Hepsi sessizce
bozulabilecek ve bozulduğunda üretimde fark edilmeyecek şeylerdir.
"""
from __future__ import annotations

import jwt
import pytest
from pydantic import ValidationError

from core import centrifugo
from core.config import Settings, settings

_BASE_ENV = {
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
    "POSTGRES_DB": "test",
    "JWT_SECRET_KEY": "jwt-sirri-bu-testte-sabit-ve-uzun-olmali",
}


def _settings(**kwargs) -> Settings:
    """Süreçteki `.env`/ortam değişkenlerinden bağımsız Settings üretir."""
    return Settings(**{**_BASE_ENV, **kwargs})


# ── Kanal adı ──


def test_subject_rol_ve_kullanici_birlesir():
    # Tutor#17 ile Client#17 AYNI kişi değildir; sub bunu ayırmalı.
    assert centrifugo.subject(17, 2) == "2-17"
    assert centrifugo.subject(17, 3) == "3-17"


def test_personal_channel_user_limited_bicimi(monkeypatch):
    monkeypatch.setattr(settings, "CENTRIFUGO_NAMESPACE", "kisisel")
    assert centrifugo.personal_channel(user_id=17, role_id=2) == "kisisel:#2-17"


# ── Bağlantı token'ı ──


def test_token_yalniz_centrifugo_sirriyla_cozulur(monkeypatch):
    sir = "centrifugo-sirri-en-az-32-bayt-uzunlugunda"
    monkeypatch.setattr(settings, "CENTRIFUGO_TOKEN_HMAC_SECRET", sir)
    monkeypatch.setattr(settings, "CENTRIFUGO_TOKEN_TTL_SECONDS", 600)

    token = centrifugo.make_connection_token(user_id=17, role_id=2)

    claims = jwt.decode(token, sir, algorithms=["HS256"])
    assert claims["sub"] == "2-17"
    assert claims["exp"] - claims["iat"] == 600

    # API access token'ının sırrıyla ÇÖZÜLMEMELİ: iki sır ayrı dünyalardır.
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["HS256"])


# ── Yapılandırma guard'ı ──


def test_guard_kapaliyken_bos_sirlara_izin_verir():
    s = _settings(CENTRIFUGO_ENABLED=False, CENTRIFUGO_API_KEY="", CENTRIFUGO_TOKEN_HMAC_SECRET="")
    assert s.CENTRIFUGO_ENABLED is False


def test_guard_acikken_eksik_sir_reddedilir():
    with pytest.raises(ValidationError, match="CENTRIFUGO_API_KEY"):
        _settings(
            CENTRIFUGO_ENABLED=True,
            CENTRIFUGO_API_KEY="",
            CENTRIFUGO_TOKEN_HMAC_SECRET="ayri-bir-sir",
        )


def test_guard_sirlar_ayniysa_reddedilir():
    # Aynı sır: Centrifugo bağlantı token'ı API access token'ı gibi de geçerdi.
    with pytest.raises(ValidationError, match="AYNI olamaz"):
        _settings(
            CENTRIFUGO_ENABLED=True,
            CENTRIFUGO_API_KEY="api-anahtari",
            CENTRIFUGO_TOKEN_HMAC_SECRET=_BASE_ENV["JWT_SECRET_KEY"],
        )


def test_guard_ayri_sirlarla_gecer():
    s = _settings(
        CENTRIFUGO_ENABLED=True,
        CENTRIFUGO_API_KEY="api-anahtari",
        CENTRIFUGO_TOKEN_HMAC_SECRET="ayri-bir-sir",
    )
    assert s.CENTRIFUGO_ENABLED is True


# ── Publish ──


@pytest.mark.asyncio
async def test_broadcast_kapaliyken_aga_cikmaz(monkeypatch):
    monkeypatch.setattr(settings, "CENTRIFUGO_ENABLED", False)

    def _patlat():
        raise AssertionError("CENTRIFUGO_ENABLED kapalıyken HTTP istemcisi kurulmamalı")

    monkeypatch.setattr(centrifugo, "_http", _patlat)
    assert await centrifugo.broadcast(["kisisel:#2-17"], {"type": "TYPING"}) is False


@pytest.mark.asyncio
async def test_broadcast_kanal_listesi_bosken_aga_cikmaz(monkeypatch):
    monkeypatch.setattr(settings, "CENTRIFUGO_ENABLED", True)

    def _patlat():
        raise AssertionError("boş kanal listesinde istek atılmamalı")

    monkeypatch.setattr(centrifugo, "_http", _patlat)
    assert await centrifugo.broadcast([], {"type": "TYPING"}) is False


@pytest.mark.asyncio
async def test_broadcast_hata_yutar(monkeypatch):
    """Fail-open: gerçek-zamanlı katman çökse bile çağıran akış devam eder."""
    monkeypatch.setattr(settings, "CENTRIFUGO_ENABLED", True)

    class _Patlayan:
        async def post(self, *args, **kwargs):
            raise RuntimeError("centrifugo erişilemez")

    monkeypatch.setattr(centrifugo, "_http", lambda: _Patlayan())
    assert await centrifugo.broadcast(["kisisel:#2-17"], {"type": "TYPING"}) is False
