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
    """`/{tutor_id}` önce tanımlanırsa `/me/dashboard` ona düşer (422).

    OpenAPI `paths` sözlüğü rotaları tanımlanma sırasıyla taşır (N9 nöbetçisi:
    rota tablosu `app.routes`'tan okunmaz).
    """
    from main import app

    paths = list(app.openapi()["paths"])
    assert paths.index("/api/v1/tutors/me/dashboard") < paths.index("/api/v1/tutors/{tutor_id}")


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


@pytest.mark.parametrize(
    "yol",
    [
        "/api/v1/tutors/me/time-off",
        "/api/v1/tutors/me/time-off/preview",
        "/api/v1/tutors/me/time-off/{time_off_id}",
        "/api/v1/tutors/me/extra-availability",
        "/api/v1/tutors/me/extra-availability/{extra_id}",
        "/api/v1/tutors/me/analytics/overview",
        "/api/v1/tutors/me/analytics/goals",
        "/api/v1/tutors/me/analytics/series",
    ],
)
def test_modul7_rotalari_tutor_id_rotasindan_once(yol):
    """Takvim izinleri ve analiz uçları da `/{tutor_id}` tarafından yutulmamalı."""
    from main import app

    paths = list(app.openapi()["paths"])
    assert paths.index(yol) < paths.index("/api/v1/tutors/{tutor_id}")


_SIMDI = datetime.datetime(2026, 9, 17, 10, 7, tzinfo=datetime.timezone.utc)
_GUN = datetime.timedelta(days=1)
_SAAT = datetime.timedelta(hours=1)
_TAM = datetime.datetime(2026, 9, 18, 9, 0, tzinfo=datetime.timezone.utc)


@pytest.mark.parametrize(
    "baslangic,bitis,beklenen",
    [
        # Geçerli aralık aynen döner.
        (_TAM, _TAM + _SAAT, (_TAM, _TAM + _SAAT)),
        # "Bugün tüm gün": geçmişte kalan başlangıç şimdiden sonraki ilk
        # 15 dakikalık ana kırpılır (10:07 → 10:15).
        (
            datetime.datetime(2026, 9, 17, 0, 0, tzinfo=datetime.timezone.utc),
            _TAM,
            (_SIMDI.replace(minute=15), _TAM),
        ),
        # 60 gün sınırı kırpılmış süreye uygulanır.
        (_TAM, _TAM + 60 * _GUN, (_TAM, _TAM + 60 * _GUN)),
        (_TAM, _TAM + 60 * _GUN + datetime.timedelta(minutes=15), None),
        (_TAM, _TAM, None),  # bitiş başlangıçtan sonra değil
        (_TAM - 2 * _GUN, _TAM - _GUN, None),  # tamamen geçmiş
        (_TAM + datetime.timedelta(minutes=10), _TAM + _SAAT, None),  # 15'in katı değil
    ],
)
def test_izin_araligi_normalizasyonu(baslangic, bitis, beklenen):
    from fastapi import HTTPException

    from services import time_off_service

    if beklenen is None:
        with pytest.raises(HTTPException) as exc:
            time_off_service.normalize_range(baslangic, bitis, _SIMDI)
        assert exc.value.status_code == 422
    else:
        assert time_off_service.normalize_range(baslangic, bitis, _SIMDI) == beklenen
