"""Eğitmen panosu (`GET /tutors/me/dashboard`) — DB'siz nöbetçiler.

Pano eskiden sayıları tarayıcıda `limit=100` ile sayıyordu. Buradaki testler:
görünürlük nedenlerinin doğru ve sıralı üretildiğini, "bu ay" sınırının İstanbul
saatine göre hesaplandığını, rotanın `/{tutor_id}` tarafından yutulmadığını ve
her ders sorgusunun yalnız o eğitmenin silinmemiş kayıtlarına baktığını korur.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy.dialects import postgresql

from models.tutor import Tutor, TutorStatus
from services import tutor_dashboard_service as svc


def _codes(**kw):
    base = dict(
        status=TutorStatus.APPROVED,
        availability_count=3,
        subject_count=2,
        payout_status="ACTIVE",
    )
    base.update(kw)
    return [(i["code"], i["severity"]) for i in svc.compute_visibility_issues(**base)]


def test_hazir_ilan_icin_neden_yok():
    assert _codes() == []


@pytest.mark.parametrize(
    "status,code",
    [
        (TutorStatus.DRAFT, "DRAFT"),
        (TutorStatus.PENDING_APPROVAL, "PENDING_APPROVAL"),
        (TutorStatus.REJECTED, "REJECTED"),
        (TutorStatus.SUSPENDED, "SUSPENDED"),
    ],
)
def test_yayinda_olmayan_durum_gizli_sayilir(status, code):
    assert _codes(status=status) == [(code, "hidden")]


def test_musaitlik_ve_odeme_hesabi_uyari_duzeyinde():
    """Arama yalnız APPROVED'a bakar; müsaitlik/ödeme hesabı ilanı gizlemez."""
    assert _codes(availability_count=0, payout_status="PENDING") == [
        ("NO_AVAILABILITY", "warning"),
        ("PAYOUT_NOT_ACTIVE", "warning"),
    ]


def test_oncelik_sirasi_gizleyenler_once():
    assert _codes(
        status=TutorStatus.DRAFT,
        subject_count=0,
        availability_count=0,
        payout_status=None,
    ) == [
        ("DRAFT", "hidden"),
        ("NO_SUBJECTS", "hidden"),
        ("NO_AVAILABILITY", "warning"),
        ("PAYOUT_NOT_ACTIVE", "warning"),
    ]


def test_ay_basi_istanbul_saatine_gore():
    """31 Ağu 21:30 UTC = 1 Eylül 00:30 İstanbul → ay başı 1 Eylül."""
    now = datetime.datetime(2026, 8, 31, 21, 30, tzinfo=datetime.timezone.utc)
    assert svc.month_start(now) == datetime.datetime(
        2026, 8, 31, 21, 0, tzinfo=datetime.timezone.utc
    )


def test_pano_rotasi_tutor_id_rotasindan_once():
    from api.routers.tutors import router

    paths = [r.path for r in router.routes]
    assert paths.index("/tutors/me/dashboard") < paths.index("/tutors/{tutor_id}")


class _Sonuc:
    def scalar_one(self):
        return 0

    def all(self):
        return []


class _KayitDb:
    def __init__(self) -> None:
        self.sorgular: list[str] = []

    async def execute(self, stmt):
        self.sorgular.append(
            str(
                stmt.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
        )
        return _Sonuc()


@pytest.mark.asyncio
async def test_her_ders_sorgusu_egitmene_ve_silinmemise_bagli():
    tutor = Tutor()
    tutor.id = 4242
    tutor.status = TutorStatus.APPROVED
    tutor.payout_status = "ACTIVE"
    db = _KayitDb()
    now = datetime.datetime(2026, 9, 17, 12, 0, tzinfo=datetime.timezone.utc)

    out = await svc.build_dashboard(db, tutor, now=now)  # type: ignore[arg-type]

    ders_sorgulari = [s for s in db.sorgular if "FROM bookings" in s]
    assert ders_sorgulari, "ders sorgusu yakalanmadı"
    for sql in ders_sorgulari:
        assert "bookings.tutor_id = 4242" in sql, sql
        assert "bookings.deleted_at IS NULL" in sql, sql
    assert out["next_lesson"] is None
    assert out["pending_count"] == 0
