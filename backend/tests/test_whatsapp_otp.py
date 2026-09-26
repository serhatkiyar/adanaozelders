"""Telefon OTP'si: önce WhatsApp, olmazsa SMS; kullanıcı "SMS olarak al" diyebilir."""
from __future__ import annotations

import types

import httpx
import pytest

from core import whatsapp
from core.config import settings
from services import phone_service


async def _sinir_yok(to):
    return False


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
    monkeypatch.setattr(settings, "WHATSAPP_PROVIDER", "meta")
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
    monkeypatch.setattr(settings, "WHATSAPP_PROVIDER", "meta")
    monkeypatch.setattr(whatsapp, "_saatlik_sinir_asildi", _sinir_yok)
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


# ── WAHA ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def waha(monkeypatch):
    """WAHA'yı MockTransport ile taklit eder; gelen istekleri kaydeder."""
    monkeypatch.setattr(settings, "WHATSAPP_PROVIDER", "waha")
    monkeypatch.setattr(settings, "WAHA_URL", "http://waha:3000")
    monkeypatch.setattr(settings, "WAHA_API_KEY", "WAHA-GIZLI")
    monkeypatch.setattr(whatsapp, "_saatlik_sinir_asildi", _sinir_yok)
    durum = {"var": True, "gonder": 201, "istekler": [], "oturum": "WORKING"}

    def _yanit(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Api-Key"] == "WAHA-GIZLI"
        durum["istekler"].append((request.method, request.url.path, request.content))
        if request.url.path == "/api/contacts/check-exists":
            return httpx.Response(200, json={"numberExists": durum["var"],
                                             "pn": "905321234567@c.us" if durum["var"] else None})
        if request.url.path == "/api/sendText":
            # WAHA hata gövdesi isteği (kodu) geri yansıtır — gerçek davranış.
            return httpx.Response(durum["gonder"], json={"request": {"body": request.content.decode()}})
        if request.url.path == "/api/sessions/default":
            return httpx.Response(200, json={"status": durum["oturum"]})
        return httpx.Response(404)

    gercek = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: gercek(transport=httpx.MockTransport(_yanit), **kw)
    )
    return durum


async def test_waha_numara_varsa_metin_gonderir(waha):
    assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="482913") is True
    gonderim = [i for i in waha["istekler"] if i[1] == "/api/sendText"][0]
    govde = gonderim[2].decode()
    assert "905321234567@c.us" in govde and "482913" in govde and "default" in govde


async def test_waha_numara_whatsappta_yoksa_hic_gondermez(waha):
    waha["var"] = False
    assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="482913") is False
    assert not [i for i in waha["istekler"] if i[1] == "/api/sendText"]


@pytest.mark.parametrize("kod", [422, 500])
async def test_waha_reddinde_False_ve_kod_loga_sizmaz(waha, caplog, kod):
    waha["gonder"] = kod
    with caplog.at_level("WARNING"):
        assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="482913") is False
    assert "482913" not in caplog.text and "WAHA-GIZLI" not in caplog.text


async def test_waha_ulasilamazsa_False(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_PROVIDER", "waha")
    monkeypatch.setattr(settings, "WAHA_URL", "http://waha:3000")
    monkeypatch.setattr(settings, "WAHA_API_KEY", "k")
    monkeypatch.setattr(whatsapp, "_saatlik_sinir_asildi", _sinir_yok)

    def _kopuk(request):
        raise httpx.ConnectError("yok", request=request)

    gercek = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: gercek(transport=httpx.MockTransport(_kopuk), **kw)
    )
    assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="1") is False


async def test_saatlik_sinir_asilinca_whatsapp_denenmez(waha, monkeypatch):
    async def _asildi(to):
        return True

    monkeypatch.setattr(whatsapp, "_saatlik_sinir_asildi", _asildi)
    assert await whatsapp.send_otp_whatsapp(to="+905321234567", code="1") is False
    assert waha["istekler"] == []


async def test_saatlik_sinir_sayaci(monkeypatch):
    sayac: dict[str, int] = {}

    class _R:
        async def incr(self, k):
            sayac[k] = sayac.get(k, 0) + 1
            return sayac[k]

        async def expire(self, k, s):
            return True

    import core.ratelimit as rl

    monkeypatch.setattr(rl, "_redis", lambda: _R())
    monkeypatch.setattr(settings, "WHATSAPP_OTP_SAATLIK_SINIR", 2)
    sonuc = [await whatsapp._saatlik_sinir_asildi("+905321234567") for _ in range(3)]
    assert sonuc == [False, False, True]


def test_otp_metni_turkce_ve_sureli():
    metin = whatsapp.otp_metni("482913")
    assert "Adana Özel Ders" in metin and "482913" in metin and "dk geçerli" in metin


# ── Oturum izleme ────────────────────────────────────────────────────────────


async def test_izleme_yalniz_durum_degisiminde_bildirir(waha, monkeypatch):
    from services import whatsapp_izleme

    whatsapp_izleme._sifirla()
    mesajlar: list[str] = []

    async def _yoneticilere(db, mesaj):
        mesajlar.append(mesaj)

    monkeypatch.setattr(whatsapp_izleme, "_yoneticilere", _yoneticilere)
    await whatsapp_izleme.oturum_kontrol(None)          # WORKING: sessiz
    await whatsapp_izleme.oturum_kontrol(None)          # hâlâ WORKING: sessiz
    assert mesajlar == []
    waha["oturum"] = "FAILED"
    await whatsapp_izleme.oturum_kontrol(None)          # düştü: 1 bildirim
    await whatsapp_izleme.oturum_kontrol(None)          # hâlâ FAILED: sessiz
    assert len(mesajlar) == 1 and "koptu" in mesajlar[0]
    waha["oturum"] = "WORKING"
    await whatsapp_izleme.oturum_kontrol(None)          # geri geldi
    assert len(mesajlar) == 2 and "geri geldi" in mesajlar[1]


async def test_izleme_waha_kapaliyken_sessiz(monkeypatch):
    from services import whatsapp_izleme

    whatsapp_izleme._sifirla()
    monkeypatch.setattr(settings, "WHATSAPP_PROVIDER", "off")
    assert await whatsapp_izleme.oturum_kontrol(None) is None
