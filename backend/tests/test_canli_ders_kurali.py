"""Canlı ders odası kuralı (`core/canli_ders.py`) ve `BookingOut.canli_ders_saglayici`.

Kural şema kapısı ile token uçlarının ortak kaynağıdır; burada saf hâliyle
sınanır, şemada da ödeme kapısından SONRAKİ değeri okuduğu doğrulanır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from core import canli_ders
from core.config import settings
from models.booking import BookingStatus
from models.payment import PaymentStatus
from schemas.booking import BookingOut

UTC = datetime.timezone.utc


@pytest.mark.parametrize(
    ("durum", "fiyat", "beklenen"),
    [
        (PaymentStatus.HELD, Decimal("300"), True),
        (PaymentStatus.RELEASED, Decimal("300"), True),
        ("HELD", Decimal("300"), True),
        (PaymentStatus.PENDING, Decimal("300"), False),
        (PaymentStatus.REFUNDED, Decimal("300"), False),
        (None, Decimal("300"), False),
        (None, Decimal("0.00"), True),
        (None, 0, True),
        (PaymentStatus.PENDING, Decimal("0"), True),
        (None, None, False),
    ],
)
def test_ders_odasi_acik_mi(durum, fiyat, beklenen):
    assert canli_ders.ders_odasi_acik_mi(durum, fiyat) is beklenen


def _out(**degisiklik) -> BookingOut:
    simdi = datetime.datetime.now(UTC)
    alanlar = dict(
        id=1,
        tutor_id=7,
        client_id=9,
        status=BookingStatus.ACCEPTED,
        start_at=simdi,
        end_at=simdi + datetime.timedelta(hours=1),
        created_at=simdi,
        price=Decimal("0"),
        mode="ONLINE",
        meeting_room="adana-1-Ab3xYz",
    )
    alanlar.update(degisiklik)
    return BookingOut(**alanlar)


@pytest.mark.parametrize("saglayici", ["zoom", "livekit", "jitsi"])
def test_online_ve_oda_gorunurken_ayar_degeri(monkeypatch, saglayici):
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", saglayici)
    out = _out()
    assert out.canli_ders_saglayici == saglayici
    assert out.model_dump()["canli_ders_saglayici"] == saglayici


def test_odenmemis_derste_oda_gizli_saglayici_null(monkeypatch):
    # Ödeme kapısı oda adını siler → sağlayıcı da null olmalı.
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    out = _out(price=Decimal("300"), payment=None)
    assert out.meeting_room is None
    assert out.canli_ders_saglayici is None


def test_yuzyuze_derste_null(monkeypatch):
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    assert _out(mode="IN_PERSON", meeting_room=None).canli_ders_saglayici is None
    assert _out(mode="IN_PERSON").canli_ders_saglayici is None
