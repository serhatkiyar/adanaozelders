"""Modül 4 — özel notlar karşı tarafın okumasıyla SİLİNMEZ.

`Booking.private_notes` delete-orphan cascade taşır. Okuma yolları (öğrenci
panosu, ders listesi, ders detayı) notları görüntüleyene göre süzer; süzme ORM
değişikliği sayılırsa `get_db` commit'i karşı tarafın notunu veritabanından
siler. Pano 60 sn'de bir yenilendiği için bu, öğrenci her açtığında eğitmenin
notunu kaybettirirdi.
"""
from __future__ import annotations

from sqlalchemy import func, select

from core.database import AsyncSessionLocal
from models.booking_private_note import BookingPrivateNote

KOK = "/api/v1/bookings"


async def _not_sayisi(booking_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return await s.scalar(
            select(func.count()).where(BookingPrivateNote.booking_id == booking_id)
        )


async def test_ogrenci_okumalari_egitmenin_ozel_notunu_silmez(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis()
    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/private-notes",
        json={"body": "öğretmenin notu"},
        headers=ders.tutor_auth,
    )
    assert r.status_code == 200, r.text
    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/private-notes",
        json={"body": "öğrencinin notu"},
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    assert await _not_sayisi(ders.booking_id) == 2

    for yol in ("/api/v1/clients/me/dashboard", KOK, f"{KOK}/{ders.booking_id}"):
        r = await ip1a_http.get(yol, headers=ders.client_auth)
        assert r.status_code == 200, (yol, r.text)
        assert "öğretmenin notu" not in r.text, f"{yol} öğretmen notunu sızdırdı"
    assert await _not_sayisi(ders.booking_id) == 2, "öğrenci okuması öğretmen notunu sildi"

    r = await ip1a_http.get(f"{KOK}/{ders.booking_id}", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert [n["body"] for n in r.json()["private_notes"]] == ["öğretmenin notu"]
    assert await _not_sayisi(ders.booking_id) == 2
