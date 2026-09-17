"""Ders talep ızgarası (Modül 3) — `booking_service.build_slots`, DB'siz."""
from __future__ import annotations

import datetime
from types import SimpleNamespace as W

from services.booking_service import build_slots

UTC = datetime.timezone.utc


def _utc(*a) -> datetime.datetime:
    return datetime.datetime(*a, tzinfo=UTC)


def test_ders_ve_izinle_cakisan_slot_dolu_sigmayan_sure_uretilmez():
    now = _utc(2026, 9, 17, 6, 0)  # İstanbul 09:00, Perşembe
    windows = [W(weekday=5, start_minute=600, end_minute=780)]  # Cumartesi 10:00–13:00
    busy = [(_utc(2026, 9, 19, 7, 30), _utc(2026, 9, 19, 8, 30))]  # 10:30–11:30
    izin = [(_utc(2026, 9, 19, 9, 30), _utc(2026, 9, 19, 10, 0))]  # 12:30–13:00

    gunler = build_slots(
        windows, busy, izin,
        day_from=datetime.date(2026, 9, 19), days=1, duration_min=60, now=now,
    )
    assert [g["date"] for g in gunler] == [datetime.date(2026, 9, 19)]
    durum = {s["start_at"].hour * 60 + s["start_at"].minute + 180: s["status"] for s in gunler[0]["slots"]}
    assert durum == {
        600: "busy", 630: "busy", 660: "busy", 690: "available", 720: "busy",
    }  # 12:30 başlangıcı 13:00'ü aşar, hiç üretilmez
    assert gunler[0]["has_available"] is True

    uzun = build_slots(
        windows, [], [],
        day_from=datetime.date(2026, 9, 19), days=1, duration_min=120, now=now,
    )
    assert [s["start_at"] for s in uzun[0]["slots"]] == [
        _utc(2026, 9, 19, 7, 0), _utc(2026, 9, 19, 7, 30), _utc(2026, 9, 19, 8, 0)
    ]


def test_utc3_donusumu_gun_bolumu_ve_24_saat_kurali():
    now = _utc(2026, 9, 17, 21, 30)  # İstanbul 18 Eyl 00:30 (Cuma)
    windows = [
        W(weekday=4, start_minute=330, end_minute=750),  # Cuma 05:30–12:30
        W(weekday=4, start_minute=1380, end_minute=1440),  # Cuma 23:00–24:00
        W(weekday=5, start_minute=0, end_minute=60),  # Cumartesi 00:00–01:00
    ]
    gunler = build_slots(
        windows, [], [],
        # Dünkü İstanbul tarihi bugüne kırpılır.
        day_from=datetime.date(2026, 9, 17), days=2, duration_min=30, now=now,
    )
    assert [g["date"] for g in gunler] == [datetime.date(2026, 9, 18), datetime.date(2026, 9, 19)]

    cuma = {s["start_at"]: s for s in gunler[0]["slots"]}
    assert cuma[_utc(2026, 9, 18, 2, 30)]["part_of_day"] == "night"  # 05:30
    assert cuma[_utc(2026, 9, 18, 3, 0)]["part_of_day"] == "morning"  # 06:00
    assert cuma[_utc(2026, 9, 18, 8, 30)]["part_of_day"] == "morning"  # 11:30
    assert cuma[_utc(2026, 9, 18, 9, 0)]["part_of_day"] == "afternoon"  # 12:00
    assert cuma[_utc(2026, 9, 18, 20, 0)]["part_of_day"] == "evening"  # 23:00
    # 23:30 başlangıcı 24:00'te, yani ertesi gün biter: üretilmez.
    assert _utc(2026, 9, 18, 20, 30) not in cuma
    # Hepsi 24 saatten yakın.
    assert all(s["status"] == "busy" for s in cuma.values())
    assert gunler[0]["has_available"] is False

    cumartesi = [(s["start_at"], s["status"]) for s in gunler[1]["slots"]]
    assert cumartesi == [
        (_utc(2026, 9, 18, 21, 0), "busy"),  # now + 23.5 sa
        (_utc(2026, 9, 18, 21, 30), "available"),  # tam now + 24 sa
    ]
