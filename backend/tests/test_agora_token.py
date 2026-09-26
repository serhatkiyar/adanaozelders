"""GET /bookings/{id}/canli-ders-bileti — ortak kapılar, atama ve Agora bileti.

Desen `test_zoom_ders_token.py` ile aynı: uç doğrudan çağrılır,
`booking_service.get_booking` ve atama (`canli_ders_saglayici.ata`)
monkeypatch'lenir (DB yok). Anahtarlar sahte; gerçek `.env` KULLANILMAZ.
Token gerçekten ayrıştırılır: uid sahipliği token'ın İÇİNDEN doğrulanır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException

from api.routers.bookings import get_canli_ders_bileti
from core import canli_ders
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import booking_service, canli_ders_saglayici
from services.agora_token.AccessToken2 import AccessToken

UTC = datetime.timezone.utc

_APP_ID = "0123456789abcdef0123456789abcdef"
_CERT = "fedcba9876543210fedcba9876543210"

EGITMEN = Tutor(
    id=7, first_name="Eğitmen", last_name="Soyadı", role_id=ROLE_IDS[RoleType.TUTOR]
)
OGRENCI = Client(
    id=9, first_name="Öğrenci", last_name="Soyadı", role_id=ROLE_IDS[RoleType.CLIENT]
)
YABANCI = Client(
    id=99, first_name="Yabancı", last_name="Kişi", role_id=ROLE_IDS[RoleType.CLIENT]
)


def _ders(**degisiklik) -> Booking:
    """Varsayılan: şu an süren, ONLINE, onaylı, ödenmiş, agora'ya atanmış ders."""
    simdi = datetime.datetime.now(UTC)
    b = Booking(
        id=42,
        tutor_id=EGITMEN.id,
        client_id=OGRENCI.id,
        status=BookingStatus.ACCEPTED,
        start_at=simdi - datetime.timedelta(minutes=5),
        end_at=simdi + datetime.timedelta(minutes=55),
        price=Decimal("300.00"),
        mode="ONLINE",
        meeting_room="adana-42-Ab3xYz",
        payment=Payment(status=PaymentStatus.HELD),
        canli_ders_saglayici="agora",
    )
    # get_booking'in doldurduğu görüntüleme adları (soyadsız).
    b.tutor_name = "Eğitmen"
    b.client_name = "Öğrenci"
    for ad, deger in degisiklik.items():
        setattr(b, ad, deger)
    return b


@pytest.fixture
def ayarli(monkeypatch):
    """Paralel atama açık, Agora yapılandırılmış; Zoom anahtarsız."""
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    monkeypatch.setattr(settings, "AGORA_APP_ID", _APP_ID)
    monkeypatch.setattr(settings, "AGORA_APP_CERTIFICATE", _CERT)
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "")
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_SECRET", "")

    async def sahte_ata(booking_id, now):
        return "agora"

    monkeypatch.setattr(canli_ders_saglayici, "ata", sahte_ata)


@pytest.fixture
def ders_ver(monkeypatch):
    def kur(booking: Booking) -> None:
        async def sahte_get_booking(db, booking_id, *, viewer=None):
            return booking

        monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)

    return kur


async def _cagir(user):
    return await get_canli_ders_bileti(42, user=user, db=None)


async def _kod(user) -> int:
    with pytest.raises(HTTPException) as exc:
        await _cagir(user)
    return exc.value.status_code


def _coz(token: str) -> tuple[AccessToken, str, str]:
    """(token, kanal, uid) — token'ın İÇİNDEKİ RTC servisinden."""
    at = AccessToken()
    assert at.from_string(token)
    assert len(at.services) == 1
    rtc = at.services[0]
    return (
        at,
        rtc._ServiceRtc__channel_name.decode(),
        rtc._ServiceRtc__uid.decode(),
    )


# ── Ortak kapılar (Zoom ile aynı sıra ve kodlar) ─────────────────────────────


async def test_dersin_tarafi_olmayan_403(ayarli, ders_ver):
    ders_ver(_ders())
    assert await _kod(YABANCI) == 403


async def test_onaysiz_ders_409(ayarli, ders_ver):
    ders_ver(_ders(status=BookingStatus.PENDING))
    assert await _kod(OGRENCI) == 409


async def test_yuzyuze_ders_409(ayarli, ders_ver):
    ders_ver(_ders(mode="IN_PERSON", meeting_room=None))
    assert await _kod(OGRENCI) == 409


async def test_odenmemis_ucretli_ders_402(ayarli, ders_ver):
    ders_ver(_ders(price=Decimal("300.00"), payment=None))
    assert await _kod(OGRENCI) == 402


async def test_pencere_disinda_409(ayarli, ders_ver):
    yarin = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    ders_ver(_ders(start_at=yarin, end_at=yarin + datetime.timedelta(hours=1)))
    assert await _kod(OGRENCI) == 409


@pytest.mark.parametrize("saglayici", ["livekit", "jitsi"])
async def test_paralel_atama_kapaliysa_409(ayarli, ders_ver, monkeypatch, saglayici):
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", saglayici)
    ders_ver(_ders())
    assert await _kod(OGRENCI) == 409


@pytest.mark.parametrize("anahtar", ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"])
async def test_agora_atanmis_ama_ayarsizsa_503(ayarli, ders_ver, monkeypatch, anahtar):
    monkeypatch.setattr(settings, anahtar, "")
    ders_ver(_ders())
    assert await _kod(OGRENCI) == 503


async def test_hic_anahtar_yoksa_503_ve_atama_yok(ayarli, ders_ver, monkeypatch):
    # Atanmamış ders + anahtarlı sağlayıcı yok → ata None döner → 503.
    async def bos_ata(booking_id, now):
        return None

    monkeypatch.setattr(canli_ders_saglayici, "ata", bos_ata)
    b = _ders(canli_ders_saglayici=None)
    ders_ver(b)
    assert await _kod(OGRENCI) == 503
    assert b.canli_ders_saglayici is None


async def test_atanmamis_derste_atama_sonucu_kullanilir(ayarli, ders_ver):
    b = _ders(canli_ders_saglayici=None)
    ders_ver(b)
    yanit = await _cagir(OGRENCI)
    assert yanit.saglayici == "agora"
    assert yanit.zoom is None and yanit.agora is not None
    assert b.canli_ders_saglayici == "agora"


# ── Agora bileti ─────────────────────────────────────────────────────────────


async def test_ogretmen_bileti_uid_kanal_karsi(ayarli, ders_ver):
    ders_ver(_ders())
    yanit = await _cagir(EGITMEN)
    assert yanit.saglayici == "agora" and yanit.zoom is None
    a = yanit.agora

    assert a.app_id == _APP_ID
    assert a.kanal == "adana-42-Ab3xYz"
    assert a.uid == "t7"
    assert a.rol == "ogretmen"
    assert a.ad == "Eğitmen"  # soyad üçüncü tarafa gitmez
    assert a.karsi is not None
    assert (a.karsi.uid, a.karsi.ad, a.karsi.rol) == ("c9", "Öğrenci", "ogrenci")
    assert a.ekran.uid == "t7-ekran"

    at, kanal, uid = _coz(a.token)
    assert a.token.startswith("007")
    assert at._AccessToken__app_id.decode() == _APP_ID
    assert (kanal, uid) == ("adana-42-Ab3xYz", "t7")
    _, ekran_kanal, ekran_uid = _coz(a.ekran.token)
    assert (ekran_kanal, ekran_uid) == ("adana-42-Ab3xYz", "t7-ekran")


async def test_ogrenci_bileti_kendi_uidi(ayarli, ders_ver):
    ders_ver(_ders())
    a = (await _cagir(OGRENCI)).agora
    assert a.uid == "c9"
    assert a.rol == "ogrenci"
    assert a.ad == "Öğrenci"
    assert (a.karsi.uid, a.karsi.rol) == ("t7", "ogretmen")
    assert a.ekran.uid == "c9-ekran"
    assert _coz(a.token)[2] == "c9"
    assert _coz(a.ekran.token)[2] == "c9-ekran"


async def test_sure_bir_saati_asmaz(ayarli, ders_ver):
    # Ders uzun sürüyor: sınır `now + 3600`.
    simdi = datetime.datetime.now(UTC)
    ders_ver(_ders(end_at=simdi + datetime.timedelta(hours=3)))
    a = (await _cagir(OGRENCI)).agora
    at, _, _ = _coz(a.token)
    exp = at._AccessToken__issue_ts + at._AccessToken__expire
    assert exp <= int(simdi.timestamp()) + 3600 + 2
    assert int(a.expires_at.timestamp()) <= exp


async def test_sure_ders_penceresini_asmaz(ayarli, ders_ver):
    # Ders 10 dk sonra bitiyor: sınır bitiş + KATILIM_KAPANIS (< 1 saat).
    simdi = datetime.datetime.now(UTC)
    bitis = simdi + datetime.timedelta(minutes=10)
    ders_ver(_ders(start_at=simdi - datetime.timedelta(minutes=50), end_at=bitis))
    a = (await _cagir(OGRENCI)).agora
    pencere_sonu = int((bitis + canli_ders.KATILIM_KAPANIS).timestamp())
    for token in (a.token, a.ekran.token):
        at, _, _ = _coz(token)
        exp = at._AccessToken__issue_ts + at._AccessToken__expire
        assert exp <= pencere_sonu
        assert exp >= pencere_sonu - 3  # gereksiz kısa da değil
    assert a.expires_at.timestamp() <= pencere_sonu


async def test_zoom_atanmis_derste_zoom_bileti(ayarli, ders_ver, monkeypatch):
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", "zoom-key")
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_SECRET", "zoom-secret-en-az-32-karakter-uzun")
    ders_ver(_ders(canli_ders_saglayici="zoom"))
    yanit = await _cagir(EGITMEN)
    assert yanit.saglayici == "zoom"
    assert yanit.agora is None
    assert yanit.zoom.oturum_adi == "adana-42-Ab3xYz"
    assert yanit.zoom.rol == "host"
