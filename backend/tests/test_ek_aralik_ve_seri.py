"""Ek zaman aralığı ve haftalık ders serisi — saf kurallar, DB'siz."""
from __future__ import annotations

import datetime
from decimal import Decimal
from types import SimpleNamespace as W

import pytest
from fastapi import HTTPException

from services import booking_service, extra_availability_service as ek
from services.lesson_series_service import seri_fiyati, seri_simulasyonu, seri_tarihleri

UTC = datetime.timezone.utc
SAAT = datetime.timedelta(hours=1)


def _utc(*a) -> datetime.datetime:
    return datetime.datetime(*a, tzinfo=UTC)


_NOW = _utc(2026, 9, 17, 10, 0)  # İstanbul 13:00
_PENCERE = booking_service.booking_window_end(_NOW)  # 1 Eki 00:00 İstanbul


# ── normalize_extra ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "bas,bit,mesaj",
    [
        (_utc(2026, 9, 20, 9, 15), _utc(2026, 9, 20, 11, 0), ek.ERR_STEP),
        (_utc(2026, 9, 20, 9, 0), _utc(2026, 9, 20, 9, 0), ek.ERR_ORDER),
        (_utc(2026, 9, 17, 9, 0), _utc(2026, 9, 17, 12, 0), ek.ERR_PAST),
        (_utc(2026, 9, 20, 9, 0), _utc(2026, 9, 21, 9, 30), ek.ERR_MAX),
        (_utc(2026, 9, 30, 20, 0), _utc(2026, 9, 30, 22, 0), ek.ERR_WINDOW),
    ],
)
def test_gecersiz_ek_aralik_422(bas, bit, mesaj):
    with pytest.raises(HTTPException) as exc:
        ek.normalize_extra(bas, bit, _NOW, _PENCERE)
    assert exc.value.status_code == 422
    assert exc.value.detail == mesaj


@pytest.mark.parametrize(
    "bas,bit,uyari",
    [
        # 24 saatten yakın başlangıç engellemez, uyarı döner.
        (_utc(2026, 9, 17, 12, 0), _utc(2026, 9, 17, 14, 0), ["MIN_NOTICE"]),
        # Tam 24 saat ve pencerenin son anına kadar geçerli.
        (_utc(2026, 9, 29, 21, 0), _PENCERE, []),
    ],
)
def test_gecerli_ek_aralik(bas, bit, uyari):
    assert ek.normalize_extra(bas, bit, _NOW, _PENCERE) == (bas, bit, uyari)


# ── seri_simulasyonu ─────────────────────────────────────────────────────────

_TUM_HAFTA = [W(weekday=g, start_minute=0, end_minute=1440) for g in range(7)]
# Cumartesi 12:00 İstanbul, 60 dk, 3 hafta: 19 Eyl, 26 Eyl, 3 Eki.
_OCC = seri_tarihleri(_utc(2026, 9, 19, 9, 0), 60, 3)


def _sim(occ=_OCC, **kw):
    arg = dict(
        now=_NOW, window_end=_PENCERE, tutor_busy=[], client_busy=[], time_off=[],
        windows=_TUM_HAFTA, extras=[],
    )
    arg.update(kw)
    return [(o["status"], o["reason"]) for o in seri_simulasyonu(occ, **arg)]


def test_pencere_siniri_offer_now_ve_later():
    assert [s for s, _ in _OCC] == [
        _utc(2026, 9, 19, 9, 0), _utc(2026, 9, 26, 9, 0), _utc(2026, 10, 3, 9, 0)
    ]
    assert _sim() == [("OFFER_NOW", None), ("OFFER_NOW", None), ("LATER", None)]
    # Sınır dahil değil: tam pencere sonunda başlayan ders LATER.
    occ = seri_tarihleri(_PENCERE - datetime.timedelta(weeks=1), 60, 2)
    assert _sim(occ) == [("OFFER_NOW", None), ("LATER", None)]


def test_neden_onceligi():
    s, e = _OCC[1]
    hepsi = [(s, e)]
    # İzin > müsaitlik > eğitmen > öğrenci.
    assert _sim(time_off=hepsi, tutor_busy=hepsi, client_busy=hepsi, windows=[])[1] == (
        "CONFLICT", "TIME_OFF",
    )
    assert _sim(tutor_busy=hepsi, client_busy=hepsi, windows=[])[1] == (
        "CONFLICT", "OUTSIDE_AVAILABILITY",
    )
    assert _sim(tutor_busy=hepsi, client_busy=hepsi)[1] == ("CONFLICT", "TUTOR_BUSY")
    assert _sim(client_busy=hepsi)[1] == ("CONFLICT", "STUDENT_BUSY")
    # 24 saatten yakın her şeyin önünde.
    yakin = seri_tarihleri(_NOW + 2 * SAAT, 60, 2)
    assert _sim(yakin, time_off=[yakin[0]])[0] == ("CONFLICT", "TOO_SOON")


def test_ek_aralik_sablon_disindaki_haftayi_acar():
    s, e = _OCC[0]
    sablon_yok = _sim(windows=[])
    assert sablon_yok[0] == ("CONFLICT", "OUTSIDE_AVAILABILITY")
    assert _sim(windows=[], extras=[(s, e)])[0] == ("OFFER_NOW", None)


def test_pencere_disinda_yalniz_izin_ve_musaitlik():
    s, e = _OCC[2]
    # Meşguliyet pencere dışında dikkate alınmaz: üretim anında yeniden bakılır.
    assert _sim(tutor_busy=[(s, e)], client_busy=[(s, e)])[2] == ("LATER", None)
    assert _sim(time_off=[(s, e)])[2] == ("CONFLICT", "TIME_OFF")
    assert _sim(windows=[W(weekday=5, start_minute=0, end_minute=600)])[2] == (
        "CONFLICT", "OUTSIDE_AVAILABILITY",
    )


# ── seri_fiyati (para kuralı) ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "seri,ilan,beklenen",
    [
        (Decimal("400.00"), Decimal("500.00"), Decimal("400.00")),
        # Eğitmen ilan ücretini düşürdü: öğrenci lehine yansır.
        (Decimal("400.00"), Decimal("300.00"), Decimal("300.00")),
        (None, Decimal("500.00"), Decimal("500.00")),
        (Decimal("400.00"), None, Decimal("400.00")),
        (None, None, None),
        (Decimal("0"), Decimal("500.00"), Decimal("0")),
    ],
)
def test_seri_fiyati_min_kurali(seri, ilan, beklenen):
    assert seri_fiyati(seri, ilan) == beklenen
