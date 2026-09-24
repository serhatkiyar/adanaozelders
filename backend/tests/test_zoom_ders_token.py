"""GET /bookings/{id}/zoom-token — ortak kapılar, sağlayıcı kapısı ve JWT.

Desen `test_canli_ders_token.py` ile aynı: uç doğrudan çağrılır,
`booking_service.get_booking` monkeypatch'lenir (DB yok). Anahtarlar sahte;
gerçek `.env` değerleri KULLANILMAZ.

Kapı sırası: sahiplik → durum → biçim → ÖDEME → zaman penceresi →
sağlayıcı (409) → yapılandırma (503).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import jwt
import pytest
from fastapi import HTTPException

from api.routers.bookings import get_zoom_lesson_token
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import booking_service

UTC = datetime.timezone.utc

_KEY = "zoom-test-sdk-key"
_SECRET = "zoom-test-sdk-secret-en-az-32-karakter"

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
    """Varsayılan: şu an süren, ONLINE, onaylı, ödenmiş ders."""
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
    )
    for ad, deger in degisiklik.items():
        setattr(b, ad, deger)
    return b


@pytest.fixture
def ayarli(monkeypatch):
    """Zoom seçili ve yapılandırılmış sayılsın."""
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_KEY", _KEY)
    monkeypatch.setattr(settings, "ZOOM_VIDEO_SDK_SECRET", _SECRET)


@pytest.fixture
def ders_ver(monkeypatch):
    def kur(booking: Booking) -> None:
        async def sahte_get_booking(db, booking_id, *, viewer=None):
            return booking

        monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)

    return kur


async def _cagir(user):
    return await get_zoom_lesson_token(42, user=user, db=None)


async def _kod(user) -> int:
    with pytest.raises(HTTPException) as exc:
        await _cagir(user)
    return exc.value.status_code


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


async def test_ucretsiz_ders_odemesiz_200(ayarli, ders_ver):
    ders_ver(_ders(price=Decimal("0.00"), payment=None))
    yanit = await _cagir(OGRENCI)
    assert yanit.oturum_adi == "adana-42-Ab3xYz"


async def test_pencere_disinda_409(ayarli, ders_ver):
    yarin = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    ders_ver(_ders(start_at=yarin, end_at=yarin + datetime.timedelta(hours=1)))
    assert await _kod(OGRENCI) == 409


@pytest.mark.parametrize("saglayici", ["livekit", "jitsi"])
async def test_saglayici_zoom_degilse_409(ayarli, ders_ver, monkeypatch, saglayici):
    # Ders önceki tüm kapıları geçer: görülen 409 sağlayıcı kapısıdır.
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", saglayici)
    ders_ver(_ders())
    with pytest.raises(HTTPException) as exc:
        await _cagir(OGRENCI)
    assert exc.value.status_code == 409
    assert "Zoom" in exc.value.detail


@pytest.mark.parametrize("anahtar", ["ZOOM_VIDEO_SDK_KEY", "ZOOM_VIDEO_SDK_SECRET"])
async def test_zoom_ayarsizsa_503(ayarli, ders_ver, monkeypatch, anahtar):
    monkeypatch.setattr(settings, anahtar, "")
    ders_ver(_ders())
    assert await _kod(OGRENCI) == 503


async def test_egitmen_host_token_icerigi(ayarli, ders_ver):
    ders_ver(_ders())
    yanit = await _cagir(EGITMEN)

    assert yanit.rol == "host"
    assert yanit.oturum_adi == "adana-42-Ab3xYz"
    # Ad Zoom'a gider: soyad taşınmaz (display_name).
    assert yanit.kullanici_adi == "Eğitmen"

    baslik = jwt.get_unverified_header(yanit.token)
    assert baslik["alg"] == "HS256"
    assert baslik["typ"] == "JWT"

    claims = jwt.decode(yanit.token, _SECRET, algorithms=["HS256"])
    assert claims["app_key"] == _KEY
    assert claims["tpc"] == yanit.oturum_adi
    assert claims["role_type"] == 1
    assert claims["version"] == 1
    assert claims["video_webrtc_mode"] == 1
    assert claims["audio_webrtc_mode"] == 1
    # Zoom: exp, iat'tan en az 1800 sn, en fazla 48 saat sonra.
    assert 1800 <= claims["exp"] - claims["iat"] <= 48 * 3600
    assert claims["iat"] <= int(datetime.datetime.now(UTC).timestamp())
    assert claims["exp"] == int(yanit.expires_at.timestamp())
    assert "geo_regions" not in claims
    assert not any(k.startswith("cloud_recording") for k in claims)


async def test_ogrenci_katilimci(ayarli, ders_ver):
    ders_ver(_ders())
    yanit = await _cagir(OGRENCI)
    assert yanit.rol == "katilimci"
    assert yanit.kullanici_adi == "Öğrenci"
    claims = jwt.decode(yanit.token, _SECRET, algorithms=["HS256"])
    assert claims["role_type"] == 0
