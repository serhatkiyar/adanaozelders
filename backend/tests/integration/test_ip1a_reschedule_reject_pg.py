"""İP-1a P0-1 — Reschedule → reject emanet kilidi (GERÇEK PG + GERÇEK HTTP).

## Ölçülen iş kuralı

**Emanetteki para, dersi terminal duruma götüren hiçbir geçişte sahipsiz
kalamaz.** Bu bir hata raporu değil, bir para güvenliği invariant'ıdır: `HELD`
yalnız `ACCEPTED` bir dersle birlikte durabilir (bkz.
`docs/ip1a-ders-para-sozlesme.md` §3 durum matrisi).

## Bugünkü gerçek akış (güncel main'de yeniden doğrulandı)

1. `reschedule` süre değişmediyse fiyatı da değiştirmez → `sync_amount_with_booking`
   erken döner (`services/payment_service.py:95-96`), **HELD ödeme olduğu gibi kalır**.
2. `reschedule` booking'i koşulsuz `PENDING`'e alır (`services/booking_service.py:492`).
3. `PENDING → REJECTED` meşrudur ve `reject` **hiçbir para çağrısı yapmaz**
   (`services/booking_service.py:432-443` — tam gövde okundu).

Sonuç: `REJECTED` + `HELD`. Üç arka plan tarayıcısının hiçbiri bu satırı görmez
(`booking_service.py:575`, `escrow_reconciler.py:77`, `:171`).

## Neden gerçek HTTP

Reschedule ve reject **iki farklı rolün** uçlarıdır (CLIENT / TUTOR) ve bu
senaryonun tuzağı tam olarak rol devri sırasında doğuyor. Servisi doğrudan
çağıran bir test, sahiplik çözümünü ve gerçek transaction sınırını atlar. Ayrıca
`/bookings/{id}/reject` ödeme kolu kapısına tabi DEĞİLDİR (yalnız `accept` tabidir),
bu yüzden bayrak kurcalamadan gerçek istekle sürülebilir.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from models.booking import BookingStatus
from models.payment import PaymentStatus

KOK = "/api/v1/bookings"

#: Terminal booking durumları — para artık bir derse bağlı olamaz.
TERMINAL = (BookingStatus.REJECTED, BookingStatus.CANCELLED)

#: Emanetten çıkışın başladığını gösteren durumlar. `REFUNDING` de kabul edilir:
#: iade niyeti kalıcıdır ve reconciler devralır (`services/escrow.py` iki fazlı
#: iade sözleşmesi). `HELD` kabul edilmez — çıkış hiç başlamamış demektir.
IADE_YOLUNDA = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)


def _iso(dt: datetime.datetime) -> str:
    return dt.isoformat()


async def _yeni_saate_tasi(ip1a_http, ders, *, gun: int = 40, saat: int = 1):
    """Süreyi DEĞİŞTİRMEDEN saati taşır — fiyat aynı kalır, 409 tetiklenmez."""
    start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=gun)
    return await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/reschedule",
        json={"start_at": _iso(start), "end_at": _iso(start + datetime.timedelta(hours=saat))},
        headers=ders.client_auth,
    )


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_reschedule_sonrasi_reject_EMANETI_SAHIPSIZ_BIRAKMAZ(ip1a, provider, ip1a_http):
    """P0-1 çekirdeği: terminal booking + HELD ödeme birlikte var olamaz.

    Ölçüm dört ayakta birden: booking durumu · escrow durumu · sağlayıcı çağrı
    sayısı · eğitmen hak edişi. Tek başına HTTP durum kodu kanıt sayılmaz.
    """
    ders = await ip1a.odenmis()
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.HELD, (
        "kurulum bozuk: emanet hiç oluşmamış"
    )

    r = await _yeni_saate_tasi(ip1a_http, ders)
    assert r.status_code == 200, r.text

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.REJECTED, "kurulum bozuk: red gerçekleşmedi"

    assert not (booking_status in TERMINAL and payment_status is PaymentStatus.HELD), (
        f"EMANET SAHİPSİZ KALDI: booking={booking_status.value} ama ödeme HELD. "
        "Para ne öğrenciye döndü ne eğitmene geçti; hiçbir arka plan tarayıcısı "
        "bu satırı görmüyor (auto_complete ACCEPTED tarar, reconciler REFUNDING tarar)."
    )
    assert payment_status in IADE_YOLUNDA, (
        f"terminal derste ödeme {payment_status} — iade akışı hiç başlamadı"
    )


async def test_reschedule_sonrasi_reject_SAGLAYICIYA_TAM_BIR_IADE_gonderir(
    ip1a, provider, ip1a_http
):
    """İade akışı gerçekten sağlayıcıya gitmeli — ve tam olarak bir kez.

    Yerel durum yazımı tek başına para hareketi değildir; `provider.refund`
    çağrısı işin dış dünyadaki karşılığıdır.
    """
    ders = await ip1a.odenmis()
    await _yeni_saate_tasi(ip1a_http, ders)

    r = await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)
    assert r.status_code == 200, r.text

    assert len(provider.refund_calls) == 1, (
        f"sağlayıcıya {len(provider.refund_calls)} iade emri gitti (beklenen: 1). "
        "0 ise para hiç iade edilmedi; 2+ ise çift iade."
    )
    _ref, tutar = provider.refund_calls[0]
    assert tutar == ders.amount, (
        f"iade tutarı {tutar}, dersin ücreti {ders.amount} — kısmi/yanlış iade"
    )


async def test_YESIL_reschedule_sonrasi_reject_EGITMENE_HAKEDIS_YAZMAZ(
    ip1a, provider, ip1a_http
):
    """Yapılmamış ders eğitmene kazanç doğuramaz — defterden ölçülür.

    Bu iddia BUGÜN de doğrudur (para HELD'de kilitli kaldığı için eğitmene
    geçmiyor) — yani bir yeşil nöbetçidir, kırmızı değil. Görevi düzeltmenin
    YÖNÜNÜ kilitlemektir: P0-1, "reddedilen dersin parasını eğitmene bırak"
    biçiminde de "çözülebilir" ve o çözüm bütün kırmızıları yeşile çevirirdi.
    Bu nöbetçi o yanlış yönü reddeder.

    `payout_ledger` yalnız `RELEASED` ödemeleri hak ediş sayar; bu yüzden iddia
    `payment.status` okumasının tekrarı değil, ödeme defterinin bağımsız cevabıdır.
    """
    ders = await ip1a.odenmis()
    await _yeni_saate_tasi(ip1a_http, ders)
    await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)

    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00"), (
        "reddedilen ders için eğitmene hak ediş yazıldı"
    )
    p = await ip1a.payment(ders.booking_id)
    assert p["released_at"] is None, (
        "reddedilen derste released_at damgalandı — para geri alınamaz hâle geldi"
    )


async def test_reject_TEKRARI_CIFT_IADE_uretmez(ip1a, provider, ip1a_http):
    """Aynı isteğin tekrarı ikinci bir para hareketi doğuramaz (idempotency).

    DİKKAT — bu test bilinçli olarak "ikinci çağrı fazladan iade yapmasın"
    demekle YETİNMEZ. Öyle yazılsaydı bugünkü kod da geçerdi: hiç iade
    yapılmadığı için ikinci çağrı da yapmaz ve test **boş yere yeşil** olurdu
    (kök CLAUDE.md §E: "Eski bozuk kod da testi geçiyorsa o test düzeltmenin
    kanıtı değildir"). Bu yüzden önce **birinci çağrının tam 1 iade ürettiği**
    sabitlenir; ikinci çağrının sayacı artırmaması ancak ondan sonra anlam taşır.
    """
    ders = await ip1a.odenmis()
    await _yeni_saate_tasi(ip1a_http, ders)

    ilk = await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)
    assert ilk.status_code == 200, ilk.text
    assert len(provider.refund_calls) == 1, (
        f"ilk red {len(provider.refund_calls)} iade üretti (beklenen 1) — "
        "idempotency iddiası ölçülemez hâle geldi"
    )

    ikinci = await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)
    assert ikinci.status_code == 409, (
        f"terminal derse ikinci red {ikinci.status_code} döndü; sessiz başarı "
        "kullanıcıya işlem tekrarladığını gizler"
    )
    assert len(provider.refund_calls) == 1, (
        f"ÇİFT İADE: tekrar sonrası sağlayıcıya {len(provider.refund_calls)} emir gitti"
    )


async def test_reschedule_sonrasi_reject_OGRENCIYI_BILGILENDIRIR(ip1a, provider, ip1a_http):
    """Para iade edilecekse öğrenci bunu öğrenmeli.

    Taraf iptalinde bu bildirim var (`payment_service.py:375-385`); red yolunda
    para hareketi hiç doğmadığı için bildirim de doğmuyor.

    ## Neden SAYIYA değil ANLAMA bağlanır

    Bu test bir kez `once + 2` dayatıyordu — yani "red bildirimi" ve "iade
    bildirimi" mutlaka AYRI iki satır olsun. Bu, ölçmek istediğimiz şeyden
    fazlasıdır: **tek** bir "dersin reddedildi ve ödemen iade edildi" bildirimi
    de öğrenciyi tam olarak bilgilendirir ve üretimde meşru bir tasarımdır.
    Sayıyı dayatan test, doğru bir uygulamayı kırmızıya düşürerek İP-1b'yi
    gereksiz bir tasarım kararına zorlardı (bağımsız denetim düzeltmesi).

    Ölçülen invariant üç parçadır: (1) bildirim DOĞRU kullanıcıya (öğrenciye)
    gitti, (2) içeriği para/iade anlamı taşıyor, (3) en az bir tane var. Kaç
    satıra bölündüğü uygulamanın kararıdır ve testin işi değildir.
    """
    ders = await ip1a.odenmis()
    await _yeni_saate_tasi(ip1a_http, ders)
    onceki = await ip1a.bildirimler(user_id=ders.client_id, role_id=3)
    son_id = onceki[-1][0] if onceki else 0

    await ip1a_http.post(f"{KOK}/{ders.booking_id}/reject", headers=ders.tutor_auth)

    yeni = [
        m
        for (i, m) in await ip1a.bildirimler(user_id=ders.client_id, role_id=3)
        if i > son_id
    ]
    assert yeni, (
        "öğrenciye hiçbir bildirim gitmedi: dersi reddedildi ve emanetteki "
        "parası hakkında hiçbir şey söylenmedi"
    )
    para_sozcukleri = ("iade", "ödeme", "ödemen", "ücret", "para")
    assert any(any(k in m.casefold() for k in para_sozcukleri) for m in yeni), (
        f"öğrenciye giden bildirimlerin hiçbiri para hareketinden söz etmiyor: {yeni}. "
        "Tek birleşik mesaj da olur, ayrı iade mesajı da — ama para sessiz kalamaz."
    )


# ═══════════════════════ YEŞİL NÖBETÇİLER: doğru davranış ════════════════════


async def test_YESIL_ayni_ucretli_reschedule_emaneti_BOZMAZ(ip1a, provider, ip1a_http):
    """Süre değişmeyen taşımada emanet olduğu gibi kalmalı — ne silinir ne değişir.

    Bu nöbetçi bilinçlidir: P0-1'in düzeltmesi "reschedule HELD'i iptal etsin"
    biçiminde yazılırsa öğrencinin parası **sebepsiz** iade edilir ve ders yeniden
    ödenmek zorunda kalır. Kırmızı testler bu yanlış çözümü ayırt edemez, bu ayırt eder.
    """
    ders = await ip1a.odenmis()
    once = await ip1a.payment(ders.booking_id)

    r = await _yeni_saate_tasi(ip1a_http, ders)
    assert r.status_code == 200, r.text

    sonra = await ip1a.payment(ders.booking_id)
    assert sonra["status"] == PaymentStatus.HELD.value, (
        f"saat taşınınca emanet {sonra['status']} oldu — para sebepsiz hareket etti"
    )
    assert Decimal(str(sonra["amount"])) == Decimal(str(once["amount"]))
    assert sonra["paid_at"] == once["paid_at"]
    assert provider.refund_calls == [], "saat taşımak iade emri üretti"

    booking_status, _ = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.PENDING, (
        "taşınan ders eğitmenin yeniden onayına sunulmalı"
    )


async def test_YESIL_odenmis_dersin_UCRETI_DEGISTIRILEMEZ(ip1a, provider, ip1a_http):
    """Süre değişirse (fiyat değişirse) HELD ödemede 409 — ve DB'ye hiçbir şey yazılmaz.

    `payment_service.py:111-116` bu kuralı zorlar. Nöbetçi hem 409'u hem de
    rollback'in gerçekten çalıştığını ölçer: 409 dönüp saati yine de kaydeden bir
    uygulama, ödeme ile ders ücretini sessizce ayrıştırırdı.
    """
    ders = await ip1a.odenmis(hours=1)
    p_once = await ip1a.payment(ders.booking_id)
    async_once = (await ip1a.durumlar(ders.booking_id))[0]

    r = await _yeni_saate_tasi(ip1a_http, ders, saat=3)  # 1 saat → 3 saat: fiyat değişir
    assert r.status_code == 409, (
        f"ödemesi alınmış dersin ücreti değiştirilebildi ({r.status_code})"
    )

    p_sonra = await ip1a.payment(ders.booking_id)
    assert Decimal(str(p_sonra["amount"])) == Decimal(str(p_once["amount"])), (
        "409'a rağmen ödeme tutarı değişti"
    )
    assert p_sonra["status"] == PaymentStatus.HELD.value
    assert (await ip1a.durumlar(ders.booking_id))[0] is async_once, (
        "409'a rağmen booking durumu değişti (rollback çalışmadı)"
    )
    assert provider.refund_calls == []


async def test_YESIL_taraf_iptali_emaneti_GERCEKTEN_iade_eder(ip1a, provider, ip1a_http):
    """Doğru yol hâlâ çalışıyor mu — ölçüm aracının kendisinin kanıtı.

    Kırmızı testler "iade olmadı" diyor; bu nöbetçi aynı araçlarla "iade oldu"yu
    gösterebildiğimizi kanıtlar. Aksi halde kırmızılık, iade akışını hiç
    ölçemediğimizden de kaynaklanıyor olabilirdi.
    """
    ders = await ip1a.odenmis()

    r = await ip1a_http.post(
        f"{KOK}/{ders.booking_id}/cancel",
        json={"reason": "İP-1a nöbetçi"},
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.CANCELLED
    assert payment_status in IADE_YOLUNDA, (
        f"taraf iptalinde ödeme {payment_status} — iade akışı bozulmuş"
    )
    assert len(provider.refund_calls) == 1
    assert provider.refund_calls[0][1] == ders.amount
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")
