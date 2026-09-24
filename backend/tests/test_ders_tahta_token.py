"""Ders tahtası uçları — GET /bookings/{id}/tahta-token ve PUT /bookings/{id}/tahta.

Desen `test_zoom_ders_token.py` ile aynı: uç doğrudan çağrılır,
`booking_service.get_booking` monkeypatch'lenir (DB yok). Redis ve Centrifugo
yayını sahtedir.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import jwt
import pytest
from fastapi import HTTPException

from api.routers.bookings import get_tahta_token, set_tahta_durumu
from core import centrifugo, ders_tahta
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from schemas.booking import TahtaDurumIn
from services import booking_service

UTC = datetime.timezone.utc
_SIR = "tahta-test-hmac-sirri-en-az-32-karakter-uzun"

EGITMEN = Tutor(id=7, first_name="E", last_name="S", role_id=ROLE_IDS[RoleType.TUTOR])
OGRENCI = Client(id=9, first_name="O", last_name="S", role_id=ROLE_IDS[RoleType.CLIENT])
YABANCI = Client(id=99, first_name="Y", last_name="K", role_id=ROLE_IDS[RoleType.CLIENT])


def _ders(**degisiklik) -> Booking:
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
def ortam(monkeypatch):
    """Centrifugo açık; Redis ve yayın bellekte."""
    monkeypatch.setattr(settings, "CENTRIFUGO_ENABLED", True)
    monkeypatch.setattr(settings, "CENTRIFUGO_TOKEN_HMAC_SECRET", _SIR)
    durum: dict[int, bool] = {}
    yayinlar: list[tuple[list[str], dict]] = []

    async def oku(booking_id):
        return durum.get(booking_id, False)

    async def yaz(booking_id, acik):
        durum[booking_id] = acik

    async def yayinla(kanallar, veri):
        yayinlar.append((kanallar, veri))
        return True

    monkeypatch.setattr(ders_tahta, "acik_mi", oku)
    monkeypatch.setattr(ders_tahta, "yaz", yaz)
    monkeypatch.setattr(centrifugo, "broadcast", yayinla)
    return durum, yayinlar


@pytest.fixture
def ders_ver(monkeypatch):
    def kur(booking: Booking) -> None:
        async def sahte_get_booking(db, booking_id, *, viewer=None):
            return booking

        monkeypatch.setattr(booking_service, "get_booking", sahte_get_booking)

    return kur


async def _token_kod(user) -> int:
    with pytest.raises(HTTPException) as exc:
        await get_tahta_token(42, user=user, db=None)
    return exc.value.status_code


async def test_taraf_olmayan_403(ortam, ders_ver):
    ders_ver(_ders())
    assert await _token_kod(YABANCI) == 403


@pytest.mark.parametrize(
    "degisiklik, kod",
    [
        ({"status": BookingStatus.PENDING}, 409),
        ({"mode": "IN_PERSON", "meeting_room": None}, 409),
        ({"payment": None}, 402),
        (
            {
                "start_at": datetime.datetime.now(UTC) + datetime.timedelta(days=1),
                "end_at": datetime.datetime.now(UTC) + datetime.timedelta(days=1, hours=1),
            },
            409,
        ),
    ],
)
async def test_ortak_kapilar(ortam, ders_ver, degisiklik, kod):
    ders_ver(_ders(**degisiklik))
    assert await _token_kod(OGRENCI) == kod


async def test_centrifugo_kapaliyken_503(ortam, ders_ver, monkeypatch):
    monkeypatch.setattr(settings, "CENTRIFUGO_ENABLED", False)
    ders_ver(_ders())
    assert await _token_kod(OGRENCI) == 503


async def test_abonelik_tokeni_kanal_ve_rol(ortam, ders_ver):
    ders_ver(_ders())
    yanit = await get_tahta_token(42, user=OGRENCI, db=None)
    assert yanit.kanal == "ders:42"
    assert yanit.rol == "ogrenci"
    assert yanit.tahta_acik is False
    claims = jwt.decode(yanit.token, _SIR, algorithms=["HS256"])
    assert claims["channel"] == "ders:42"
    # `sub` bağlantı token'ıyla aynı biçim olmalı; yoksa Centrifugo reddeder.
    assert claims["sub"] == centrifugo.subject(OGRENCI.id, OGRENCI.role_id)
    assert claims["info"] == {"rol": "ogrenci"}
    assert claims["exp"] - claims["iat"] == settings.CENTRIFUGO_TOKEN_TTL_SECONDS

    egitmen = await get_tahta_token(42, user=EGITMEN, db=None)
    assert jwt.decode(egitmen.token, _SIR, algorithms=["HS256"])["info"] == {
        "rol": "ogretmen"
    }


async def test_ogrenci_tahtayi_acamaz_403(ortam, ders_ver):
    durum, yayinlar = ortam
    ders_ver(_ders())
    with pytest.raises(HTTPException) as exc:
        await set_tahta_durumu(42, TahtaDurumIn(acik=True), user=OGRENCI, db=None)
    assert exc.value.status_code == 403
    assert durum == {} and yayinlar == []


async def test_egitmen_acar_durum_saklanir_ve_yayinlanir(ortam, ders_ver):
    durum, yayinlar = ortam
    ders_ver(_ders())
    yanit = await set_tahta_durumu(42, TahtaDurumIn(acik=True), user=EGITMEN, db=None)
    assert yanit.acik is True
    assert durum[42] is True
    assert yayinlar == [(["ders:42"], {"t": "tahta", "acik": True})]
    # Geç katılan son durumu token yanıtından okur.
    assert (await get_tahta_token(42, user=OGRENCI, db=None)).tahta_acik is True


async def test_pencere_disinda_egitmen_de_409(ortam, ders_ver):
    ders_ver(
        _ders(
            start_at=datetime.datetime.now(UTC) + datetime.timedelta(days=1),
            end_at=datetime.datetime.now(UTC) + datetime.timedelta(days=1, hours=1),
        )
    )
    with pytest.raises(HTTPException) as exc:
        await set_tahta_durumu(42, TahtaDurumIn(acik=True), user=EGITMEN, db=None)
    assert exc.value.status_code == 409
