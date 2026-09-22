"""İP-1a P0-5 — Terminal booking + sahipsiz HELD, reconciler görünürlüğü.

## Ölçülen iş kuralı (sözleşme §8)

**Terminal bir derse bağlı emanet para SESSİZ kalamaz.** P0-1 ve P0-2 bu durumu
*üretir*; P0-5 onun *fark edilmemesidir*. İkisi ayrı ayrı kapatılmalıdır: kaynak
yollar düzeltilse bile geçmişte oluşmuş satırlar ve henüz bilinmeyen yollar için
bir güvenlik ağı gerekir. Bu yüzden buradaki kurulum, emaneti üreten yollardan
**bilinçli olarak bağımsızdır** (bkz. `Ip1aFabrika.terminal_yap` docstring'i).

## Bugünkü gerçek akış

`reconcile_refunding` yalnız `status == REFUNDING` tarar
(`services/escrow_reconciler.py:76-82`); `reconcile_stale_checkouts` yalnız
`PENDING/FAILED` + `provider_ref` dolu satırları tarar (`:168-178`). Reconciler'ın
hiçbir sorgusunda `PaymentStatus.HELD` geçmez — sahipsiz emanet hiçbir taramaya
girmez ve hiçbir alarm üretmez.

## Önerilen karar: güvenli claim sonrası OTOMATİK İADE (+ ERROR logu)

Gerekçe (sözleşme §8'de tam): sistemin kendi precedent'i budur —
`payment_service.complete_checkout` aynı durumda (para tahsil edilmiş, varlık
ölü) otomatik iade başlatır ve ERROR loglar (`payment_service.py:273-310`).
Ayrıca **iade tek geri döndürülebilir yöndür**: yanlış iade telafi edilebilir
(öğrenci yeniden öder), yanlış release `released_at` guard'ı yüzünden edilemez.

Testler bu kararı sözleşme olarak ölçer. Ürün kararı değişirse (ör. yalnız
MANUAL_REVIEW alarmı) tek dokunulacak yer modül düzeyindeki **`COZULMUS`**
sabitidir: "sahipsiz emanet çözüldü" sayılan `PaymentStatus` kümesi orada
tanımlıdır ve bu dosyadaki her sonuç iddiası ona bakar. (Daha önce bu satırda
`_sahipsiz_cozuldu_mu` adlı bir yardımcıdan söz ediliyordu; öyle bir yardımcı
hiç yazılmadı — bağımsız denetim düzeltmesi.)
"""
from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.payment import PaymentStatus
from services import escrow_reconciler

#: `REFUND_RECONCILE_MIN_AGE_MINUTES` = 15 → fazlasıyla aşılsın.
KARANTINA_ASILDI = datetime.timedelta(hours=3)

COZULMUS = (PaymentStatus.REFUNDING, PaymentStatus.REFUNDED)


async def _mutabakat_turu() -> None:
    """Üretimdeki escrow mutabakat işini birebir koşturur (`main.py:96-99`).

    Sözleşme §8'in gerektirdiği sahipsiz-emanet taraması henüz YOKTUR. Yazıldığında
    `escrow_reconciler` modülüne eklenecek ve burada otomatik olarak devreye
    girecektir — testlerin o an yeşile dönmesi, sözleşmenin karşılandığının
    kanıtıdır. `getattr` bilinçlidir: testin bugün var olmayan bir isme import
    zamanında bağlanması, dosyayı collection error'a düşürür ve KIRMIZI ile
    "hiç koşmadı" ayırt edilemez hâle gelirdi.
    """
    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)
        await escrow_reconciler.reconcile_stale_checkouts(s)
        tarayici = getattr(escrow_reconciler, "reconcile_orphaned_escrow", None)
        if tarayici is not None:
            await tarayici(s)


async def _sahipsiz_emanet(ip1a, *, status=BookingStatus.REJECTED, yasli=True):
    """Terminal ders + üretim yolundan gelmiş HELD emanet."""
    ders = await ip1a.odenmis()
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.HELD
    await ip1a.terminal_yap(ders.booking_id, status)
    if yasli:
        await ip1a.eskit(ders.booking_id, delta=KARANTINA_ASILDI)
    return ders


# ═══════════════════════ KIRMIZI: sözleşme henüz yazılmadı ═══════════════════


async def test_sahipsiz_emanet_MUTABAKATTA_GORUNUR(ip1a, provider, ip1a_http):
    """P0-5 çekirdeği (S1): terminal derse bağlı HELD para sessiz kalamaz."""
    ders = await _sahipsiz_emanet(ip1a)

    await _mutabakat_turu()

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.REJECTED
    assert payment_status is not PaymentStatus.HELD, (
        "SAHİPSİZ EMANET MUTABAKATTA GÖRÜNMEDİ: ders terminal, para HELD ve "
        "reconciler onu hiç taramıyor (escrow_reconciler.py:76-82 REFUNDING, "
        ":168-178 PENDING/FAILED). Para süresiz kilitli ve kimse fark etmiyor."
    )
    assert payment_status in COZULMUS


async def test_sahipsiz_emanet_SAGLAYICIYA_TAM_BIR_IADE_uretir(ip1a, provider, ip1a_http):
    """Yerel durum yazımı yetmez; paranın dış dünyada da geri dönmesi gerekir."""
    ders = await _sahipsiz_emanet(ip1a, status=BookingStatus.CANCELLED)

    await _mutabakat_turu()

    assert len(provider.refund_calls) == 1, (
        f"sağlayıcıya {len(provider.refund_calls)} iade emri gitti (beklenen 1)"
    )
    assert provider.refund_calls[0][1] == ders.amount
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00")


async def test_ayni_mutabakat_turu_ayni_kaydi_IKI_KEZ_islemez(ip1a, provider, ip1a_http):
    """S3: ardışık turlar ikinci bir para hareketi üretmemeli.

    Birinci turun GERÇEKTEN bir iade ürettiği önce sabitlenir; aksi halde
    bugünkü kod da (hiç iade yapmadığı için) bu testi geçerdi.
    """
    ders = await _sahipsiz_emanet(ip1a)

    await _mutabakat_turu()
    assert len(provider.refund_calls) == 1, (
        f"ilk tur {len(provider.refund_calls)} iade üretti (beklenen 1) — "
        "idempotency iddiası ölçülemez"
    )

    await _mutabakat_turu()
    await _mutabakat_turu()

    assert len(provider.refund_calls) == 1, (
        f"ÇİFT İŞLEM: üç tur sonunda {len(provider.refund_calls)} iade emri"
    )
    assert (await ip1a.durumlar(ders.booking_id))[1] in COZULMUS


async def test_iki_esZamanli_worker_TEK_CLAIM_kazanir(ip1a, provider, ip1a_http):
    """S4: eşzamanlı iki mutabakat worker'ından yalnız biri para hareketi yapar.

    Üretimde advisory lock (`main.py:_LOCK_ESCROW`) tek koşucuya indirir, ama
    kilit bir dağıtım detayıdır: dağıtım sırasında iki sürüm birlikte koşabilir
    ya da kilit anahtarı değişebilir. Doğruluk **claim'e** yaslanmalıdır, kilide
    değil — bu yüzden test kilidi bilinçli olarak devreye sokmaz.
    """
    ders = await _sahipsiz_emanet(ip1a)

    await asyncio.gather(_mutabakat_turu(), _mutabakat_turu())

    assert len(provider.refund_calls) == 1, (
        f"iki worker {len(provider.refund_calls)} iade emri üretti — claim yarışı "
        "kaybedilmiş (tek kazanan olmalıydı)"
    )
    assert (await ip1a.durumlar(ders.booking_id))[1] in COZULMUS


async def test_saglayici_basarisizsa_para_durumu_YALAN_KESINLESMEZ(ip1a, provider, ip1a_http):
    """S5: iade reddedilirse kayıt REFUNDING'de kalır — ne REFUNDED ne HELD.

    `REFUNDED` damgalamak "para iade edildi" yalanı; `HELD`'e geri dönmek ise
    iade niyetini silmek olurdu (`escrow.py:259-261`: HİÇBİR yerde HELD'e dönüş
    yoktur). Doğru davranış: niyet kalıcı, sonraki tur devralır.

    Bugünkü gerçek kırmızılık sebebi "HELD'e geri döndürüldü" DEĞİLDİR: sahipsiz
    emanet taraması henüz yazılmadığı için tarayıcı kayda **hiç dokunmaz** ve
    kayıt HELD'de kalır. Assert mesajları bu yüzden her iki güvensiz hâli birden
    adlandırır (bağımsız denetim düzeltmesi).
    """
    ders = await _sahipsiz_emanet(ip1a)
    provider.refund_result = False

    await _mutabakat_turu()

    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status is not PaymentStatus.REFUNDED, (
        "sağlayıcı reddetmesine rağmen ödeme REFUNDED damgalandı — defter yalan söylüyor"
    )
    assert payment_status is not PaymentStatus.HELD, (
        f"başarısız iade denemesinden sonra ödeme HELD göründü ({payment_status}). "
        "İki ayrı güvensiz hâlin ikisini birden dışlar: (a) tarayıcı kaydı "
        "HELD'e GERİ DÖNDÜRDÜ — iade niyeti silindi, sonraki tur bu satırı bir "
        "daha hiç görmez; (b) tarayıcı kayda HİÇ DOKUNMADI — sahipsiz emanet "
        "bugün olduğu gibi sessiz kaldı. İkisi de aynı sonucu verir: para "
        "kilitli, kimse haberdar değil."
    )
    assert payment_status is PaymentStatus.REFUNDING
    assert (await ip1a.payment(ders.booking_id))["refund_requested_at"] is not None


# ═══════════════════════ YEŞİL NÖBETÇİLER ════════════════════════════════════


async def test_YESIL_TAZE_sahipsiz_emanete_karantina_uygulanir(ip1a, provider, ip1a_http):
    """S2: uçuşta olan bir transaction mutabakat tarafından yakalanmamalı.

    Kritik: karantinası olmayan bir tarayıcı, `booking_service.cancel`'ın
    `_claim_transition` ile `payment_service.refund` arasındaki penceresine denk
    gelip aynı ödemeye ikinci bir iade emri gönderebilirdi.
    """
    ders = await _sahipsiz_emanet(ip1a, yasli=False)

    await _mutabakat_turu()

    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status is PaymentStatus.HELD, (
        f"yeni oluşmuş sahipsiz emanete karantina beklemeden dokunuldu "
        f"({payment_status}) — uçuşta olan bir iptalle yarışır"
    )
    assert provider.refund_calls == []


async def test_YESIL_SERBEST_BIRAKILMIS_emanet_asla_iade_edilmez(ip1a, provider, ip1a_http):
    """S6: `released_at` dolu satır hiçbir koşulda iadeye claim edilemez.

    Bu, `escrow.py:226-230` guard'ının nöbetçisidir. P0-5 düzeltmesi yeni bir
    tarayıcı ekleyecek; guard'ı atlayan bir tarayıcı, eğitmene ödenmiş parayı
    öğrenciye de iade ederek **çifte ödeme** üretirdi.
    """
    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/complete", headers=ders.tutor_auth
    )
    assert r.status_code == 200, r.text
    # Modül 2: tamamlama parayı serbest bırakmaz; release öğrenci onayıyla gelir.
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/confirm", headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    # Tamamlanmış dersi terminal bir duruma zorla: "COMPLETED + RELEASED" değil,
    # veri bozulmasıyla oluşabilecek "CANCELLED + RELEASED" hâli sınanır.
    await ip1a.terminal_yap(ders.booking_id, BookingStatus.CANCELLED)
    await ip1a.eskit(ders.booking_id, delta=KARANTINA_ASILDI)

    await _mutabakat_turu()

    _bs, payment_status = await ip1a.durumlar(ders.booking_id)
    assert payment_status is PaymentStatus.RELEASED, (
        f"serbest bırakılmış emanet {payment_status} oldu — çifte para hareketi"
    )
    assert provider.refund_calls == [], (
        "released_at dolu kayda iade emri gönderildi (öğretmen kazancı + öğrenci iadesi)"
    )


async def test_YESIL_RELEASED_odemeye_DOGRUDAN_iade_denemesi_reddedilir(
    ip1a, provider, ip1a_http
):
    """`begin_refund`'ın `released_at IS NULL` guard'ı doğrudan sınanır.

    ## Bu test neden SONRADAN eklendi (dürüst kayıt)

    Mutasyon provasında A4 (`escrow.begin_refund`'daki `released_at` guard'ını
    silmek) hiçbir testi kırmadı. Sebep utandırıcı ama öğreticiydi:
    `test_YESIL_SERBEST_BIRAKILMIS_emanet_asla_iade_edilmez` **boş yere yeşildi**
    — bugünkü reconciler HELD/RELEASED satırlara zaten hiç dokunmuyor, yani test
    guard'ı değil, taramanın yokluğunu ölçüyordu (kök CLAUDE.md §E: "Eski bozuk
    kod da testi geçiyorsa o test düzeltmenin kanıtı değildir").

    O test yine de değerlidir: P0-5 düzeltmesi yazıldığında yeni tarayıcının
    guard'ı atlamadığını ölçecektir. Ama guard'ın BUGÜN çalıştığını kanıtlamak
    için iade yolunu doğrudan çağıran bu test gerekir.
    """
    from services import payment_service

    ders = await ip1a.odenmis()
    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=40))
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/complete", headers=ders.tutor_auth
    )
    assert r.status_code == 200, r.text
    # Modül 2: tamamlama parayı serbest bırakmaz; release öğrenci onayıyla gelir.
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/confirm", headers=ders.client_auth
    )
    assert r.status_code == 200, r.text
    ilk = await ip1a.payment(ders.booking_id)
    assert ilk["released_at"] is not None, "kurulum: release gerçekleşmedi"

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await payment_service.refund(s, booking)
        await s.commit()

    sonra = await ip1a.payment(ders.booking_id)
    assert sonra["status"] == PaymentStatus.RELEASED.value, (
        f"serbest bırakılmış ödeme {sonra['status']} oldu — durum kısıtı atlandı"
    )
    assert sonra["refunded_at"] is None and sonra["refund_requested_at"] is None
    assert provider.refund_calls == [], (
        "serbest bırakılmış kayda sağlayıcı iade emri gönderildi — ÇİFTE ÖDEME"
    )


async def test_YESIL_released_at_dolu_HELD_satiri_IADEYE_CLAIM_EDILEMEZ(
    ip1a, provider, ip1a_http
):
    """`escrow.begin_refund`'ın `released_at IS NULL` guard'ı — savunmanın İKİNCİ hattı.

    ## Neden bozuk bir satır elle kuruluyor

    Bu, bir para durumu sahtelemesi değil, bilinçli bir **veri bozulması
    senaryosudur**. Normal akışta `release` `status`'ü ve `released_at`'i birlikte
    yazar, dolayısıyla "HELD + released_at dolu" kombinasyonu üretim kodundan
    doğmaz. Guard tam da bu yüzden vardır: kısmi bir yazım, elle müdahale ya da
    ileride eklenecek yanlış bir tarayıcı bu satırı üretirse, para **ikinci kez**
    hareket etmemelidir.

    ## Bu test neden SONRADAN eklendi (dürüst kayıt)

    Mutasyon provası A4 (guard'ı silmek) hiçbir testi kırmadı — ne İP-1a'nın
    ne de mevcut paketin. Sebep: her çağıran kendi sorgusunda zaten `released_at`
    filtresi taşıyor (ör. `library_exam_service.py:273`) ve ödeme yüzeyinde
    `RELEASED` ayrı bir durum olduğu için `from_statuses=[HELD]` kısıtı guard'ı
    gölgeliyor. Yani **paylaşılan escrow çekirdeğindeki bir guard davranışsal
    olarak hiç sınanmamıştı**; silinse kimse fark etmezdi. Bu test o boşluğu
    ders yüzeyinde kapatır.
    """
    from sqlalchemy import text as _text

    from services import payment_service

    ders = await ip1a.odenmis()
    async with AsyncSessionLocal() as s:
        await s.execute(
            _text(
                "UPDATE payments SET released_at = now() WHERE booking_id = :i"
            ),
            {"i": ders.booking_id},
        )
        await s.commit()
    bozuk = await ip1a.payment(ders.booking_id)
    assert bozuk["status"] == PaymentStatus.HELD.value
    assert bozuk["released_at"] is not None, "kurulum: bozuk satır oluşmadı"

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, ders.booking_id)
        await payment_service.refund(s, booking)
        await s.commit()

    sonra = await ip1a.payment(ders.booking_id)
    assert sonra["status"] == PaymentStatus.HELD.value, (
        f"kazancı zaten dağıtılmış satır {sonra['status']} durumuna claim edildi — "
        "released_at guard'ı (escrow.py:226-230) atlandı"
    )
    assert sonra["refund_requested_at"] is None
    assert provider.refund_calls == [], (
        "released_at dolu kayda iade emri gönderildi: öğretmen kazancı + öğrenci "
        "iadesi = ÇİFTE ÖDEME"
    )


async def test_YESIL_ACCEPTED_dersin_emaneti_mutabakatta_ELLENMEZ(ip1a, provider, ip1a_http):
    """Sağlıklı emanet dokunulmadan kalmalı — tarayıcının kapsamı dar olmalı.

    Çok geniş yazılmış bir tarayıcı (ör. "eski HELD'leri iade et") canlı
    derslerin parasını süpürürdü. Bu nöbetçi o felaketi yakalar.
    """
    ders = await ip1a.odenmis()
    await ip1a.eskit(ders.booking_id, delta=KARANTINA_ASILDI)

    await _mutabakat_turu()

    assert (await ip1a.durumlar(ders.booking_id)) == (
        BookingStatus.ACCEPTED,
        PaymentStatus.HELD,
    ), "canlı (ACCEPTED) dersin emaneti mutabakat tarafından hareket ettirildi"
    assert provider.refund_calls == []


async def test_YESIL_sarkan_REFUNDING_kaydi_mutabakat_DEVRALIR(ip1a, provider, ip1a_http):
    """Mevcut mutabakat yolu hâlâ çalışıyor — ölçüm aracının kanıtı.

    Kırmızı testler "reconciler görmüyor" diyor; bu nöbetçi reconciler'ın
    GERÇEKTEN çalıştığını ve testin onu tetikleyebildiğini gösterir. Aksi halde
    kırmızılık, mutabakatı hiç çağıramamaktan da kaynaklanıyor olabilirdi.
    """
    ders = await ip1a.odenmis()
    provider.refund_result = False
    r = await ip1a_http.post(
        f"/api/v1/bookings/{ders.booking_id}/cancel",
        json={"reason": "İP-1a nöbetçi"},
        headers=ders.client_auth,
    )
    assert r.status_code == 200, r.text
    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.REFUNDING, (
        "kurulum: sağlayıcı reddine rağmen kayıt REFUNDING'de kalmadı"
    )
    await ip1a.eskit(ders.booking_id, delta=KARANTINA_ASILDI)

    provider.refund_result = True
    await _mutabakat_turu()

    assert (await ip1a.durumlar(ders.booking_id))[1] is PaymentStatus.REFUNDED, (
        "sarkan REFUNDING kaydı mutabakat tarafından sonuca sürülmedi"
    )
    assert len(provider.refund_calls) == 2, (
        f"beklenen: 1 başarısız + 1 başarılı deneme; gerçekleşen "
        f"{len(provider.refund_calls)}"
    )
