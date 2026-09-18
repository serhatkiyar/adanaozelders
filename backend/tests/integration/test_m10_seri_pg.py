"""Haftalık ders serisi ve teklif geri çekme — GERÇEK PostgreSQL.

## Ölçülen iş kuralı

* Seri kaydında pencere içindeki haftalar `PENDING` + `offered_by_tutor`
  teklif olur; sonraki hafta, pencere açılınca arka plan işiyle üretilir.
  Ders başı ücret `min(seri ücreti, ilan ücreti × süre)`.
* Seriyi bitirmek bekleyen teklifleri `REJECTED` yapar; kabul edilmiş derse ve
  ödeme kaydına dokunmaz.
* Eğitmenin geri çektiği teklif iptal oranına yansımaz.
* Saati geçmiş teklif kabul edilemez (geçmiş ders için ödeme borcu doğmaz).
* İzin bekleyen seri tekliflerini geri çeker; öğrenci reddi sayılmaz, seri sürer.
"""
from __future__ import annotations

import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.tutor import Tutor
from services import (
    booking_service,
    lesson_series_service,
    time_off_service,
    tutor_analytics_service,
)
from tests.integration.ip1a_factory import pencere_ici_an

KOK = "/api/v1/bookings"


@pytest.fixture
async def m10(ip1a):
    """ip1a + seri satırları ve HTTP ile doğan derslerin temizliği.

    `lesson_series.tutor_id` RESTRICT: seriler eğitmenden önce silinir; teklif
    olarak doğan dersler ip1a'nın silme listesine eklenir."""
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
            await s.execute(
                text("DELETE FROM lesson_series WHERE tutor_id = ANY(:t)"),
                {"t": ip1a.tutor_ids or [0]},
            )
            await s.commit()


async def _seri_dersleri(series_id: int) -> list[Booking]:
    async with AsyncSessionLocal() as s:
        return list(
            (
                await s.execute(
                    select(Booking)
                    .where(Booking.series_id == series_id)
                    .order_by(Booking.start_at)
                )
            ).scalars().all()
        )


async def test_seri_teklifleri_uretim_ve_bitis(m10, provider, ip1a_http):
    ders = await m10.ders()  # ilişki için (+30 gün, seriyle kesişmez)
    ilk = pencere_ici_an(3)
    r = await ip1a_http.post(
        f"{KOK}/series",
        json={
            "client_id": ders.client_id,
            "first_start_at": ilk.isoformat(),
            "duration_min": 60,
            "weeks": 4,
            "price": "400.00",
        },
        headers=ders.tutor_auth,
    )
    assert r.status_code == 201, r.text
    govde = r.json()
    sid = govde["series"]["id"]
    assert govde["series"]["status"] == "ACTIVE"
    assert govde["skipped"] == []
    # 3. ve 10. gün pencere içinde; 17. ve 24. gün sonra üretilecek.
    assert [b["status"] for b in govde["offered"]] == ["PENDING", "PENDING"]
    assert all(b["offered_by_tutor"] and b["series_id"] == sid for b in govde["offered"])
    assert {b["price"] for b in govde["offered"]} == {"400.00"}  # ilan 500 > seri 400

    hafta1, hafta2 = govde["offered"][0]["id"], govde["offered"][1]["id"]
    async with AsyncSessionLocal() as s:
        await booking_service.accept(s, await s.get(Booking, hafta1))
        await s.commit()

    # Bir hafta sonra: pencere 3. haftayı içine alır, 4. hafta hâlâ dışarıda.
    simdi = booking_service._utcnow() + datetime.timedelta(days=7)
    async with AsyncSessionLocal() as s:
        assert await lesson_series_service.generate_due(s, now=simdi) == 1
    assert len(await _seri_dersleri(sid)) == 3

    # Öğrenci seriyi bitirir.
    r = await ip1a_http.post(f"{KOK}/series/{sid}/end", headers=ders.client_auth)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ENDED"
    r = await ip1a_http.post(f"{KOK}/series/{sid}/end", headers=ders.tutor_auth)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "Seri zaten sona ermiş."

    dersler = await _seri_dersleri(sid)
    assert [b.status for b in dersler] == [
        BookingStatus.ACCEPTED, BookingStatus.REJECTED, BookingStatus.REJECTED,
    ]
    assert {b.cancel_reason for b in dersler[1:]} == {"Haftalık seri sona erdi."}
    # Kabul edilmiş ders ve ödeme kaydı yerinde.
    assert (await m10.durumlar(hafta1))[1] is not None
    assert (await m10.durumlar(hafta2))[1] is None


async def test_geri_cekme_iptal_orani_ve_gecmis_teklif(m10, provider, ip1a_http):
    ders = await m10.ders()

    async def teklif(bas: datetime.datetime) -> int:
        r = await ip1a_http.post(
            f"{KOK}/offer",
            json={
                "client_id": ders.client_id,
                "start_at": bas.isoformat(),
                "end_at": (bas + datetime.timedelta(hours=1)).isoformat(),
            },
            headers=ders.tutor_auth,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    bid = await teklif(pencere_ici_an(2))
    r = await ip1a_http.post(f"{KOK}/{bid}/withdraw", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REJECTED"
    assert r.json()["cancelled_by_role"] == 2
    assert r.json()["cancel_reason"] == "Eğitmen teklifi geri çekti."
    r = await ip1a_http.post(f"{KOK}/{bid}/withdraw", headers=ders.tutor_auth)
    assert r.status_code == 409, r.text

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        simdi = booking_service._utcnow()
        oran = await tutor_analytics_service._cancel_rate(
            s, tutor, (simdi - datetime.timedelta(days=1), simdi + datetime.timedelta(days=60))
        )
    assert oran["sample"] == 0, "geri çekilen teklif eğitmen iptali sayıldı"

    # Saati geçmiş teklif kabul edilemez.
    eski = await teklif(pencere_ici_an(4))
    await m10.zamani_kaydir(eski, delta=datetime.timedelta(days=-6))
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await booking_service.accept(s, await s.get(Booking, eski))
    assert exc.value.status_code == 409
    assert exc.value.detail == "Teklifin saati geçti."
    assert await m10.durumlar(eski) == (BookingStatus.PENDING, None)


async def test_izin_seri_teklifini_geri_ceker_seri_surer(m10, provider, ip1a_http):
    """İzin, eğitmenin bekleyen seri tekliflerini geri çeker (öğrenci reddi
    değil): K10 seriyi bitirmez, eğitmene "reddedildi" bildirimi gitmez."""
    ders = await m10.ders()
    ilk = pencere_ici_an(3)
    r = await ip1a_http.post(
        f"{KOK}/series",
        json={
            "client_id": ders.client_id,
            "first_start_at": ilk.isoformat(),
            "duration_min": 60,
            "weeks": 4,
        },
        headers=ders.tutor_auth,
    )
    assert r.status_code == 201, r.text
    sid = r.json()["series"]["id"]
    assert len(r.json()["offered"]) == 2

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, ders.tutor_id)
        sonuc = await time_off_service.create_time_off(
            s,
            tutor,
            start=ilk - datetime.timedelta(hours=1),
            end=ilk + datetime.timedelta(days=7, hours=2),
            title=None,
            note="Ailevi bir durum",
            now=booking_service._utcnow(),
        )
    assert sonuc["cancelled_count"] == 2
    dersler = await _seri_dersleri(sid)
    assert [(b.status, b.cancelled_by_role) for b in dersler] == [
        (BookingStatus.REJECTED, 2), (BookingStatus.REJECTED, 2),
    ]

    simdi = booking_service._utcnow() + datetime.timedelta(days=7)
    async with AsyncSessionLocal() as s:
        assert await lesson_series_service.generate_due(s, now=simdi) == 1
    async with AsyncSessionLocal() as s:
        durum = await s.scalar(text("SELECT status FROM lesson_series WHERE id = :i"), {"i": sid})
        reddedildi = await s.scalar(
            text(
                "SELECT count(*) FROM notifications WHERE user_id = :t "
                "AND message LIKE 'Ders teklifin öğrenci tarafından reddedildi%'"
            ),
            {"t": ders.tutor_id},
        )
    assert durum == "ACTIVE"
    assert reddedildi == 0
