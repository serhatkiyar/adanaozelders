"""İP-1a P0-4 — Dispute açıkken auto-complete/release (GERÇEK PG + GERÇEK HTTP).

## Ölçülen iş kuralı

**İhtilaflı ders otomatik tamamlanamaz ve emaneti serbest bırakılamaz.** Dispute,
"bu derste bir sorun var, para hareketi beklesin" demenin tek yoludur; para
`RELEASED` olduktan sonra `released_at` guard'ı (`services/escrow.py:226-230`)
iadeyi kalıcı olarak kapatır, yani admin çözüm üretmeye kalktığında elinde
hiçbir araç kalmaz.

## Bugünkü gerçek akış

`auto_complete_past_bookings` sorgusu üç koşul taşır (`booking_service.py:573-581`):
`status == ACCEPTED`, `deleted_at IS NULL`, `end_at <= cutoff`. **`is_disputed`
yoktur.**

Daha genel bulgu: `is_disputed` (`models/booking.py:78-80`) **hiçbir para veya FSM
kararında okunmaz**. Tek yazma yolu `admin_service.toggle_dispute`; okuma yolları
yalnız admin listesi filtresi ve dashboard sayacı. Yani bayrak bugün salt bir
etikettir ve `AUTO_COMPLETE_GRACE_HOURS` (=12) sonra para yine eğitmene geçer.

## Neden yalnız sorgu satırı test edilmiyor

Elle `complete` yolu (`booking_service.py:446-462`) aynı boşluğu taşır. Sözleşme
her iki yolu birden bağlar; yalnız arka plan sorgusuna guard eklemek, eğitmenin
"Tamamla" düğmesine basmasıyla aynı sonucu üretmeye devam ederdi.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import BookingStatus
from models.payment import PaymentStatus
from services import booking_service

ADMIN_KOK = "/api/v1/admin/bookings"
BOOKING_KOK = "/api/v1/bookings"
TAM_IZIN = ["bookings.view", "bookings.manage"]

#: `AUTO_COMPLETE_GRACE_HOURS` (=12) fazlasıyla aşılsın.
GECMIS = datetime.timedelta(days=40)


async def _gecmis_ihtilafli_ders(ip1a, ip1a_http, *, ihtilafli: bool = True):
    """Geçmişte bitmiş, ödenmiş, (isteğe bağlı) ihtilaflı bir ders.

    Dispute bayrağı GERÇEK admin ucundan konur — ORM ile elle set edilmez, aksi
    halde "admin bunu işaretleyebiliyor mu" sorusu cevapsız kalırdı.
    """
    ders = await ip1a.odenmis()
    if ihtilafli:
        _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)
        r = await ip1a_http.post(
            f"{ADMIN_KOK}/{ders.booking_id}/dispute",
            json={"is_disputed": True, "admin_notes": "İP-1a: ihtilaf açıldı"},
            headers=admin_auth,
        )
        assert r.status_code == 200, r.text
    await ip1a.zamani_kaydir(ders.booking_id, delta=-GECMIS)
    return ders


async def _auto_complete_turu() -> int:
    """Üretimin çağırdığı arka plan işini birebir koşturur (`main.py:88`)."""
    async with AsyncSessionLocal() as s:
        n = await booking_service.auto_complete_past_bookings(s)
        await s.commit()
    return n


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_ihtilafli_ders_OTOMATIK_TAMAMLANMAZ(ip1a, provider, ip1a_http):
    """P0-4 çekirdeği: dispute açıkken arka plan işi dersi tamamlayamaz."""
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http)

    await _auto_complete_turu()

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.ACCEPTED, (
        f"İHTİLAFLI DERS OTOMATİK TAMAMLANDI (booking={booking_status.value}). "
        "is_disputed hiçbir para/FSM kararında okunmuyor; auto_complete sorgusu "
        "(booking_service.py:573-581) yalnız status/deleted_at/end_at bakıyor."
    )
    assert payment_status is PaymentStatus.HELD, (
        f"ihtilaflı dersin emaneti {payment_status} oldu — para hareket etti"
    )


async def test_ihtilafli_derste_EMANET_SERBEST_BIRAKILMAZ(ip1a, provider, ip1a_http):
    """Para tarafı ayrıca ölçülür: `released_at` ve hak ediş.

    Booking durumundan bağımsız bir ölçüm gerekir: düzeltme "booking'i COMPLETED
    yap ama parayı bırakma" biçiminde de yazılabilir ve o da kabul edilebilir bir
    çözümdür. Asıl kırmızı çizgi paranın geri alınamaz hâle gelmesidir.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http)

    await _auto_complete_turu()

    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None, (
        "ihtilaflı derste released_at damgalandı — iade kalıcı olarak kapandı "
        "(escrow.py:226-230), admin çözüm üretemez"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00"), (
        "ihtilaflı ders eğitmenin ödenebilir bakiyesine yazıldı"
    )
    assert provider.refund_calls == [], "ihtilaf açmak iade emri üretmemeli"


async def test_ihtilafli_ders_ELLE_de_tamamlanamaz(ip1a, provider, ip1a_http):
    """Yalnız arka plan sorgusunu kapatmak yetmez — elle yol da bağlanmalı.

    Aksi halde eğitmen "Tamamla" düğmesiyle aynı sonucu üretir ve düzeltme
    yalnız görüntüde olur.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http)

    r = await ip1a_http.post(f"{BOOKING_KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 409, (
        f"ihtilaflı ders elle tamamlanabildi ({r.status_code})"
    )
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None


async def test_ihtilaf_KALKINCA_otomatik_tamamlama_yeniden_calisir(ip1a, provider, ip1a_http):
    """Dispute kalıcı bir kilit değildir; admin çözünce akış devam etmeli.

    Bu test bugün kırmızıdır ama "yanlış yönden": bayrak hiç okunmadığı için ilk
    turda zaten tamamlanır ve bayrağın kalkması ölçülemez. Sözleşme yazıldığında
    tek anlamlı hâle gelir ve düzeltmenin dersi SONSUZA DEK kilitlemediğini kanıtlar.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http)
    _aid, admin_auth = await ip1a.admin(izinler=TAM_IZIN)

    await _auto_complete_turu()
    assert (await ip1a.durumlar(ders.booking_id))[0] is BookingStatus.ACCEPTED, (
        "kurulum: ihtilaflı ders ilk turda zaten tamamlandı"
    )

    r = await ip1a_http.post(
        f"{ADMIN_KOK}/{ders.booking_id}/dispute",
        json={"is_disputed": False, "admin_notes": "İP-1a: ihtilaf çözüldü"},
        headers=admin_auth,
    )
    assert r.status_code == 200, r.text

    await _auto_complete_turu()

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.COMPLETED, (
        "ihtilaf kalktıktan sonra ders hâlâ tamamlanmıyor — kilit kalıcı olmuş"
    )
    assert payment_status is PaymentStatus.RELEASED


# ═══════════════════════ YEŞİL NÖBETÇİLER ════════════════════════════════════


async def test_YESIL_ihtilafsiz_gecmis_ders_OTOMATIK_TAMAMLANIR(ip1a, provider, ip1a_http):
    """Doğru yol hâlâ çalışmalı: süresi geçmiş temiz ders tamamlanır, para açılır.

    P0-4 düzeltmesi filtreye bir koşul ekleyecek; yanlış yazılırsa (ör. `is_(True)`
    yerine `is_(False)` unutulması, ya da NULL semantiği) hiçbir ders otomatik
    tamamlanmaz ve eğitmenler parasını hiç alamaz. Bu nöbetçi onu yakalar.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http, ihtilafli=False)

    n = await _auto_complete_turu()
    assert n >= 1, "süresi geçmiş temiz ders otomatik tamamlanmadı"

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.COMPLETED
    assert payment_status is PaymentStatus.RELEASED

    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is not None
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"]))


async def test_YESIL_gelecekteki_ders_otomatik_tamamlanmaz(ip1a, provider, ip1a_http):
    """Zaman filtresi hâlâ çalışıyor — auto-complete geleceği süpürmüyor."""
    ders = await ip1a.odenmis()  # +30 gün

    await _auto_complete_turu()

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )


async def test_YESIL_auto_complete_IPTAL_EDILMIS_dersi_diriltmez(ip1a, provider, ip1a_http):
    """Terminal booking arka plan işinin kapsamına girmez.

    `_claim_transition` ACCEPTED dışından COMPLETED'a geçişe izin vermez; bu
    nöbetçi o atomik claim'in düşürülmediğini sabitler.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-GECMIS)
    r = await ip1a_http.post(
        f"{BOOKING_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a nöbetçi"},
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    iade_once = len(provider.refund_calls)

    await _auto_complete_turu()

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED, "iptal edilmiş ders dirildi"
    assert payment_status is not PaymentStatus.RELEASED, (
        "iade edilmiş/edilen ödeme sonradan eğitmene açıldı"
    )
    assert len(provider.refund_calls) == iade_once


async def test_YESIL_auto_complete_ayni_dersi_IKI_KEZ_islemez(ip1a, provider, ip1a_http):
    """İki ardışık tur ikinci bir para hareketi üretmemeli (idempotency).

    Birinci turun GERÇEKTEN bir tamamlama ürettiği önce sabitlenir; aksi halde
    "hiç işlenmediği için iki kez de işlenmedi" biçiminde boş bir yeşil olurdu.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http, ihtilafli=False)

    assert await _auto_complete_turu() >= 1, "ilk tur hiçbir dersi tamamlamadı"
    p_ilk = await ip1a.payment(ders.booking_id)
    assert p_ilk["released_at"] is not None

    await _auto_complete_turu()

    p_ikinci = await ip1a.payment(ders.booking_id)
    assert p_ikinci["released_at"] == p_ilk["released_at"], (
        "ikinci tur released_at damgasını yeniden yazdı — çift serbest bırakma"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(
        str(p_ilk["tutor_earning"])
    ), "kazanç iki kez sayıldı"
