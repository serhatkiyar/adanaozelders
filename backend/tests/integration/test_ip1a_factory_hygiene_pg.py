"""İP-1a fabrikasının kendisi güvenilir mi? (GERÇEK Postgres)

Bu dosya İP-1a'nın **kabul testi değildir**; kabul testlerinin dayandığı zemini
sınar. Gerekçesi somut: `conftest.py::_KRITIK_TABLOLAR` hijyen nöbetçisi
`bookings`, `payments` ve `tutors` tablolarını **saymaz**. Yani teardown'u eksik
bir ders-para testi satır biriktirse suite yine yeşil kalırdı. Fabrikanın
temizliği bu yüzden ayrıca ve doğrudan kanıtlanır.

İkinci iş: fabrikanın "emanet gerçekten üretim yolundan geldi" iddiasını
doğrulamak. Elle INSERT edilmiş bir `status=HELD` satırı ile `payment_service.pay`
sonucu görsel olarak aynıdır — ayırt edici olan `paid_at`, `provider_ref` ve
komisyon kırılımıdır.
"""
from __future__ import annotations

from decimal import Decimal

from models.booking import BookingStatus
from models.payment import PaymentStatus
from tests.integration.ip1a_factory import Ip1aFabrika


async def test_odenmis_ders_emaneti_URETIM_YOLUNDAN_gelir(ip1a, provider):
    """`accept` + `pay` gerçekten koştu mu — kanıt elle yazılamayacak alanlarda.

    Elle INSERT edilen bir HELD satırında `paid_at` boş, `provider_ref` uydurma
    ve komisyon sabit %10 olurdu. Burada üçü de üretim kodunun ürettiği
    değerlerdir: `paid_at` `pay()` içinde damgalanır, `provider_ref` sağlayıcının
    `charge` dönüşünden gelir, komisyon `commission.rate_for(tutor)` ile hesaplanır.
    """
    ders = await ip1a.odenmis(hourly_rate=Decimal("400"), hours=2)

    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.ACCEPTED
    assert payment_status is PaymentStatus.HELD

    p = await ip1a.payment(ders.booking_id)
    assert p is not None, "accept hook'u ödeme kaydı doğurmadı"
    assert Decimal(str(p["amount"])) == Decimal("800.00"), (
        "tutar sunucuda hesaplanmadı (saatlik ücret × süre)"
    )
    assert p["paid_at"] is not None, (
        "paid_at boş — emanet pay() yerine elle yazılmış demektir"
    )
    assert p["provider_ref"], "provider_ref boş — sağlayıcı charge'ı hiç çağrılmamış"
    assert p["released_at"] is None and p["refunded_at"] is None
    # Conservation DB CHECK'i ile de zorlanıyor; burada kırılımın gerçekten
    # hesaplandığını (0 olmadığını) görüyoruz.
    assert Decimal(str(p["commission_amount"])) > 0
    assert (
        Decimal(str(p["commission_amount"])) + Decimal(str(p["tutor_earning"]))
        == Decimal(str(p["amount"]))
    )


async def test_HELD_odeme_hakedise_YAZILMAZ(ip1a, provider):
    """Emanetteki para eğitmenin hak edişi DEĞİLDİR (payout defterinden okunur).

    Bu, sonraki testlerin "payout oluşmadı" iddiasının ölçüm aracını sabitler:
    ölçüm `payment.status` okumasının tekrarı değil, `payout_ledger`'ın kendi
    cevabıdır (`earned` yalnız RELEASED sayar).
    """
    ders = await ip1a.odenmis()
    assert await ip1a.tutor_hakedisi(ders.tutor_id) == Decimal("0.00"), (
        "emanetteki tutar hak ediş olarak defterde göründü"
    )


async def test_kabul_edilmemis_derste_odeme_kaydi_YOKTUR(ip1a, provider):
    """PENDING ders para yolunu hiç açmaz — accept hook'unun sınırı."""
    ders = await ip1a.ders()
    booking_status, payment_status = await ip1a.durumlar(ders.booking_id)
    assert booking_status is BookingStatus.PENDING
    assert payment_status is None


async def test_fabrika_temizligi_kendi_satirlarini_TAMAMEN_siler(ip1a, provider):
    """Teardown'a güvenmek yetmez; sızıntı ID bazında ölçülür.

    Ayrı bir fabrika örneği kullanılır: `ip1a` fixture'ının kendi teardown'u test
    bittikten SONRA koşacağı için onun üzerinden ölçüm yapmak imkânsızdır.
    """
    gecici = Ip1aFabrika()
    ders = await gecici.odenmis()
    await gecici.admin(izinler=["bookings.view", "bookings.manage"])
    assert await gecici.payment(ders.booking_id) is not None

    await gecici.cleanup()

    kalan = await gecici.sizinti_var_mi()
    assert kalan == {}, f"fabrika satır bıraktı: {kalan}"


async def test_zamani_kaydir_para_alanlarina_DOKUNMAZ(ip1a, provider):
    """Geçmiş ders kurulumu bir zaman kurulumudur, para sahtelemesi değildir."""
    ders = await ip1a.odenmis()
    once = await ip1a.payment(ders.booking_id)

    import datetime

    await ip1a.zamani_kaydir(ders.booking_id, delta=-datetime.timedelta(days=60))

    sonra = await ip1a.payment(ders.booking_id)
    for alan in ("status", "amount", "paid_at", "released_at", "refunded_at",
                 "provider_ref", "refund_attempts"):
        assert once[alan] == sonra[alan], f"zaman kaydırma {alan} alanını değiştirdi"
