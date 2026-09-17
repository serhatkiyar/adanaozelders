"""Modül 2 (17 Eyl 2026) — öğrenci ders onayı, sorun bildirimi, 12 saat kuralı.

## Ölçülen iş kuralı (kullanıcı kararı)

* Eğitmenin "Tamamla"sı dersi `COMPLETED` yapar ama **parayı serbest bırakmaz**.
  Para öğrenci `/confirm` dediğinde ya da ders bitiminden
  `LESSON_CONFIRM_WINDOW_HOURS` (72) sonra sorunsuz dolan pencerede eğitmene geçer.
* Öğrenci pencere içinde `/report-issue` ile sorun bildirirse ders ihtilaflı
  olur; para admin kararına (`/admin/bookings/{id}/dispute/resolve`) kadar
  emanette kalır.
* `LESSON_LATE_CANCEL_HOURS` (12): kabul edilmiş derse 12 saatten az kala
  eğitmen iptal edemez, öğrenci erteleyemez; öğrenci iptal ederse ücret iade
  edilmez, eğitmene geçer.

Kurulum GERÇEK üretim yolundan gelir (`ip1a` fabrikası: accept + pay) ve para
durumu hiç elle yazılmaz. Yakın/geçmiş saatli ders fabrikanın `start_at=`
parametresiyle ya da `zamani_kaydir` ile kurulur.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus
from services import booking_service

KOK = "/api/v1/bookings"
ADMIN_KOK = "/api/v1/admin/bookings"
TAM_IZIN = ["bookings.view", "bookings.manage"]
IADE_YOLUNDA = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)


def _simdi() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _bitmis_ders(ip1a, *, bitis_once: datetime.timedelta):
    """Ödenmiş (HELD), `bitis_once` kadar önce bitmiş 1 saatlik ders."""
    return await ip1a.odenmis(start_at=_simdi() - bitis_once - datetime.timedelta(hours=1))


async def _auto_complete_turu() -> int:
    async with AsyncSessionLocal() as s:
        n = await booking_service.auto_complete_past_bookings(s)
        await s.commit()
    return n


async def _booking(booking_id: int) -> Booking:
    async with AsyncSessionLocal() as s:
        return await s.get(Booking, booking_id)


async def _tamamla(ip1a_http, ders):
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text


async def _sorun_bildir(ip1a_http, ders, *, auth=None, reason="TUTOR_ABSENT"):
    return await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/report-issue",
        json={"reason": reason, "note": "Eğitmen derse gelmedi"},
        headers=auth or ders.client_auth,
    )


async def _karar(ip1a_http, ders, admin_auth, decision: str):
    return await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/dispute/resolve",
        json={"decision": decision, "note": "M2 test"},
        headers=admin_auth,
    )


# ═══════════════════════ Onay ════════════════════════════════════════════════


async def test_egitmen_tamamlamasi_HELD_birakir_ogrenci_onayi_RELEASED_yapar_ikinci_onay_idempotent(
    ip1a, provider, ip1a_http
):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))

    await _tamamla(ip1a_http, ders)
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    ), "eğitmen tamamlaması parayı öğrenci onayı beklemeden serbest bıraktı"
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text
    assert r.json()["student_confirmed_at"] is not None
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )
    ilk = await ip1a.payment(ders.booking_id)
    assert ilk["released_at"] is not None
    ilk_onay = (await _booking(ders.booking_id)).student_confirmed_at

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, f"ikinci onay idempotent değil ({r.status_code})"

    ikinci = await ip1a.payment(ders.booking_id)
    assert ikinci["released_at"] == ilk["released_at"], "ikinci onay released_at'i yeniden yazdı"
    assert (await _booking(ders.booking_id)).student_confirmed_at == ilk_onay
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(ilk["tutor_earning"])), (
        "kazanç iki kez sayıldı"
    )
    kazanc_bildirimleri = [
        m for _id, m in await ip1a.bildirimler(user_id=ders.tutor_id, role_id=2)
        if "kazancına eklendi" in m
    ]
    assert len(kazanc_bildirimleri) == 1, "ikinci onay ikinci bir release üretti"
    assert provider.refund_calls == []


async def test_egitmen_tamamlamadan_ogrenci_onayi_dersi_tamamlar_ve_parayi_acar(
    ip1a, provider, ip1a_http
):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=1))

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )


async def test_baslamamis_derste_onay_ve_sorun_bildirimi_409(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis()  # +30 gün

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 409, f"başlamamış ders onaylandı ({r.status_code})"
    r = await _sorun_bildir(ip1a_http, ders)
    assert r.status_code == 409, f"başlamamış derse sorun bildirildi ({r.status_code})"

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    b = await _booking(ders.booking_id)
    assert b.is_disputed is False and b.student_confirmed_at is None


async def test_baska_ogrencinin_dersini_onaylayamaz_ve_sorun_bildiremez(
    ip1a, provider, ip1a_http
):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    yabanci = await ip1a.odenmis()

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=yabanci.client_auth)
    assert r.status_code == 403, f"başka öğrenci dersi onayladı ({r.status_code})"
    r = await _sorun_bildir(ip1a_http, ders, auth=yabanci.client_auth)
    assert r.status_code == 403, f"başka öğrenci sorun bildirdi ({r.status_code})"

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.tutor_auth)
    assert r.status_code == 403, f"eğitmen öğrenci onayını verebildi ({r.status_code})"

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert (await _booking(ders.booking_id)).is_disputed is False


# ═══════════════════════ Sorun bildirimi ═════════════════════════════════════


async def test_sorun_bildirimi_ihtilaf_acar_para_HELD_kalir_onay_ve_otomatik_onay_acmaz(
    ip1a, provider, ip1a_http
):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    await _tamamla(ip1a_http, ders)

    r = await _sorun_bildir(ip1a_http, ders)
    assert r.status_code == 200, r.text
    govde = r.json()
    assert govde["is_disputed"] is True
    assert govde["issue_reason"] == "TUTOR_ABSENT"
    assert govde["issue_reported_at"] is not None

    r = await _sorun_bildir(ip1a_http, ders)
    assert r.status_code == 409, "aynı derse ikinci sorun bildirimi kabul edildi"

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 409, f"ihtilaflı ders onaylandı ({r.status_code})"

    # Pencere çoktan dolmuş olsa bile otomatik onay ihtilaflı dersin parasını açmaz.
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(hours=100))
    await _auto_complete_turu()

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    )
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None, "sorun bildirilmiş dersin parası eğitmene geçti"
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
    assert provider.refund_calls == []


async def test_onaylanmis_derse_sorun_bildirilemez(ip1a, provider, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text

    r = await _sorun_bildir(ip1a_http, ders)
    assert r.status_code == 409, f"onaylanmış derse sorun bildirildi ({r.status_code})"
    assert (await _booking(ders.booking_id)).is_disputed is False
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.RELEASED


async def test_pencere_dolduktan_sonra_sorun_bildirilemez(ip1a, provider, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=73))

    r = await _sorun_bildir(ip1a_http, ders)
    assert r.status_code == 409, f"72 saat sonra sorun bildirildi ({r.status_code})"
    assert (await _booking(ders.booking_id)).is_disputed is False
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.HELD


# ═══════════════════════ Otomatik onay (72 saat) ═════════════════════════════


async def test_72_saati_gecmis_onaysiz_tamamlanmis_ders_otomatik_RELEASED_olur(
    ip1a, provider, ip1a_http
):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    await _tamamla(ip1a_http, ders)
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(hours=71))  # 73 sa

    assert await _auto_complete_turu() >= 1

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is not None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"]))

    # İkinci tur ikinci hareket üretmez.
    await _auto_complete_turu()
    assert (await ip1a.payment(ders.booking_id))["released_at"] == p["released_at"]


async def test_71_saat_gecmis_tamamlanmis_ders_otomatik_onaylanmaz(ip1a, provider, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    await _tamamla(ip1a_http, ders)
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(hours=69))  # 71 sa

    await _auto_complete_turu()

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    ), "72 saat dolmadan öğrenci onayı beklenmeden para eğitmene geçti"
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None


# ═══════════════════════ Admin kararı ════════════════════════════════════════


async def _ihtilafli_tamamlanmis(ip1a, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    await _tamamla(ip1a_http, ders)
    r = await _sorun_bildir(ip1a_http, ders, reason="LESSON_NOT_HELD")
    assert r.status_code == 200, r.text
    return ders


async def test_admin_karari_release_parayi_egitmene_gecirir(ip1a, provider, ip1a_http):
    ders = await _ihtilafli_tamamlanmis(ip1a, ip1a_http)
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    r = await _karar(ip1a_http, ders, admin_auth, "release")
    assert r.status_code == 200, r.text

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.RELEASED,
    )
    assert (await _booking(ders.booking_id)).is_disputed is False
    p = await ip1a.payment(ders.booking_id)
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"]))
    assert provider.refund_calls == []
    assert (
        await ip1a.audit_sayisi(target_id=ders.booking_id, action="booking.dispute_resolve.release")
        == 1
    )


async def test_admin_karari_refund_tamamlanmis_dersi_iptal_eder_tek_iade(
    ip1a, provider, ip1a_http
):
    ders = await _ihtilafli_tamamlanmis(ip1a, ip1a_http)
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    r = await _karar(ip1a_http, ders, admin_auth, "refund")
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED
    assert payment_status in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1
    assert provider.refund_calls[0][1] == ders.amount
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")

    # Karar verilmiş derste ikinci karar yok: ihtilaf kapandı → 409, yeni iade emri yok.
    for karar in ("refund", "release"):
        r = await _karar(ip1a_http, ders, admin_auth, karar)
        assert r.status_code == 409, f"ikinci '{karar}' kararı kabul edildi ({r.status_code})"
    assert len(provider.refund_calls) == 1, "ÇİFT İADE"
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None


async def test_ihtilafsiz_derste_admin_karari_409(ip1a, provider, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))
    await _tamamla(ip1a_http, ders)
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    for karar in ("refund", "release"):
        r = await _karar(ip1a_http, ders, admin_auth, karar)
        assert r.status_code == 409, f"ihtilafsız derste '{karar}' kabul edildi"
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    )
    assert provider.refund_calls == []


async def test_admin_karari_manage_izni_ister(ip1a, provider, ip1a_http):
    ders = await _ihtilafli_tamamlanmis(ip1a, ip1a_http)
    _aid, salt_okur = await ip1a.admin(izinler=["bookings.view"])

    r = await _karar(ip1a_http, ders, salt_okur, "refund")
    assert r.status_code == 403, f"bookings.manage olmadan karar verildi ({r.status_code})"
    assert provider.refund_calls == []
    assert (await _booking(ders.booking_id)).is_disputed is True


# ═══════════════════════ 12 saat kuralı ══════════════════════════════════════


async def test_ogrenci_6_saat_kala_iptal_eder_ucret_iade_edilmez_egitmene_gecer(
    ip1a, provider, ip1a_http
):
    ders = await ip1a.odenmis(start_at=_simdi() + datetime.timedelta(hours=6))

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "M2 geç iptal"}, headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    assert r.json()["late_cancel"] is True

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.CANCELLED,
        PaymentStatus.RELEASED,
    )
    assert provider.refund_calls == [], "geç iptalde iade emri gönderildi"
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is not None and p["refunded_at"] is None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"]))
    assert (await _booking(ders.booking_id)).late_cancel is True


async def test_egitmen_6_saat_kala_iptal_edemez(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_simdi() + datetime.timedelta(hours=6))

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "M2"}, headers=ders.tutor_auth
    )
    assert r.status_code == 409, f"eğitmen 6 saat kala iptal edebildi ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert provider.refund_calls == []


async def test_ogrenci_6_saat_kala_erteleyemez(ip1a, provider, ip1a_http):
    start = _simdi() + datetime.timedelta(hours=6)
    ders = await ip1a.odenmis(start_at=start)
    yeni = _simdi() + datetime.timedelta(days=10)

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/reschedule",
        json={
            "start_at": yeni.isoformat(),
            "end_at": (yeni + datetime.timedelta(hours=1)).isoformat(),
        },
        headers=ders.client_auth,
    )
    assert r.status_code == 409, f"6 saat kala ders ertelendi ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    b = await _booking(ders.booking_id)
    assert abs(b.start_at - start) < datetime.timedelta(seconds=1), "ders saati değişti"


async def test_baslamis_ders_ogrenci_tarafindan_iptal_edilemez(ip1a, provider, ip1a_http):
    ders = await _bitmis_ders(ip1a, bitis_once=datetime.timedelta(hours=2))

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "M2"}, headers=ders.client_auth
    )
    assert r.status_code == 409, f"başlamış ders iptal edildi ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert provider.refund_calls == []


async def test_ogrenci_48_saat_kala_iptal_eder_tam_iade(ip1a, provider, ip1a_http):
    ders = await ip1a.odenmis(start_at=_simdi() + datetime.timedelta(hours=48))

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel", json={"reason": "M2 erken iptal"}, headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    assert r.json()["late_cancel"] is False

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED
    assert payment_status in IADE_YOLUNDA
    assert len(provider.refund_calls) == 1
    assert provider.refund_calls[0][1] == ders.amount
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
