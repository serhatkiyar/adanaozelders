"""Modül 7 (17 Eyl 2026) — eğitmen izni ve derslere etkisi, GERÇEK PostgreSQL.

## Ölçülen iş kuralı (kullanıcı kararı)

* İzin aralığına düşen uzak onaylı ders eğitmen iptali sayılır (ödenmişse iade);
  onay bekleyen talep "eğitmen izinde" gerekçesiyle reddedilir.
* 12 saatten yakın (ya da başlamış) onaylı ders varsa izin hiç eklenmez.
* İzin aralığına yeni rezervasyon yapılamaz.
* İzin eklendikten sonra bir ders yarışta durum değiştirirse izin geri alınmaz;
  ders ``skipped_ids``'e düşer.
* Başka eğitmenin izni silinemez (varlık ifşa edilmez → 404).

Dersler `ip1a` fabrikasının gerçek `accept` + `pay` yolundan gelir.
"""
from __future__ import annotations

import datetime

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus
from services import booking_service, payment_service

KOK = "/api/v1/tutors/me/time-off"
IADE_YOLUNDA = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)


def _saat_basi(delta: datetime.timedelta) -> datetime.datetime:
    an = datetime.datetime.now(datetime.timezone.utc) + delta
    return an.replace(minute=0, second=0, microsecond=0)


def _govde(start: datetime.datetime, end: datetime.datetime, **ek) -> dict:
    return {"start_at": start.isoformat(), "end_at": end.isoformat(), **ek}


async def _ayni_egitmene_ders(ip1a, ders, *, start_at: datetime.datetime, odenmis: bool):
    """`ders` ile aynı eğitmen ve öğrenciye ikinci bir ders (fabrika temizler)."""
    async with AsyncSessionLocal() as s:
        b = Booking(
            tutor_id=ders.tutor_id,
            client_id=ders.client_id,
            status=BookingStatus.PENDING,
            start_at=start_at,
            end_at=start_at + datetime.timedelta(hours=1),
            price=ders.amount,
            mode="ONLINE",
        )
        s.add(b)
        await s.flush()
        booking_id = b.id
        await s.commit()
    ip1a.booking_ids.append(booking_id)
    if odenmis:
        async with AsyncSessionLocal() as s:
            b = await s.get(Booking, booking_id)
            await booking_service.accept(s, b)
            await s.commit()
        async with AsyncSessionLocal() as s:
            b = await s.get(Booking, booking_id)
            await payment_service.pay(s, b)
            await s.commit()
    return booking_id


async def _izin_sayisi(tutor_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return int(
            (
                await s.execute(
                    text("SELECT count(*) FROM tutor_time_off WHERE tutor_id = :t"),
                    {"t": tutor_id},
                )
            ).scalar_one()
        )


async def _booking(booking_id: int) -> Booking:
    async with AsyncSessionLocal() as s:
        return await s.get(Booking, booking_id)


async def test_izin_uzak_odenmis_dersi_iptal_ve_iade_eder_bekleyen_talebi_reddeder(
    ip1a, provider, ip1a_http
):
    ders = await ip1a.odenmis(start_at=_saat_basi(datetime.timedelta(days=5)))
    talep_id = await _ayni_egitmene_ders(
        ip1a, ders, start_at=_saat_basi(datetime.timedelta(days=5, hours=3)), odenmis=False
    )

    r = await ip1a_http.post(
        KOK,
        json=_govde(
            _saat_basi(datetime.timedelta(days=4)),
            _saat_basi(datetime.timedelta(days=7)),
            title="Tatil",
            note="Ailevi bir durum",
        ),
        headers=ders.tutor_auth,
    )
    assert r.status_code == 201, r.text
    govde = r.json()
    assert govde["cancelled_count"] == 2
    assert govde["skipped_ids"] == []
    assert govde["time_off"]["title"] == "Tatil"

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED
    assert payment_status in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None
    iptal = await _booking(ders.booking_id)
    assert iptal.cancelled_by_role == 2
    assert iptal.cancelled_at is not None
    assert iptal.cancel_reason.startswith("Öğretmen izinde")

    talep = await _booking(talep_id)
    assert talep.status is BookingStatus.REJECTED
    assert talep.cancel_reason.startswith("Öğretmen izinde")
    assert await _izin_sayisi(ders.tutor_id) == 1


async def test_12_saatten_yakin_onayli_ders_izni_engeller(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat_basi(datetime.timedelta(hours=7)))

    r = await ip1a_http.post(
        f"{KOK}/preview",
        json=_govde(_saat_basi(datetime.timedelta(hours=2)), _saat_basi(datetime.timedelta(days=1))),
        headers=ders.tutor_auth,
    )
    assert r.status_code == 200, r.text
    assert r.json()["blocked"] is True
    assert r.json()["bookings"][0]["can_cancel"] is False

    r = await ip1a_http.post(
        KOK,
        json=_govde(
            _saat_basi(datetime.timedelta(hours=2)),
            _saat_basi(datetime.timedelta(days=1)),
            note="Hastayım",
        ),
        headers=ders.tutor_auth,
    )
    assert r.status_code == 409, r.text
    assert "12 saatten az" in r.json()["detail"]

    assert await _izin_sayisi(ders.tutor_id) == 0
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert provider.refund_calls == []


async def test_izin_araligina_rezervasyon_yapilamaz(ip1a, provider, ip1a_http):
    ders = await ip1a.ders()  # +30 gün, izinle kesişmez
    izin_bas = _saat_basi(datetime.timedelta(days=10))

    r = await ip1a_http.post(
        KOK, json=_govde(izin_bas, izin_bas + datetime.timedelta(days=1)), headers=ders.tutor_auth
    )
    assert r.status_code == 201, r.text
    assert r.json()["cancelled_count"] == 0

    ders_bas = izin_bas + datetime.timedelta(hours=5)
    r = await ip1a_http.post(
        "/api/v1/bookings",
        json={
            "tutor_id": ders.tutor_id,
            "start_at": ders_bas.isoformat(),
            "end_at": (ders_bas + datetime.timedelta(hours=1)).isoformat(),
        },
        headers=ders.client_auth,
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "Öğretmen bu tarihte izinde"


async def test_talep_24_saat_ve_14_gun_kurali(ip1a, provider, ip1a_http):
    """Modül 3: bildirim süresi ve talep penceresi sunucuda zorunlu (422)."""
    ders = await ip1a.ders()

    async def talep(start: datetime.datetime):
        return await ip1a_http.post(
            "/api/v1/bookings",
            json={
                "tutor_id": ders.tutor_id,
                "start_at": start.isoformat(),
                "end_at": (start + datetime.timedelta(hours=1)).isoformat(),
            },
            headers=ders.client_auth,
        )

    r = await talep(_saat_basi(datetime.timedelta(hours=5)))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "Ders en az 24 saat önceden talep edilmeli."

    r = await talep(_saat_basi(datetime.timedelta(days=15)))
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "Ders en fazla 14 gün sonrası için talep edilebilir."


async def test_onizleme_mevcut_izinle_cakismayi_bildirir(ip1a, provider, ip1a_http):
    ders = await ip1a.ders()
    izin_bas = _saat_basi(datetime.timedelta(days=3))
    govde = _govde(izin_bas, izin_bas + datetime.timedelta(hours=4))

    r = await ip1a_http.post(f"{KOK}/preview", json=govde, headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert r.json()["overlap"] is False

    r = await ip1a_http.post(KOK, json=govde, headers=ders.tutor_auth)
    assert r.status_code == 201, r.text

    r = await ip1a_http.post(f"{KOK}/preview", json=govde, headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert r.json()["overlap"] is True


async def test_asama_2de_yarisi_kaybeden_ders_atlanir_izin_kalir(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat_basi(datetime.timedelta(days=5)))
    ikinci_id = await _ayni_egitmene_ders(
        ip1a, ders, start_at=_saat_basi(datetime.timedelta(days=5, hours=3)), odenmis=True
    )

    # İlk dersin iadesi sağlayıcıdayken ikinci ders başka bir yoldan sonuçlanır.
    orijinal = provider.refund
    tetiklendi = False

    async def yarisan_iade(**kw):
        nonlocal tetiklendi
        if not tetiklendi:
            tetiklendi = True
            await ip1a.terminal_yap(ikinci_id, BookingStatus.CANCELLED)
        return await orijinal(**kw)

    provider.refund = yarisan_iade

    r = await ip1a_http.post(
        KOK,
        json=_govde(
            _saat_basi(datetime.timedelta(days=4)),
            _saat_basi(datetime.timedelta(days=6)),
            note="Seyahatteyim",
        ),
        headers=ders.tutor_auth,
    )
    assert r.status_code == 201, r.text
    govde = r.json()
    assert govde["cancelled_count"] == 1
    assert govde["skipped_ids"] == [ikinci_id]
    assert await _izin_sayisi(ders.tutor_id) == 1

    assert (await ip1a.durumlar(ders.booking_id))[0] is BookingStatus.CANCELLED
    assert len(provider.refund_calls) == 1, "yarışı kaybeden ders için iade emri gitti"
    assert (await _booking(ikinci_id)).cancelled_by_role is None


async def test_asama_2de_izin_disina_ertelenen_ders_reddedilmez(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat_basi(datetime.timedelta(days=5)))
    ikinci_id = await _ayni_egitmene_ders(
        ip1a, ders, start_at=_saat_basi(datetime.timedelta(days=5, hours=3)), odenmis=True
    )
    yeni_bas = _saat_basi(datetime.timedelta(days=9))

    orijinal = provider.refund
    tetiklendi = False

    async def yarisan_iade(**kw):
        nonlocal tetiklendi
        if not tetiklendi:
            tetiklendi = True
            # Öğrenci ikinci dersi izin dışına erteler (ACCEPTED -> PENDING).
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text(
                        "UPDATE bookings SET start_at = :b, end_at = :e, status = 'PENDING' "
                        "WHERE id = :i"
                    ),
                    {"b": yeni_bas, "e": yeni_bas + datetime.timedelta(hours=1), "i": ikinci_id},
                )
                await s.commit()
        return await orijinal(**kw)

    provider.refund = yarisan_iade

    r = await ip1a_http.post(
        KOK,
        json=_govde(
            _saat_basi(datetime.timedelta(days=4)),
            _saat_basi(datetime.timedelta(days=6)),
            note="Seyahatteyim",
        ),
        headers=ders.tutor_auth,
    )
    assert r.status_code == 201, r.text
    assert r.json()["cancelled_count"] == 1
    assert r.json()["skipped_ids"] == [ikinci_id]
    assert len(provider.refund_calls) == 1
    ikinci = await _booking(ikinci_id)
    assert ikinci.status is BookingStatus.PENDING
    assert ikinci.cancel_reason is None


async def test_baska_egitmenin_izni_silinemez(ip1a, provider, ip1a_http):
    sahip = await ip1a.ders()
    yabanci = await ip1a.ders()
    izin_bas = _saat_basi(datetime.timedelta(days=3))

    r = await ip1a_http.post(
        KOK, json=_govde(izin_bas, izin_bas + datetime.timedelta(hours=4)), headers=sahip.tutor_auth
    )
    assert r.status_code == 201, r.text
    izin_id = r.json()["time_off"]["id"]

    r = await ip1a_http.delete(f"{KOK}/{izin_id}", headers=yabanci.tutor_auth)
    assert r.status_code == 404, r.text
    assert await _izin_sayisi(sahip.tutor_id) == 1

    r = await ip1a_http.delete(f"{KOK}/{izin_id}", headers=sahip.tutor_auth)
    assert r.status_code == 204, r.text
    assert await _izin_sayisi(sahip.tutor_id) == 0
