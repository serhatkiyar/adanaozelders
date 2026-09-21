"""GET /bookings/{id}/live-token — sıralı kapılar ve token içeriği.

Uç DOĞRUDAN çağrılır: birim test paketinde veritabanı fixture'ı yoktur
(bkz. kök `conftest.py`; DB'li testler `tests/integration` altındadır).
`booking_service.get_booking` monkeypatch'lenerek rezervasyon elde verilir —
`test_booking_fsm.py`'deki bağlantısız ORM nesnesi deseninin aynısı.

Kapı sırası: sahiplik → durum → biçim → ÖDEME → zaman penceresi → ayar.
Her testin fixture'ı kendinden ÖNCEKİ tüm kapıları geçecek şekilde kurulur,
yoksa beklenen kodu değil bir öncekini görürüz.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import jwt
import pytest
from fastapi import HTTPException

from api.routers.bookings import get_live_lesson_token
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import booking_service

UTC = datetime.timezone.utc

_SECRET = "test-livekit-secret-en-az-32-karakter"

# `full_name` hybrid'dir (ad + soyad), doğrudan atanamaz.
EGITMEN = Tutor(
    id=7, first_name="Eğitmen", last_name="Test", role_id=ROLE_IDS[RoleType.TUTOR]
)
OGRENCI = Client(
    id=9, first_name="Öğrenci", last_name="Test", role_id=ROLE_IDS[RoleType.CLIENT]
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
    """LiveKit yapılandırılmış sayılsın (6. kapı 503 döndürmesin)."""
    monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://canli.ornek.test")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "APItestkey")
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", _SECRET)


@pytest.fixture
def ders_ver(monkeypatch):
    def kur(booking: Booking) -> None:
        async def sahte_get_booking(db, booking_id, *, viewer=None):
            return booking

        monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)

    return kur


async def _cagir(user):
    return await get_live_lesson_token(42, user=user, db=None)


async def _kod(user) -> int:
    with pytest.raises(HTTPException) as exc:
        await _cagir(user)
    return exc.value.status_code


async def test_dersin_tarafi_olmayan_403(ayarli, ders_ver):
    ders_ver(_ders())
    assert await _kod(YABANCI) == 403


async def test_odenmemis_ucretli_ders_402(ayarli, ders_ver):
    # Ödeme emanete alınmadan oda açılmaz — `_gate_meeting_room` ikizi.
    ders_ver(_ders(price=Decimal("300.00"), payment=None))
    assert await _kod(OGRENCI) == 402


async def test_ucretsiz_ders_odemesiz_200(ayarli, ders_ver):
    ders_ver(_ders(price=Decimal("0.00"), payment=None))
    yanit = await _cagir(OGRENCI)
    assert yanit.room == "adana-42-Ab3xYz"


async def test_pencere_disinda_409(ayarli, ders_ver):
    # Ödeme kapısını geçsin ki gördüğümüz kod gerçekten zaman kapısı olsun.
    yarin = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    ders_ver(_ders(start_at=yarin, end_at=yarin + datetime.timedelta(hours=1)))
    assert await _kod(OGRENCI) == 409


async def test_yuzyuze_ders_409(ayarli, ders_ver):
    ders_ver(_ders(mode="IN_PERSON", meeting_room=None))
    assert await _kod(OGRENCI) == 409


async def test_onaysiz_ders_409(ayarli, ders_ver):
    ders_ver(_ders(status=BookingStatus.PENDING))
    assert await _kod(OGRENCI) == 409


async def test_livekit_ayarsizsa_503(monkeypatch, ders_ver):
    monkeypatch.setattr(settings, "LIVEKIT_URL", "")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "")
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", "")
    ders_ver(_ders())
    assert await _kod(OGRENCI) == 503


async def test_token_odayi_ve_kimligi_tasir(ayarli, ders_ver):
    ders_ver(_ders())
    yanit = await _cagir(EGITMEN)

    assert yanit.url == "wss://canli.ornek.test"
    assert yanit.identity == "t7"

    claims = jwt.decode(yanit.token, _SECRET, algorithms=["HS256"])
    # Grant alanının JSON adı `video`dur (`grants` DEĞİL) — livekit/protocol
    # auth.ClaimGrants ile birebir; yanlışsa sunucu token'ı reddeder.
    assert claims["video"]["room"] == "adana-42-Ab3xYz"
    assert claims["video"]["roomJoin"] is True
    assert claims["sub"] == "t7"
    assert claims["iss"] == "APItestkey"


async def test_ogrencinin_kimligi_c_onekli(ayarli, ders_ver):
    ders_ver(_ders())
    yanit = await _cagir(OGRENCI)
    assert yanit.identity == "c9"
