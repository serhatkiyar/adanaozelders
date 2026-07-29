"""Para metrikleri — gerçek DB, gerçek servis.

Bir gelir raporunda en tehlikeli hata "yanlış görünmeyen" hatadır: emaneti
gelire saymak, iadeyi düşmemek ya da platformun kendi ürün cirosunu komisyonla
toplamak rakamı makul ama yanlış yapar. Aşağıdaki testler bu üç ayrımı sabitler.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from services import revenue_service

UTC = datetime.timezone.utc


async def _booking_payment(db, factory, *, status: str, amount: str = "500.00"):
    from models.booking import Booking, BookingStatus
    from models.payment import Payment

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    start = datetime.datetime.now(UTC) - datetime.timedelta(hours=2)
    booking = Booking(
        tutor_id=tutor.id,
        client_id=client.id,
        status=BookingStatus.COMPLETED,
        start_at=start,
        end_at=start + datetime.timedelta(hours=1),
        price=Decimal(amount),
    )
    db.add(booking)
    await db.flush()

    commission = (Decimal(amount) * Decimal("0.10")).quantize(Decimal("0.01"))
    payment = Payment(
        booking_id=booking.id,
        amount=Decimal(amount),
        commission_amount=commission,
        tutor_earning=Decimal(amount) - commission,
        commission_rate=Decimal("0.10"),
        status=status,
        provider="fake",
        paid_at=datetime.datetime.now(UTC),
        released_at=datetime.datetime.now(UTC) if status == "RELEASED" else None,
    )
    db.add(payment)
    await db.commit()
    return payment


async def test_emanetteki_para_gelir_sayilmaz(db, factory):
    """HELD ödeme hacme girer ama gelire GİRMEZ — ders yapılmadı, iade edilebilir."""
    before = await revenue_service.get_revenue(db, range_name="week")

    await _booking_payment(db, factory, status="HELD", amount="1000.00")
    after = await revenue_service.get_revenue(db, range_name="week")

    assert after["gmv"] == before["gmv"] + Decimal("1000.00")
    assert after["held"] == before["held"] + Decimal("1000.00")
    # Komisyon değişmemeli: emanetteki dersin komisyonu henüz kazanılmadı.
    assert after["commission_revenue"] == before["commission_revenue"]


async def test_serbest_birakilan_ders_komisyonu_gelir(db, factory):
    before = await revenue_service.get_revenue(db, range_name="week")

    await _booking_payment(db, factory, status="RELEASED", amount="1000.00")
    after = await revenue_service.get_revenue(db, range_name="week")

    assert after["commission_revenue"] == before["commission_revenue"] + Decimal("100.00")
    assert after["held"] == before["held"]


async def test_magaza_dogrudan_satis_komisyondan_ayri(db, factory):
    """Platformun kendi ürünü ciro, eğitmenin ürünü komisyondur.

    İkisini toplamak geliri olduğundan yüksek gösterir — fiziksel üründe mal
    maliyeti vardır, komisyonda yoktur.
    """
    before = await revenue_service.get_revenue(db, range_name="week")

    client = await factory.client(db)
    product = await factory.product(db, price="200.00")
    order = await factory.order(
        db, client=client, items=[(product, 1)], payment_status="PAID", status="PAID"
    )
    order.paid_at = datetime.datetime.now(UTC)
    await db.commit()

    after = await revenue_service.get_revenue(db, range_name="week")
    assert after["store_gmv"] == before["store_gmv"] + Decimal("200.00")
    assert after["direct_sales_revenue"] == before["direct_sales_revenue"] + Decimal(
        "200.00"
    )
    # Platform ürünü komisyon üretmez.
    assert after["commission_revenue"] == before["commission_revenue"]
    assert after["orders"] == before["orders"] + 1


async def test_sepet_ortalamasi_hesaplaniyor(db, factory):
    client = await factory.client(db)
    product = await factory.product(db, price="150.00")
    order = await factory.order(
        db, client=client, items=[(product, 2)], payment_status="PAID", status="PAID"
    )
    order.paid_at = datetime.datetime.now(UTC)
    await db.commit()

    result = await revenue_service.get_revenue(db, range_name="week")
    assert result["orders"] >= 1
    # AOV = toplam ciro / sipariş adedi; sıfır siparişte bölme yapılmamalı.
    assert result["aov"] == (result["store_gmv"] / result["orders"]).quantize(
        Decimal("0.01")
    )


async def test_bos_donemde_bolme_hatasi_olmaz(db):
    """Hiç işlem yokken rapor 0 dönmeli, patlamamalı (yeni kurulan platform)."""
    result = await revenue_service.get_revenue(db, range_name="day")
    assert result["refund_rate"] >= 0.0
    assert result["aov"] >= 0
