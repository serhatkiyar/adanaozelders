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
etikettir ve `LESSON_CONFIRM_WINDOW_HOURS` (=72, Modül 2) sonra para yine eğitmene geçer.

## Neden yalnız sorgu satırı test edilmiyor

Elle `complete` yolu (`booking_service.py:446-462`) aynı boşluğu taşır. Sözleşme
her iki yolu birden bağlar; yalnız arka plan sorgusuna guard eklemek, eğitmenin
"Tamamla" düğmesine basmasıyla aynı sonucu üretmeye devam ederdi.
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus
from services import admin_service, booking_service

# Sonlu kapı yardımcıları YENİDEN YAZILMAZ, ödünç alınır: yarış dosyasındaki
# `_event_bekle`/`_gorev_bekle` üretici görev hatasını gizlemez, süre koyar ve
# görev sızdırmaz (bkz. `test_ip1a_races_pg.py` başlığı, P1-3).
from tests.integration.test_ip1a_races_pg import (  # noqa: E402
    _event_bekle,
    _gorev_bekle,
    _gorevleri_kapat,
)

ADMIN_KOK = "/api/v1/admin/bookings"
BOOKING_KOK = "/api/v1/bookings"
TAM_IZIN = ["bookings.view", "bookings.manage"]

#: `LESSON_CONFIRM_WINDOW_HOURS` (=72) fazlasıyla aşılsın.
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
    # Modül 2: başlamış ders öğrenci tarafından iptal edilemez (409). Ders önce
    # (+30 gün, tam iade) iptal edilir, SONRA tarama kapsamına girsin diye
    # geçmişe kaydırılır.
    r = await ip1a_http.post(
        f"{BOOKING_KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a nöbetçi"},
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    await ip1a.zamani_kaydir(ders.booking_id, delta=-GECMIS)
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


# ═══════ CLAIM KATMANININ KENDİ NÖBETÇİSİ (nihai audit P1-A) ═════════════════
#
# Yukarıdaki dört kırmızı, ihtilaf korumasını **aday sorgusu** üzerinden ölçer:
# ihtilaf zaten açıkken tarama dersi hiç seçmez. Bağımsız nihai audit bunun
# yetmediğini gösterdi — sorgudaki `is_disputed=False` filtresi KORUNUP yalnız
# `COMPLETED` claim'indeki `extra_where=_IHTILAFSIZ` sökülünce **60 testin
# tamamı yeşil kaldı**, ama gerçek PostgreSQL probunda ders COMPLETED +
# is_disputed=True, ödeme RELEASED + released_at dolu oldu: ihtilaflı dersin
# parası açıldı ve iade kalıcı olarak kapandı.
#
# Boşluğun sebebi ölçüm penceresidir: sorgu ile yazım arasında geçen sürede
# açılan ihtilafı yalnız claim'in WHERE'i görebilir. Aşağıdaki test tam o
# pencereyi deterministik olarak kurar.


async def test_SORGUDAN_SONRA_acilan_ihtilaf_CLAIM_ANINDA_yakalanir(
    ip1a, provider, ip1a_http, monkeypatch
):
    """Aday sorgusundan SONRA açılan ihtilaf, yazım anında yeniden değerlendirilir.

    ## Kurulum — ardışıklık tahmin edilmez, ÖLÇÜLÜR

    `asyncio.gather` ile iki görevi "aynı anda" başlatmak bu pencereyi kurmaz:
    hangi tarafın önce başladığı olay döngüsüne kalır ve test, ölçmek istediği
    sıralamayı garanti edemez. Bunun yerine `_claim_transition` YALNIZ bu
    booking'in `COMPLETED` claim'i için bir kapıya bağlanır; sarmalayıcı gerçek
    fonksiyonu çağırır, yani üretim mantığı değişmez:

        auto-complete: SELECT (ders aday, ihtilafsız) ──► [claim kapısı]
        admin:                    toggle_dispute + COMMIT ──┘
        auto-complete: ── claim çalışır: WHERE is_disputed = false → 0 satır

    ## Neden mevcut testler yetmiyordu

    Dördü de ihtilafı taramadan ÖNCE açıyor; o hâlde aday sorgusu dersi zaten
    hiç seçmiyor ve claim'in koşulu hiç sınanmıyor. Yani sorgu filtresi claim
    guard'ını **gölgeliyordu** (kök CLAUDE.md §E: "eski bozuk kod da testi
    geçiyorsa o test düzeltmenin kanıtı değildir").

    ## Ölçülenler

    Ders tamamlanmadı · ihtilaf açık kaldı · para emanette · `released_at`
    damgalanmadı · eğitmene hak ediş yazılmadı · sağlayıcıya hiçbir emir
    gitmedi · tarama bu dersi tamamlanmış SAYMADI.
    """
    ders = await _gecmis_ihtilafli_ders(ip1a, ip1a_http, ihtilafli=False)

    # Modül 2 (17 Eyl 2026): tarama artık claim'den ÖNCE satırı `FOR UPDATE`
    # ile kilitleyip güncel hâlini yeniden okuyor (`_lock_booking`). Kapı bu
    # yüzden kilidin HEMEN ÖNCESİNDE durur; kilidin içinde dursaydı admin'in
    # UPDATE'i o kilidi bekler ve test kendi kendini kilitlerdi.
    claim_kapisinda, devam = asyncio.Event(), asyncio.Event()
    orijinal_kilit = booking_service._lock_booking

    async def kapili_kilit(db, booking, **kw):
        """YALNIZ hedef booking'in kilidini kapıya bağlar."""
        if booking.id == ders.booking_id:
            claim_kapisinda.set()
            await _event_bekle(
                devam,
                aciklama="test, kilidin 'devam' kapısını hiç açmadı",
            )
        return await orijinal_kilit(db, booking, **kw)

    monkeypatch.setattr(booking_service, "_lock_booking", kapili_kilit)

    gorev = asyncio.create_task(_auto_complete_turu(), name="auto-complete")
    try:
        await _event_bekle(
            claim_kapisinda,
            aciklama=(
                "auto-complete claim noktasına hiç gelmedi — aday sorgusu dersi "
                "seçmedi, dolayısıyla claim guard'ı sınanamıyor"
            ),
            ureticiler=(gorev,),
        )

        # İhtilaf AYRI bir session/transaction'da açılır ve COMMIT edilir.
        # Gerçek servis yolu çağrılır (ORM ile elle bayrak set edilmez).
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, ders.booking_id)
            await admin_service.toggle_dispute(
                s, booking, is_disputed=True, admin_notes="İP-1a: sorgudan sonra"
            )
            await s.commit()

        devam.set()
        tamamlanan = await _gorev_bekle(
            gorev, aciklama="kapı açıldıktan sonra auto-complete görevi bitmedi"
        )
    finally:
        # Test nasıl biterse bitsin pending görev kalmaz.
        await _gorevleri_kapat([gorev])

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.ACCEPTED, (
        f"SORGUDAN SONRA AÇILAN İHTİLAF YAKALANMADI: ders {booking_status.value} "
        "oldu. Aday sorgusundaki filtre bu pencereyi göremez; kararı kilitli "
        "yeniden okuma ve claim'in WHERE koşulu (extra_where=_IHTILAFSIZ) verir."
    )
    assert payment_status is PaymentStatus.HELD, (
        f"ihtilaflı dersin emaneti {payment_status} oldu — para hareket etti"
    )

    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None, (
        "ihtilaflı derste released_at damgalandı — iade kalıcı olarak kapandı "
        "(escrow.py released_at guard'ı), admin çözüm üretemez"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00"), (
        "ihtilaflı ders eğitmenin ödenebilir bakiyesine yazıldı"
    )
    assert provider.refund_calls == [], "bu senaryoda hiçbir iade emri beklenmez"
    assert tamamlanan == 0, (
        f"tarama {tamamlanan} dersi tamamlanmış saydı — kaybedilen claim "
        "sayaca yazılmamalı"
    )

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        assert booking.is_disputed is True, "kurulum: ihtilaf commit edilmemiş"
