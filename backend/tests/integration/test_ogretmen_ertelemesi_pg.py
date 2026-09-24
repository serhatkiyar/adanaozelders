"""Öğretmenin dersi başka zamana alması ve "Onaylamayı hatırlat" (24 Eyl 2026).

## Ölçülen iş kuralı (kullanıcı kararı, Preply deseni)

* Öğretmen onaylı dersi başka saate alır: ders ACCEPTED kalır, süre/ücret/oda
  değişmez, emanet (HELD) dokunulmaz; öğrenciye "uygun mu" sorulur.
* 12 saat kala öğretmen iptal EDEMEZ ama başka zamana ALABİLİR.
* Öğrenci "uygun değil" derse ders iptal olur ve ücret HER ZAMAN iade edilir —
  12 saatten az kalsa bile (öğretmen dersi şimdiye yakın bir saate alıp geç iptal
  yoluyla parayı kendine geçiremez). İptal öğretmenin hanesine yazılır.
* Yanıt beklenirken öğrencinin normal iptali de geç iptal sayılmaz (tam iade).
* Öğretmen, bitmiş ve onay bekleyen derste öğrenciye günde en fazla bir
  hatırlatma gönderebilir.

Kurulum `ip1a` fabrikasının gerçek üretim yolundan (accept + pay) gelir.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus

KOK = "/api/v1/bookings"
IADE_YOLUNDA = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)


def _simdi() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _saat(n: float) -> datetime.datetime:
    # 15 dakikalık ızgaraya oturt (ders penceresi doğrulaması).
    t = _simdi() + datetime.timedelta(hours=n)
    return t.replace(minute=(t.minute // 15) * 15, second=0, microsecond=0)


async def _booking(booking_id: int) -> Booking:
    async with AsyncSessionLocal() as s:
        return await s.get(Booking, booking_id)


async def _ertele(http, ders, start: datetime.datetime, auth=None):
    return await http.post(
        f"{KOK}/{ders.booking_id}/tutor-reschedule",
        json={"start_at": start.isoformat()},
        headers=auth or ders.tutor_auth,
    )


async def test_ogretmen_ertelemesi_saati_tasir_ucret_oda_emanet_ayni_kalir(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    once = await _booking(ders.booking_id)
    yeni = _saat(72)

    r = await _ertele(ip1a_http, ders, yeni)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "ACCEPTED"
    assert j["tutor_rescheduled_from"] is not None

    b = await _booking(ders.booking_id)
    assert abs(b.start_at - yeni) < datetime.timedelta(seconds=1)
    assert b.end_at - b.start_at == once.end_at - once.start_at, "süre değişti"
    assert Decimal(str(b.price)) == Decimal(str(once.price)), "ücret değişti"
    assert b.meeting_room == once.meeting_room, "ders odası sıfırlandı"
    assert (await ip1a.durumlar(ders.booking_id)) == (BookingStatus.ACCEPTED, PaymentStatus.HELD)
    assert provider.refund_calls == []


async def test_12_saat_kala_ogretmen_iptal_edemez_ama_erteleyebilir(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(6))

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "test"}, headers=ders.tutor_auth
    )
    assert r.status_code == 409
    assert "başka zamana" in r.json()["detail"]

    r = await _ertele(ip1a_http, ders, _saat(30))
    assert r.status_code == 200, r.text


async def test_ogrenci_reddi_12_saat_icinde_bile_tam_iade_ve_iptal_ogretmene_yazilir(
    ip1a, provider, ip1a_http
):
    ders = await ip1a.odenmis(start_at=_saat(48))
    # Öğretmen dersi şimdiye yakın bir saate çeker (geç iptal eşiğinin içine).
    r = await _ertele(ip1a_http, ders, _saat(5))
    assert r.status_code == 200, r.text

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/tutor-reschedule/decline", headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    assert r.json()["late_cancel"] is False

    durum, odeme = await ip1a.durumlar(ders.booking_id)
    assert durum is BookingStatus.CANCELLED
    assert odeme in IADE_YOLUNDA, f"ret parayı öğretmene geçirdi ({odeme})"
    assert len(provider.refund_calls) == 1
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
    b = await _booking(ders.booking_id)
    assert b.cancelled_by_role == 2, "iptal öğretmenin hanesine yazılmadı"
    assert b.tutor_rescheduled_from is None


async def test_yanit_beklerken_ogrencinin_gec_iptali_de_tam_iade(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    assert (await _ertele(ip1a_http, ders, _saat(5))).status_code == 200

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "uymadı"}, headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    assert r.json()["late_cancel"] is False
    _, odeme = await ip1a.durumlar(ders.booking_id)
    assert odeme in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1


async def test_ogrenci_kabulu_bekleyen_degisikligi_kapatir(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    assert (await _ertele(ip1a_http, ders, _saat(72))).status_code == 200

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/tutor-reschedule/accept", headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    assert r.json()["tutor_rescheduled_from"] is None
    # Artık yanıt beklenmiyor: ret 409.
    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/tutor-reschedule/decline", headers=ders.client_auth
    )
    assert r.status_code == 409
    assert (await ip1a.durumlar(ders.booking_id)) == (BookingStatus.ACCEPTED, PaymentStatus.HELD)


async def test_ertelemeyi_ogrenci_yapamaz_reddi_ogretmen_yapamaz(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    assert (await _ertele(ip1a_http, ders, _saat(72), auth=ders.client_auth)).status_code == 403
    assert (await _ertele(ip1a_http, ders, _saat(72))).status_code == 200
    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/tutor-reschedule/decline", headers=ders.tutor_auth
    )
    assert r.status_code == 403


async def test_onaylamayi_hatirlat_gunde_bir_kez_ve_yalniz_ogretmen(ip1a, provider, ip1a_http):
    # Ödenmiş, 2 saat önce bitmiş, öğrencinin onaylamadığı ders.
    ders = await ip1a.odenmis(start_at=_simdi() - datetime.timedelta(hours=3))

    j = (await ip1a_http.get(f"{KOK}/{ders.booking_id}", headers=ders.tutor_auth)).json()
    assert j["can_remind_confirm"] is True

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/remind-confirm", headers=ders.client_auth)
    assert r.status_code == 403

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/remind-confirm", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    assert r.json()["can_remind_confirm"] is False

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/remind-confirm", headers=ders.tutor_auth)
    assert r.status_code == 409, "aynı gün ikinci hatırlatma gönderildi"
    bildirimler = [
        m for _id, m in await ip1a.bildirimler(user_id=ders.client_id, role_id=3)
        if "onaylamanı rica" in m
    ]
    assert len(bildirimler) == 1


async def test_baslamamis_derste_hatirlatma_409(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/remind-confirm", headers=ders.tutor_auth)
    assert r.status_code == 409


async def test_bekleyen_degisiklik_baslamis_dersin_iptaline_kapi_acmaz(ip1a, provider, ip1a_http):
    """Değişiklik yanıtsız kalıp ders başladıysa öğrenci iptal edip iade alamaz."""
    ders = await ip1a.odenmis(start_at=_simdi() - datetime.timedelta(minutes=30))
    async with AsyncSessionLocal() as s:
        b = await s.get(Booking, ders.booking_id)
        b.tutor_rescheduled_from = b.start_at - datetime.timedelta(days=1)
        await s.commit()

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "test"}, headers=ders.client_auth
    )
    assert r.status_code == 409, f"başlamış ders iptal edildi ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id)) == (BookingStatus.ACCEPTED, PaymentStatus.HELD)
    assert provider.refund_calls == []


async def test_ogrencinin_kendi_ertelemesi_bekleyen_degisikligi_kapatir(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_saat(48))
    assert (await _ertele(ip1a_http, ders, _saat(72))).status_code == 200
    yeni = _saat(96)
    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/reschedule",
        json={
            "start_at": yeni.isoformat(),
            "end_at": (yeni + datetime.timedelta(hours=1)).isoformat(),
        },
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    assert (await _booking(ders.booking_id)).tutor_rescheduled_from is None
