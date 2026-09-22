"""İP-1a P0-3 — Ders başlamadan tamamlama (GERÇEK PG + GERÇEK HTTP).

## Ölçülen iş kuralı

**Yapılmamış ders tamamlanamaz.** `complete` eskiden emanetteki parayı eğitmene
`RELEASED` yapan tek kapıydı; Modül 2'den (17 Eyl 2026) beri para öğrenci
onayında (`/confirm`) ya da 72 saatlik pencere dolunca serbest kalır, ama
tamamlama yine onay/pencere akışını başlatan kapıdır. `released_at`
damgalandığı anda para **geri alınamaz** hâle gelir (`escrow.begin_refund`'ın `released_at IS NULL` guard'ı,
`services/escrow.py:226-230`). Bu yüzden bu kapının zaman kontrolü bir konfor
özelliği değil, tek yönlü bir para hareketinin ön koşuludur.

## Bugünkü gerçek akış

`services/booking_service.py:446-462` (tam gövde okundu): `start_at`, `end_at` ve
`now()` **hiç okunmaz**. Router'da da kontrol yok (`api/routers/bookings.py:140-148`).
Eğitmen dersten haftalar önce `complete` çağırıp parayı kalıcı olarak alabilir.

Kıyas: `payment_service.pay` en azından `booking.status != ACCEPTED` kontrolü
yapıyor (`payment_service.py:141-145`) — yani "ön koşul kontrolü" deseni sistemde
var, `complete`'te zamanın karşılığı yok.

## Deterministik zaman

Gerçek saat beklenmez. Ders `start_at`'i **şimdiye göre offset** ile kurulur:
gelecek senaryosunda +30 gün, geçmiş senaryosunda `zamani_kaydir` ile -40 gün.
Bu bir zaman kurulumudur; para durumu her iki dalda da üretim yolundan gelir.
Sözleşmede eşik `start_at` alınmıştır (bkz. `docs/ip1a-ders-para-sozlesme.md` §10/3).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus

KOK = "/api/v1/bookings"


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_gelecekteki_ders_TAMAMLANAMAZ(ip1a, provider, ip1a_http):
    """P0-3 çekirdeği: başlamamış ders complete edilemez; para kıpırdamaz.

    Beş ölçüm birden: HTTP sonucu · booking durumu · escrow durumu ·
    `released_at` damgası · eğitmen hak edişi.
    """
    ders = await ip1a.odenmis()  # start_at = +30 gün
    p_once = await ip1a.payment(ders.booking_id)

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 409, (
        f"HENÜZ BAŞLAMAMIŞ ders tamamlanabildi ({r.status_code}). Emanetteki para "
        "öğretmene serbest bırakılır ve released_at damgası yüzünden bir daha "
        "iade edilemez (escrow.py:226-230)."
    )

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.ACCEPTED, (
        f"booking {booking_status.value} oldu — durum değişmemeliydi"
    )
    assert payment_status is PaymentStatus.HELD, (
        f"escrow {payment_status} oldu — para emanette kalmalıydı"
    )

    p_sonra = await ip1a.payment(ders.booking_id)
    assert p_sonra["released_at"] is None, (
        "released_at damgalandı — para artık geri alınamaz"
    )
    assert p_sonra["status"] == p_once["status"]


async def test_gelecekteki_ders_tamamlanmasi_HAKEDIS_URETMEZ(ip1a, provider, ip1a_http):
    """Payout defteri, yapılmamış dersten kazanç göstermemeli.

    Ayrı bir test: durum kolonundan bağımsız, defterin kendi cevabı ölçülür.
    `payout_ledger.earned` yalnız `RELEASED` sayar (`payout_ledger.py:96-107`),
    yani buradaki 0 iddiası `payment.status` okumasının tekrarı değildir.
    """
    ders = await ip1a.odenmis()

    await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)

    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00"), (
        "yapılmamış ders öğretmenin hak edişine yazıldı — elle havale ekranında "
        "ödenebilir bakiye olarak görünür"
    )


async def test_ders_baslangicindan_hemen_ONCE_de_tamamlanamaz(ip1a, provider, ip1a_http):
    """Sınır davranışı: 1 dakika kalmış ders de başlamamıştır.

    Sınır testi olmadan, düzeltme "start_at'ın gününe bak" gibi kaba bir
    kontrolle yazılabilir ve ders gününün sabahında yapılmamış ders
    tamamlanabilirdi.
    """
    yakin = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=1)
    ders = await ip1a.odenmis(start_at=yakin)

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 409, (
        f"başlangıcına 1 dakika kalan ders tamamlanabildi ({r.status_code})"
    )
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )


# ═══════════════════════ YEŞİL NÖBETÇİLER ════════════════════════════════════


async def test_YESIL_baslamis_ders_TAMAMLANIR_ogrenci_onayiyla_para_serbest_kalir(
    ip1a, provider, ip1a_http
):
    """Meşru tamamlama çalışır; para öğrenci onayında eğitmene geçer (Modül 2).

    17 Eyl 2026 kararı: eğitmenin "Tamamla"sı dersi COMPLETED yapar ama parayı
    serbest bırakmaz — öğrenci onaylar ya da 72 saatlik pencere sorunsuz dolar.
    Nöbetçi iki şeyi birlikte tutar: tamamlama kilitlenmedi, onay parayı
    gerçekten eğitmene geçiriyor.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.COMPLETED
    assert payment_status is PaymentStatus.HELD, (
        "öğretmen tamamlaması parayı öğrenci onayı beklemeden serbest bıraktı"
    )
    assert (await ip1a.payment(ders.booking_id))["released_at"] is None

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.RELEASED

    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is not None, "onaylanan derste released_at damgalanmadı"
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(p["tutor_earning"])), (
        "tamamlanan dersin kazancı payout defterine yansımadı"
    )
    assert provider.refund_calls == []


async def test_YESIL_ders_SIRASINDA_tamamlama_serbesttir(ip1a, provider, ip1a_http):
    """Başlamış ama bitmemiş ders tamamlanabilir (eşik `start_at`, `end_at` değil).

    Sözleşme kararı: eğitmenin dersin sonunda (bitiş saatini beklemeden)
    tamamlaması meşrudur. Karar değişirse (`end_at` eşiği) bu nöbetçi tek satırda
    güncellenir ve değişiklik bilinçli olur — sessizce kaymaz.
    """
    basladi = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
    ders = await ip1a.odenmis(start_at=basladi, hours=2)  # başladı, bitmedi

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    # Modül 2: tamamlama parayı serbest bırakmaz; onay/pencere bekler.
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.COMPLETED,
        PaymentStatus.HELD,
    )


async def test_YESIL_baskasinin_dersini_tamamlayamazsin(ip1a, provider, ip1a_http):
    """Sahiplik kontrolü — zaman guard'ı eklenirken düşmemeli."""
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    yabanci = await ip1a.odenmis()

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/complete", headers=yabanci.tutor_auth
    )
    assert r.status_code == 403, f"başka öğretmen dersi tamamladı ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    )


async def test_YESIL_ogrenci_dersi_tamamlayamaz(ip1a, provider, ip1a_http):
    """Rol kapısı: `complete` yalnız TUTOR'a açıktır."""
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.client_auth)
    assert r.status_code == 403, f"öğrenci dersi tamamladı ({r.status_code})"
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.HELD


async def test_YESIL_release_IKI_KEZ_cagrilsa_bile_damga_DEGISMEZ(ip1a, provider, ip1a_http):
    """`release` HELD dışından claim edemez — escrow katmanının kendi guard'ı.

    ## Bu test neden SONRADAN eklendi (dürüst kayıt)

    Mutasyon provasında A3 (`payment_service.release`'in `from_statuses=[HELD]`
    kısıtını `[HELD, RELEASED]` yapmak) hiçbir testi kırmadı. Sebep:
    `test_YESIL_auto_complete_ayni_dersi_IKI_KEZ_islemez` bileşik davranışı
    ölçüyordu — ilk turda booking `COMPLETED` olduğu için ikinci tur onu zaten
    seçmiyor ve `release` bir daha hiç çağrılmıyordu. Yani **booking katmanının
    claim'i, ödeme katmanının claim'ini gölgeliyor** ve o guard korumasız kalıyordu.

    Bu test `release`'i doğrudan iki kez çağırarak gölgeyi kaldırır. Aynı desen
    üretimde gerçekten oluşabilir: elle `complete` ile arka plan auto-complete'i
    aynı derse denk gelebilir (`booking_service.py:460` ve `:597`).
    """
    from services import payment_service

    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    # Modül 2: ilk release öğrenci onayıyla üretilir (tamamlama parayı HELD bırakır).
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text
    ilk = await ip1a.payment(ders.booking_id)
    assert ilk["released_at"] is not None, "kurulum: ilk release gerçekleşmedi"

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await payment_service.release(s, booking)
        await s.commit()

    ikinci = await ip1a.payment(ders.booking_id)
    assert ikinci["released_at"] == ilk["released_at"], (
        "ikinci release damgayı yeniden yazdı — HELD kısıtı kalkmış, aynı para "
        "iki kez serbest bırakılabilir"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal(str(ilk["tutor_earning"]))


async def test_YESIL_odenmemis_ders_tamamlansa_bile_para_ACILMAZ(ip1a, provider, ip1a_http):
    """Emanet yoksa `release` no-op olmalı — ders tamamlanır, para uydurulmaz."""
    ders = await ip1a.kabul_edilmis()  # ödeme PENDING (öğrenci ödemedi)
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/complete", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text
    # Modül 2: release öğrenci onayında çağrılır; emanet yoksa yine no-op olmalı.
    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/confirm", headers=ders.client_auth)
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.COMPLETED
    assert payment_status is PaymentStatus.PENDING, (
        f"ödenmemiş ödeme {payment_status} oldu — tahsil edilmemiş para serbest bırakıldı"
    )
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
