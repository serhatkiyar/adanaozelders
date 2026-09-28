"""Öğrencinin yanıt bekleyen ders talebi kotası — GERÇEK PostgreSQL + HTTP.

Kural: öğrenci bir eğitmene en fazla `BOOKING_MAX_PENDING_PER_TUTOR`, toplamda
en fazla `BOOKING_MAX_PENDING_TOTAL` başlamamış PENDING talep açabilir; aşan
talep 409 alır. Eğitmen teklifleri ve saati geçmiş PENDING kayıtlar sayılmaz.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import select

from core.config import settings
from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from services import booking_service
from tests.integration.ip1a_factory import pencere_ici_an

KOK = "/api/v1/bookings"


@pytest.fixture
async def kota(ip1a):
    """ip1a + HTTP ile doğan derslerin temizliği (eğitmen RESTRICT)."""
    try:
        yield ip1a
    finally:
        async with AsyncSessionLocal() as s:
            ids = (
                await s.execute(
                    select(Booking.id).where(Booking.tutor_id.in_(ip1a.tutor_ids or [0]))
                )
            ).scalars().all()
            ip1a.booking_ids.extend(i for i in ids if i not in ip1a.booking_ids)


async def _satir(tutor_id: int, client_id: int, start: datetime.datetime, **ek) -> None:
    async with AsyncSessionLocal() as s:
        s.add(
            Booking(
                tutor_id=tutor_id,
                client_id=client_id,
                status=BookingStatus.PENDING,
                start_at=start,
                end_at=start + datetime.timedelta(hours=1),
                price=500,
                mode="ONLINE",
                **ek,
            )
        )
        await s.commit()


async def _talep(http, ders, gun: int):
    bas = pencere_ici_an(gun)
    return await http.post(
        KOK,
        json={
            "tutor_id": ders.tutor_id,
            "start_at": bas.isoformat(),
            "end_at": (bas + datetime.timedelta(hours=1)).isoformat(),
        },
        headers=ders.client_auth,
    )


async def test_egitmen_basina_kota_teklif_ve_gecmis_sayilmaz(kota, provider, ip1a_http):
    assert settings.BOOKING_MAX_PENDING_PER_TUTOR == 3
    ders = await kota.ders()  # öğrencinin açtığı PENDING (+30 gün) — 1. talep
    # Sayılmayanlar: eğitmen teklifi ve saati geçmiş PENDING talep.
    await _satir(ders.tutor_id, ders.client_id, pencere_ici_an(12), offered_by_tutor=True)
    await _satir(
        ders.tutor_id,
        ders.client_id,
        booking_service._utcnow() - datetime.timedelta(days=2),
    )

    for gun in (2, 3):
        r = await _talep(ip1a_http, ders, gun)
        assert r.status_code == 201, r.text

    r = await _talep(ip1a_http, ders, 4)
    assert r.status_code == 409, r.text
    assert "en fazla 3" in r.json()["detail"]


async def test_toplam_kota(kota, provider, ip1a_http, monkeypatch):
    monkeypatch.setattr(settings, "BOOKING_MAX_PENDING_TOTAL", 2)
    ders = await kota.ders()  # öğrencinin 1. talebi (bu eğitmene)
    diger = await kota.ders()  # başka eğitmen; öğrencimiz ona bir talep açmış
    await _satir(diger.tutor_id, ders.client_id, pencere_ici_an(5))

    r = await _talep(ip1a_http, ders, 3)
    assert r.status_code == 409, r.text
    assert "Aynı anda en fazla 2" in r.json()["detail"]

    monkeypatch.setattr(settings, "BOOKING_MAX_PENDING_TOTAL", 3)
    r = await _talep(ip1a_http, ders, 3)
    assert r.status_code == 201, r.text


async def test_toplam_kota_farkli_egitmenlere_eszamanli_taleplerde_asilmaz(kota, provider, ip1a_http, monkeypatch):
    """Eğitmen kilidi eğitmen başınadır; toplam kota öğrenci kilidiyle korunur."""
    import asyncio
    from types import SimpleNamespace

    monkeypatch.setattr(settings, "BOOKING_MAX_PENDING_TOTAL", 2)
    ders = await kota.ders()  # 1. talep (eğitmen A)
    diger = await kota.ders()  # eğitmen B
    b_ye = SimpleNamespace(tutor_id=diger.tutor_id, client_auth=ders.client_auth)

    sonuc = await asyncio.gather(_talep(ip1a_http, ders, 3), _talep(ip1a_http, b_ye, 4))
    assert sorted(r.status_code for r in sonuc) == [201, 409], [r.text for r in sonuc]
