"""Öğrenci panosu (`GET /clients/me/dashboard`) — DB'siz nöbetçiler.

Korunanlar: sıradaki eylemin öncelik sırası (ilk eşleşen kazanır), rotanın
`/{client_id}` tarafından yutulmaması ve her ders sorgusunun yalnız o öğrencinin
silinmemiş kayıtlarına bakması.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy.dialects import postgresql

from models.booking import Booking
from models.client import Client
from services import client_dashboard_service as svc


def _bk(i: int) -> Booking:
    b = Booking()
    b.id = i
    return b


def test_oncelik_sirasi_sabit():
    assert svc.NEXT_ACTION_PRIORITY == (
        "JOIN_LESSON",
        "RESPOND_OFFER",
        "PAY",
        "CONFIRM_LESSON",
        "REVIEW",
        "NEXT_LESSON",
        "BOOK_AGAIN",
    )


def test_ilk_eslesen_kazanir_sirayla():
    """Tüm adaylar doluyken en öncelikli seçilir; o düşünce bir sonraki."""
    adaylar = {k: _bk(n) for n, k in enumerate(svc.NEXT_ACTION_PRIORITY, start=1)}
    for kind in svc.NEXT_ACTION_PRIORITY:
        secilen = svc.pick_next_action(adaylar)
        assert secilen is not None
        assert secilen[0] == kind
        assert secilen[1] is adaylar[kind]
        adaylar[kind] = None
    assert svc.pick_next_action(adaylar) is None


def test_bos_aday_yok():
    assert svc.pick_next_action({}) is None


def test_pano_rotasi_client_id_rotasindan_once():
    """`/{client_id}` önce tanımlanırsa `/me/dashboard` ona düşer (422)."""
    from main import app

    paths = list(app.openapi()["paths"])
    assert paths.index("/api/v1/clients/me/dashboard") < paths.index(
        "/api/v1/clients/{client_id}"
    )


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
async def test_her_ders_sorgusu_ogrenciye_ve_silinmemise_bagli():
    client = Client()
    client.id = 4242
    db = _KayitDb()
    now = datetime.datetime(2026, 9, 18, 12, 0, tzinfo=datetime.timezone.utc)

    out = await svc.build_dashboard(db, client, now=now)  # type: ignore[arg-type]

    ders_sorgulari = [s for s in db.sorgular if "FROM bookings" in s]
    assert len(ders_sorgulari) >= 10, "ders sorguları yakalanmadı"
    for sql in ders_sorgulari:
        assert "bookings.client_id = 4242" in sql, sql
        assert "bookings.deleted_at IS NULL" in sql, sql
    assert out["next_action"] is None
    assert out["has_bookings"] is False

