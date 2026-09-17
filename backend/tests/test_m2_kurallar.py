"""Modül 2 (17 Eyl 2026) — ders onayı / 12 saat kuralı saf kuralları (DB'siz).

Para yolunun kendisi `tests/integration/test_m2_ders_onayi_pg.py` içinde gerçek
PostgreSQL ile sınanır; burada yalnız zaman eşikleri ve şema hesapları vardır.
"""
from __future__ import annotations

import asyncio
import datetime

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from core.config import settings
from models.booking import Booking, BookingStatus
from schemas.booking import BookingIssueReport, BookingOut
from services import booking_service

UTC = datetime.timezone.utc
SIMDI = datetime.datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


def _ders(status: BookingStatus, *, baslangic: datetime.datetime) -> Booking:
    return Booking(
        status=status,
        start_at=baslangic,
        end_at=baslangic + datetime.timedelta(hours=1),
    )


# ── is_late_for_changes ───────────────────────────────────────────────────────


def test_esikler_kullanici_kararindaki_degerlerde():
    assert settings.LESSON_LATE_CANCEL_HOURS == 12
    assert settings.LESSON_CONFIRM_WINDOW_HOURS == 72


@pytest.mark.parametrize(
    ("kalan", "gec_mi"),
    [
        (datetime.timedelta(hours=11, minutes=59), True),
        (datetime.timedelta(hours=12, minutes=1), False),
        (datetime.timedelta(hours=6), True),
        (datetime.timedelta(hours=48), False),
        (-datetime.timedelta(hours=1), True),  # başlamış ders de "geç"tir
    ],
)
def test_kabul_edilmis_derste_12_saat_siniri(kalan, gec_mi):
    ders = _ders(BookingStatus.ACCEPTED, baslangic=SIMDI + kalan)
    assert booking_service.is_late_for_changes(ders, SIMDI) is gec_mi


@pytest.mark.parametrize(
    "kalan", [datetime.timedelta(hours=11, minutes=59), datetime.timedelta(hours=12, minutes=1)]
)
def test_onay_bekleyen_derste_kural_islemez(kalan):
    """PENDING talepte ödeme/yükümlülük yok: iptal ve erteleme serbesttir."""
    ders = _ders(BookingStatus.PENDING, baslangic=SIMDI + kalan)
    assert booking_service.is_late_for_changes(ders, SIMDI) is False


def test_naive_baslangic_UTC_sayilir():
    naive = (SIMDI + datetime.timedelta(hours=11, minutes=59)).replace(tzinfo=None)
    ders = _ders(BookingStatus.ACCEPTED, baslangic=naive)
    assert booking_service.is_late_for_changes(ders, SIMDI) is True


# ── issue_report_deadline ─────────────────────────────────────────────────────


def test_sorun_bildirme_son_ani_bitis_arti_72_saat():
    ders = _ders(BookingStatus.COMPLETED, baslangic=SIMDI)
    assert booking_service.issue_report_deadline(ders) == ders.end_at + datetime.timedelta(
        hours=72
    )


def test_sorun_bildirme_son_ani_naive_bitisi_UTC_sayar():
    bitis = datetime.datetime(2026, 9, 17, 13, 0)
    ders = Booking(status=BookingStatus.COMPLETED, start_at=bitis, end_at=bitis)
    assert booking_service.issue_report_deadline(ders) == datetime.datetime(
        2026, 9, 20, 13, 0, tzinfo=UTC
    )


# ── BookingOut computed alanları ──────────────────────────────────────────────


def _out(status: BookingStatus, *, baslangic: datetime.datetime) -> BookingOut:
    return BookingOut(
        id=1,
        tutor_id=1,
        client_id=1,
        status=status,
        start_at=baslangic,
        end_at=baslangic + datetime.timedelta(hours=1),
        created_at=baslangic - datetime.timedelta(days=1),
    )


def _simdi() -> datetime.datetime:
    return datetime.datetime.now(UTC)


def test_bookingout_issue_report_deadline_bitis_arti_pencere():
    baslangic = _simdi() - datetime.timedelta(hours=3)
    out = _out(BookingStatus.COMPLETED, baslangic=baslangic)
    beklenen = out.end_at + datetime.timedelta(hours=settings.LESSON_CONFIRM_WINDOW_HOURS)
    assert out.issue_report_deadline == beklenen
    assert out.model_dump()["issue_report_deadline"] == beklenen


@pytest.mark.parametrize(
    ("status", "kalan", "beklenen"),
    [
        (BookingStatus.ACCEPTED, datetime.timedelta(hours=11, minutes=59), True),
        (BookingStatus.ACCEPTED, datetime.timedelta(hours=12, minutes=1), False),
        (BookingStatus.PENDING, datetime.timedelta(hours=6), False),
        (BookingStatus.COMPLETED, -datetime.timedelta(hours=2), False),
    ],
)
def test_bookingout_late_for_changes(status, kalan, beklenen):
    out = _out(status, baslangic=_simdi() + kalan)
    assert out.late_for_changes is beklenen
    assert out.model_dump()["late_for_changes"] is beklenen


def test_bookingout_varsayilanlari():
    out = _out(BookingStatus.ACCEPTED, baslangic=_simdi() + datetime.timedelta(days=2))
    veri = out.model_dump()
    assert veri["is_disputed"] is False
    assert veri["late_cancel"] is False
    assert veri["student_confirmed_at"] is None
    assert veri["issue_reason"] is None


# ── report_issue: geçersiz neden DB'ye inmeden 422 ────────────────────────────


def test_sema_gecersiz_nedeni_reddeder():
    with pytest.raises(ValidationError):
        BookingIssueReport(reason="BASKA_BIR_SEY")
    assert BookingIssueReport(reason="TUTOR_ABSENT").note is None


def test_report_issue_gecersiz_neden_DBye_inmeden_422():
    """`db=None`: servis veritabanına dokunmaya kalksa AttributeError verirdi."""
    ders = _ders(BookingStatus.COMPLETED, baslangic=_simdi() - datetime.timedelta(hours=2))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            booking_service.report_issue(None, ders, reason="BASKA_BIR_SEY", note=None)
        )
    assert exc.value.status_code == 422
    assert ders.is_disputed in (None, False)
