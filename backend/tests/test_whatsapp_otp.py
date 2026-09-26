"""Telefon OTP'si: önce WhatsApp, olmazsa SMS; kullanıcı "SMS olarak al" diyebilir."""
from __future__ import annotations

import types

import httpx
import pytest

from core import whatsapp
from core.config import settings
from services import phone_service


class _Db:
    async def execute(self, *a, **k):
        return None

    def add(self, obj):
        self.eklenen = obj

    async def flush(self):
        return None


def _kullanici():
    return types.SimpleNamespace(id=5, role_id=3, phone=None, phone_verified_at=None)


@pytest.fixture
def kanallar(monkeypatch):
    kayit = {"wa": 0, "sms": 0, "wa_sonuc": True}

    async def _wa(*, to, code):
        kayit["wa"] += 1
        return kayit["wa_sonuc"]

    async def _sms(*, to, code):
        kayit["sms"] += 1
        return True

    monkeypatch.setattr(phone_service.whatsapp, "send_otp_whatsapp", _wa)
    monkeypatch.setattr(phone_service.sms, "send_otp_sms", _sms)
    return kayit


async def test_varsayilan_once_whatsapp(kanallar):
    maske, kanal = await phone_service.request_otp(_Db(), _kullanici(), "0532 123 45 67")
    assert kanal == "whatsapp" and kanallar == {"wa": 1, "sms": 0, "wa_sonuc": True}
    assert maske.endswith("67") and "***" in maske


async def test_whatsapp_gonderilemezse_SMS_e_duser(kanallar):
    kanallar["wa_sonuc"] = False
    _, kanal = await phone_service.request_otp(_Db(), _kullanici(), "05321234567")
    assert kanal == "sms" and kanallar["wa"] == 1 and kanallar["sms"] == 1


async def test_SMS_olarak_al_whatsappi_hic_denemez(kanallar):
    _, kanal = await phone_service.request_otp(
        _Db(), _kullanici(), "05321234567", kanal="sms"
    )
    assert kanal == "sms" and kanallar["wa"] == 0 and kanallar["sms"] == 1


async def test_ayar_yoksa_whatsapp_devre_disi(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", None)
    assert whatsapp.whatsapp_otp_etkin() is False
    assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="123456") is False


def test_sablon_govdesi_kodu_govdeye_ve_dugmeye_koyar(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_OTP_TEMPLATE", "dogrulama_kodu")
    g = whatsapp.otp_sablon_govdesi(to="+905321234567", code="482913")
    assert g["to"] == "905321234567"
    assert g["template"]["name"] == "dogrulama_kodu"
    govde, dugme = g["template"]["components"]
    assert govde["parameters"][0]["text"] == "482913"
    assert dugme["sub_type"] == "url" and dugme["parameters"][0]["text"] == "482913"


async def test_meta_hatasinda_False_ve_anahtar_sizmaz(monkeypatch, caplog):
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "111")
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "GIZLI-ANAHTAR")
    monkeypatch.setattr(settings, "WHATSAPP_OTP_TEMPLATE", "dogrulama_kodu")

    def _yanit(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer GIZLI-ANAHTAR"
        return httpx.Response(400, json={"error": {"code": 131026}}, request=request)

    gercek = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: gercek(transport=httpx.MockTransport(_yanit), **kw)
    )
    with caplog.at_level("WARNING"):
        assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="482913") is False
    assert "GIZLI-ANAHTAR" not in caplog.text and "482913" not in caplog.text
