"""Paralel canlı ders sağlayıcısı seçim kuralı (`core/canli_ders.py::saglayici_sec`)
ve `BookingOut.canli_ders_saglayici`nın atanmış değeri okuması. Saf, DB yok.

Eşzamanlı iki isteğin aynı sağlayıcıyı alması gerçek Postgres ister:
`tests/integration/test_canli_ders_saglayici_atama_pg.py`.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from core import canli_ders
from core.config import settings
from models.booking import BookingStatus
from schemas.booking import BookingOut

KOTA = {"zoom": 10000, "agora": 10000}


def _sec(anahtarli, kullanim, varsayilan="zoom", kotalar=KOTA):
    return canli_ders.saglayici_sec(
        anahtarli=anahtarli, kotalar=kotalar, kullanim=kullanim, varsayilan=varsayilan
    )


def test_kalan_kotasi_cok_olan_secilir():
    assert _sec(["zoom", "agora"], {"zoom": 6000, "agora": 1000}) == "agora"
    assert _sec(["zoom", "agora"], {"zoom": 1000, "agora": 6000}) == "zoom"


def test_kota_farkli_ise_kalan_esas():
    # Agora kotası küçük: kullanım az olsa da kalan zoom'da daha çok.
    kotalar = {"zoom": 10000, "agora": 3000}
    assert _sec(["zoom", "agora"], {"zoom": 5000, "agora": 1000}, kotalar=kotalar) == "zoom"


def test_esitlikte_varsayilan():
    assert _sec(["zoom", "agora"], {}, varsayilan="zoom") == "zoom"
    assert _sec(["zoom", "agora"], {}, varsayilan="agora") == "agora"


def test_anahtarsiz_saglayici_hic_secilmez():
    # Agora'nın kotası bomboş ama anahtarı yok → herkes zoom.
    assert _sec(["zoom"], {"zoom": 9999}) == "zoom"
    # Zoom tükenmiş olsa bile anahtarsız agora'ya düşülmez.
    assert _sec(["zoom"], {"zoom": 50000}) == "zoom"
    # Varsayılan zoom ama yalnız agora'nın anahtarı var → agora.
    assert _sec(["agora"], {"agora": 50000}, varsayilan="zoom") == "agora"


def test_anahtarli_saglayici_yoksa_none():
    assert _sec([], {}) is None
    # Paralel olmayan ad (livekit) aday sayılmaz.
    assert _sec(["livekit"], {}) is None


def test_hepsi_tukenince_varsayilan():
    tukenmis = {"zoom": 12000, "agora": 10000}
    assert _sec(["zoom", "agora"], tukenmis, varsayilan="zoom") == "zoom"
    assert _sec(["zoom", "agora"], tukenmis, varsayilan="agora") == "agora"


def test_tam_kota_dolu_tukenmis_sayilir():
    # Kalan 0 → tükenmiş; öteki sağlayıcıda 1 dk bile kalsa o seçilir.
    assert _sec(["zoom", "agora"], {"zoom": 9999, "agora": 10000}, varsayilan="agora") == "zoom"


def test_ay_araligi_utc_ve_yil_devri():
    an = datetime.datetime(2026, 12, 31, 23, 30, tzinfo=datetime.timezone.utc)
    bas, son = canli_ders.ay_araligi(an)
    assert bas == datetime.datetime(2026, 12, 1, tzinfo=datetime.timezone.utc)
    assert son == datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc)


# ── BookingOut.canli_ders_saglayici ──────────────────────────────────────────


class _OrmBenzeri:
    """from_attributes ile okunan ORM satırı yerine."""

    def __init__(self, **alanlar):
        simdi = datetime.datetime.now(datetime.timezone.utc)
        self.__dict__.update(
            id=1, tutor_id=7, client_id=9, status=BookingStatus.ACCEPTED,
            start_at=simdi, end_at=simdi + datetime.timedelta(hours=1),
            created_at=simdi, price=Decimal("0"), mode="ONLINE",
            meeting_room="adana-1-Ab3xYz", payment=None,
            canli_ders_saglayici=None,
        )
        self.__dict__.update(alanlar)


@pytest.mark.parametrize("atanan", ["zoom", "agora"])
def test_booking_out_atanmis_degeri_dondurur(monkeypatch, atanan):
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    out = BookingOut.model_validate(_OrmBenzeri(canli_ders_saglayici=atanan))
    assert out.canli_ders_saglayici == atanan
    dokum = out.model_dump()
    assert dokum["canli_ders_saglayici"] == atanan
    assert "atanan_saglayici" not in dokum


def test_booking_out_atanmamissa_varsayilan(monkeypatch):
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    assert BookingOut.model_validate(_OrmBenzeri()).canli_ders_saglayici == "zoom"


def test_booking_out_oda_gizliyse_null(monkeypatch):
    # Ödenmemiş ücretli ders: atanmış olsa bile sağlayıcı ifşa edilmez.
    monkeypatch.setattr(settings, "CANLI_DERS_SAGLAYICI", "zoom")
    out = BookingOut.model_validate(
        _OrmBenzeri(price=Decimal("300"), canli_ders_saglayici="agora")
    )
    assert out.meeting_room is None
    assert out.canli_ders_saglayici is None
