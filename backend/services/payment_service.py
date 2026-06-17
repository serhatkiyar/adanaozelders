"""Escrow (emanet) ödeme iş mantığı — sağlayıcıdan bağımsız.

Akış: tutor accept → create_for_booking (PENDING) → öğrenci pay → HELD (emanet) →
ders COMPLETED → release (RELEASED, eğitmen kazancı) → iptal → refund (REFUNDED).
Komisyon PLATFORM_COMMISSION_RATE ile hesaplanır; tutar booking.price'tan gelir.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor
from services import commission, notification_service


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def get_for_booking(db: AsyncSession, booking_id: int) -> Payment | None:
    stmt = select(Payment).where(
        Payment.booking_id == booking_id, Payment.deleted_at.is_(None)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def create_for_booking(db: AsyncSession, booking: Booking) -> Payment | None:
    """Tutor kabul ettiğinde ödeme kaydı oluşturur (PENDING).

    booking.price yoksa (eğitmen ücreti tanımsız) ödeme kurulmaz. Zaten ödeme varsa
    (ör. reschedule sonrası tekrar accept) mevcut kayıt döner — idempotent.
    """
    if booking.price is None:
        return None
    existing = await get_for_booking(db, booking.id)
    if existing is not None:
        return existing
    amount = Decimal(str(booking.price))
    tutor = await db.get(Tutor, booking.tutor_id)
    rate = commission.rate_for(tutor) if tutor else commission.effective_commission_rate(None, None)
    commission_amount, earning = commission.split(amount, rate)
    payment = Payment(
        booking_id=booking.id,
        amount=amount,
        commission_amount=commission_amount,
        tutor_earning=earning,
        commission_rate=rate,
        currency=settings.PAYMENT_CURRENCY,
        status=PaymentStatus.PENDING,
        provider=payments.get_payment_provider().name,
    )
    db.add(payment)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"Dersi kesinleştirmek için ücreti öde: {amount} {payment.currency}",
        link="/student/bookings",
    )
    return payment


async def pay(
    db: AsyncSession, booking: Booking, *, client_ip: str | None = None
) -> tuple[Payment, str | None]:
    """Öğrenci ödemesi: sağlayıcı charge → HELD (emanet). (payment, redirect_url) döner.

    Fake sağlayıcıda anında HELD; iyzico'da redirect_url (Checkout Form/3DS) döner ve
    sonuç callback'te ``complete_checkout`` ile kesinleşir. Idempotent: zaten
    ödenmişse mevcut kayıt döner.
    """
    payment = await get_for_booking(db, booking.id)
    if payment is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Bu rezervasyon için ödeme bulunamadı"
        )
    if payment.status in (PaymentStatus.HELD, PaymentStatus.RELEASED):
        return payment, None  # zaten ödenmiş
    if payment.status == PaymentStatus.REFUNDED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ödeme iade edilmiş")
    if booking.status != BookingStatus.ACCEPTED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Yalnızca onaylanmış bir ders için ödeme yapılabilir",
        )

    client = await db.get(Client, booking.client_id)
    provider = payments.get_payment_provider()
    result = await provider.charge(
        amount=Decimal(str(payment.amount)),
        currency=payment.currency,
        booking_id=booking.id,
        description=f"Ceyhan Ozel Ders #{booking.id}",
        reference=f"booking:{booking.id}",
        buyer=payments.buyer_from_client(client, ip=client_ip) if client else None,
    )
    if result.redirect_url:
        # Hosted checkout (iyzico): ödeme henüz tamamlanmadı; kullanıcı yönlendirilir,
        # callback'te ``complete_checkout`` ile HELD'e geçer.
        payment.provider_ref = result.provider_ref
        await db.flush()
        return payment, result.redirect_url
    if not result.success:
        payment.status = PaymentStatus.FAILED
        await db.flush()
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED, result.error or "Ödeme başarısız"
        )

    payment.status = PaymentStatus.HELD
    payment.provider_ref = result.provider_ref
    payment.paid_at = _now()
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="Bir ders için ödeme alındı (emanette). Ders sonunda kazancına geçecek.",
        link="/tutor",
    )
    return payment, None


async def complete_checkout(
    db: AsyncSession, *, booking_id: int, success: bool, provider_ref: str | None
) -> Payment | None:
    """iyzico callback'i sunucuda doğrulandıktan sonra ödemeyi kesinleştirir.

    Başarıda PENDING→HELD; ``provider_ref`` artık iade için kullanılacak işlem
    kimliğidir (paymentTransactionId, initialize'daki CF token'ının üzerine yazılır).
    Başarısızlıkta FAILED — öğrenci "Öde" ile yeniden deneyebilir. Idempotent:
    HELD/RELEASED/REFUNDED durumlarına dokunmaz.
    """
    payment = await get_for_booking(db, booking_id)
    if payment is None:
        return None
    if payment.status in (
        PaymentStatus.HELD,
        PaymentStatus.RELEASED,
        PaymentStatus.REFUNDED,
    ):
        return payment
    if not success:
        payment.status = PaymentStatus.FAILED
        await db.flush()
        return payment

    payment.status = PaymentStatus.HELD
    if provider_ref:
        payment.provider_ref = provider_ref
    payment.paid_at = _now()
    await db.flush()
    booking = await db.get(Booking, booking_id)
    if booking is not None:
        await notification_service.notify(
            db,
            user_id=booking.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Bir ders için ödeme alındı (emanette). Ders sonunda kazancına geçecek.",
            link="/tutor",
        )
    return payment


async def release(db: AsyncSession, booking: Booking) -> Payment | None:
    """Ders tamamlanınca emanetteki tutarı eğitmene serbest bırakır (RELEASED)."""
    payment = await get_for_booking(db, booking.id)
    if payment is None or payment.status != PaymentStatus.HELD:
        return payment
    payment.status = PaymentStatus.RELEASED
    payment.released_at = _now()
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"Ders tamamlandı; {payment.tutor_earning} {payment.currency} kazancına eklendi.",
        link="/tutor",
    )
    return payment


async def refund(db: AsyncSession, booking: Booking) -> Payment | None:
    """İptal durumunda emanetteki ödemeyi öğrenciye iade eder (REFUNDED).

    Ödeme yoksa ya da emanette değilse (henüz ödenmedi / zaten serbest) no-op.
    """
    payment = await get_for_booking(db, booking.id)
    if payment is None or payment.status != PaymentStatus.HELD:
        return payment
    provider = payments.get_payment_provider()
    ok = await provider.refund(
        provider_ref=payment.provider_ref, amount=Decimal(str(payment.amount))
    )
    if not ok:
        # Sağlayıcı iadesi başarısız: durumu değiştirme, admin manuel ele alsın.
        return payment
    payment.status = PaymentStatus.REFUNDED
    payment.refunded_at = _now()
    await db.flush()
    await notification_service.notify(
        db,
        user_id=booking.client_id,
        role_id=ROLE_IDS[RoleType.CLIENT],
        message=f"İptal edilen ders için ödemen iade edildi: {payment.amount} {payment.currency}",
        link="/student/bookings",
    )
    return payment


async def earnings_summary(db: AsyncSession, *, tutor_id: int) -> dict[str, Decimal]:
    """Eğitmenin kazanç özeti: RELEASED toplamı (net) + HELD toplamı (emanette/bekleyen)."""
    stmt = (
        select(Payment.status, func.coalesce(func.sum(Payment.tutor_earning), 0))
        .join(Booking, Booking.id == Payment.booking_id)
        .where(Booking.tutor_id == tutor_id, Payment.deleted_at.is_(None))
        .group_by(Payment.status)
    )
    by_status = {s: Decimal(str(total)) for s, total in (await db.execute(stmt)).all()}
    return {
        "released": by_status.get(PaymentStatus.RELEASED, Decimal("0")),
        "pending": by_status.get(PaymentStatus.HELD, Decimal("0")),
    }


async def platform_summary(db: AsyncSession) -> dict[str, Decimal]:
    """Platform geliri: serbest bırakılmış ödemelerin komisyon ve hacim toplamı."""
    stmt = select(
        func.coalesce(func.sum(Payment.commission_amount), 0),
        func.coalesce(func.sum(Payment.amount), 0),
    ).where(Payment.status == PaymentStatus.RELEASED, Payment.deleted_at.is_(None))
    commission, volume = (await db.execute(stmt)).one()
    return {
        "commission_total": Decimal(str(commission)),
        "volume_total": Decimal(str(volume)),
    }
