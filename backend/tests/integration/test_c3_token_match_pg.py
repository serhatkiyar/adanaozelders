"""C3 repro — callback'te token/provider_ref eşleşmesi + paidPrice doğrulaması yok.

Bugünkü kod, retrieve edilen token'ın varlıkta saklı CF token'ıyla eşleştiğini ve
sağlayıcının tahsil ettiği tutarın (paidPrice) varlık tutarına eşit olduğunu HİÇ
kontrol etmiyor. Sonuç: aynı booking için iki CF oturumu açılıp ikisi de ödenirse
ikinci tahsilat kayıtsız/iadesiz kalıyor (çift tahsilat).

Beklenen davranış:
- token != saklı provider_ref + başarılı tahsilat → varlık durumuna DOKUNULMAZ,
  beklenmeyen tahsilat sağlayıcıya aynen iade edilir (aşırı-iade reddi replay
  emniyet kemeri).
- paidPrice != amount → tamamlanmaz, tahsilat iade edilir.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.booking import BookingStatus
from models.payment import Payment, PaymentStatus
from services import payment_service


async def _payment(booking_id: int) -> Payment:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Payment).where(Payment.booking_id == booking_id))
        ).scalar_one()


async def test_c3_token_mismatch_refunds_unexpected_charge(factory, provider):
    """İkinci/bayat CF oturumunun başarılı tahsilatı: durum değişmez, para iade."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.PENDING,
        provider_ref="cf-token-B",  # aktif (son) CF oturumu
        amount=Decimal("500.00"),
    )
    async with AsyncSessionLocal() as s:
        await payment_service.complete_checkout(
            s,
            booking_id=seeded.booking_id,
            success=True,
            provider_ref="ptx-eski",
            token="cf-token-A",  # ESKİ oturumun token'ı — saklı ref ile uyuşmuyor
            paid_price=Decimal("500.00"),
        )
        await s.commit()

    payment = await _payment(seeded.booking_id)
    assert payment.status == PaymentStatus.PENDING, (
        "uyuşmayan token ile ödeme kesinleşti (çift tahsilat izlenemez olurdu)"
    )
    assert provider.refund_calls == [("ptx-eski", Decimal("500.00"))], (
        "beklenmeyen tahsilat sağlayıcıya iade edilmedi"
    )


async def test_c3_paid_price_mismatch_not_completed(factory, provider):
    """paidPrice != amount: ödeme kesinleşmez, tahsilat iade edilir."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.PENDING,
        provider_ref="cf-token-A",
        amount=Decimal("500.00"),
    )
    async with AsyncSessionLocal() as s:
        await payment_service.complete_checkout(
            s,
            booking_id=seeded.booking_id,
            success=True,
            provider_ref="ptx-1",
            token="cf-token-A",
            paid_price=Decimal("400.00"),  # eksik tahsilat
        )
        await s.commit()

    payment = await _payment(seeded.booking_id)
    assert payment.status != PaymentStatus.HELD, (
        "eksik tahsilat tam tutar ödenmiş gibi kesinleşti"
    )
    assert provider.refund_calls == [("ptx-1", Decimal("400.00"))]


async def test_c3_matching_token_still_completes(factory, provider):
    """Regresyon: token + tutar doğruysa normal akış bozulmamalı (PENDING→HELD)."""
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED,
        payment_status=PaymentStatus.PENDING,
        provider_ref="cf-token-A",
        amount=Decimal("500.00"),
    )
    async with AsyncSessionLocal() as s:
        await payment_service.complete_checkout(
            s,
            booking_id=seeded.booking_id,
            success=True,
            provider_ref="ptx-1",
            token="cf-token-A",
            paid_price=Decimal("500.00"),
        )
        await s.commit()

    payment = await _payment(seeded.booking_id)
    assert payment.status == PaymentStatus.HELD
    assert payment.provider_ref == "ptx-1"  # iade artık işlem kimliğiyle yapılır
    assert provider.refund_calls == []
