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

import logging

from core import payments
from core.config import settings
from models.booking import Booking, BookingStatus
from models.client import Client
from models.payment import Payment, PaymentStatus
from models.role import ROLE_IDS, RoleType
from models.store import Order, OrderItem, SellerType
from models.tutor import Tutor
from services import commission, escrow, notification_service

logger = logging.getLogger("ceyhan.payments")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def get_for_booking(db: AsyncSession, booking_id: int) -> Payment | None:
    stmt = select(Payment).where(
        Payment.booking_id == booking_id, Payment.deleted_at.is_(None)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def create_for_booking(db: AsyncSession, booking: Booking) -> Payment | None:
    """Tutor kabul ettiğinde ödeme kaydı oluşturur (PENDING).

    booking.price yoksa (eğitmen ücreti tanımsız) ya da ücretsiz ilk dersse (price=0)
    ödeme kurulmaz. Zaten ödeme varsa (ör. reschedule sonrası tekrar accept) mevcut
    kayıt döner — idempotent.
    """
    if booking.price is None or Decimal(str(booking.price)) == 0:
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


async def sync_amount_with_booking(db: AsyncSession, booking: Booking) -> None:
    """Reschedule fiyatı değiştirdiyse ödemeyi sunucu-hesaplı güncel fiyata eşitler.

    - PENDING/FAILED (henüz tahsilat yok): amount + komisyon + kazanç güncel oran
      üzerinden yeniden hesaplanır (conservation korunur).
    - HELD (tahsil edilmiş): tutar değişiyorsa 409 — emanetteki para ile ders
      ücreti sessizce ayrışamaz; öğrenci iptal edip yeni talep oluşturmalı.
      (Aynı süre/fiyatla saat taşımak serbesttir.)
    RELEASED/REFUNDING/REFUNDED bu akışta oluşamaz (reschedule yalnız
    PENDING/ACCEPTED booking'te çağrılır); yine de dokunulmaz.
    """
    payment = await get_for_booking(db, booking.id)
    if payment is None or booking.price is None:
        return
    new_amount = Decimal(str(booking.price))
    if new_amount == Decimal(str(payment.amount)):
        return
    if payment.status in (PaymentStatus.PENDING, PaymentStatus.FAILED):
        tutor = await db.get(Tutor, booking.tutor_id)
        rate = (
            commission.rate_for(tutor)
            if tutor
            else Decimal(str(payment.commission_rate))
        )
        commission_amount, earning = commission.split(new_amount, rate)
        payment.amount = new_amount
        payment.commission_amount = commission_amount
        payment.tutor_earning = earning
        payment.commission_rate = rate
        await db.flush()
        return
    if payment.status == PaymentStatus.HELD:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ödemesi alınmış dersin ücreti değiştirilemez; süreyi değiştirmek için "
            "dersi iptal edip yeni talep oluşturun.",
        )


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
    if payment.status == PaymentStatus.REFUNDING:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu ödemenin iade süreci devam ediyor"
        )
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

    claimed = await escrow.claim(
        db,
        Payment,
        payment.id,
        from_statuses=[PaymentStatus.PENDING, PaymentStatus.FAILED],
        values={
            "status": PaymentStatus.HELD,
            "provider_ref": result.provider_ref,
            "paid_at": _now(),
        },
    )
    await db.refresh(payment)
    if claimed:
        await notification_service.notify(
            db,
            user_id=booking.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Bir ders için ödeme alındı (emanette). Ders sonunda kazancına geçecek.",
            link="/tutor",
        )
    return payment, None


async def complete_checkout(
    db: AsyncSession,
    *,
    booking_id: int,
    success: bool,
    provider_ref: str | None,
    token: str | None = None,
    paid_price: Decimal | None = None,
) -> Payment | None:
    """iyzico callback'i sunucuda doğrulandıktan sonra ödemeyi kesinleştirir.

    Başarıda PENDING→HELD; ``provider_ref`` artık iade için kullanılacak işlem
    kimliğidir (paymentTransactionId, initialize'daki CF token'ının üzerine yazılır).
    Başarısızlıkta FAILED — öğrenci "Öde" ile yeniden deneyebilir. Idempotent:
    HELD/RELEASED/REFUNDING/REFUNDED durumlarına dokunmaz.

    C3 doğrulamaları (yalnız verildiğinde):
    - ``token`` saklı CF token'ı ile eşleşmeli — eşleşmiyorsa bu başka (eski/ikinci)
      bir checkout oturumunun tahsilatıdır: varlığa DOKUNULMAZ, para aynen iade edilir
      (çift tahsilat kayıtsız kalamaz).
    - ``paid_price`` varlık tutarına eşit olmalı — değilse kesinleştirilmez, iade edilir.

    Booking bu arada iptal/red edildiyse (öğrenci iyzico sayfasındayken) tahsil
    edilen para HELD'e alınıp kilitlenmez — anında iade akışı başlatılır.
    """
    payment = await get_for_booking(db, booking_id)
    if payment is None:
        return None
    if payment.status in (
        PaymentStatus.HELD,
        PaymentStatus.RELEASED,
        PaymentStatus.REFUNDING,
        PaymentStatus.REFUNDED,
    ):
        return payment  # idempotent — replay'ler token kontrolünden ÖNCE düşer
    if (
        success
        and token
        and payment.provider_ref
        and token != payment.provider_ref
    ):
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price if paid_price is not None else Decimal(str(payment.amount)),
            context=f"token uyuşmazlığı booking={booking_id}",
        )
        return payment
    if (
        success
        and paid_price is not None
        and paid_price != Decimal(str(payment.amount))
    ):
        await escrow.refund_unexpected_charge(
            provider_ref=provider_ref,
            amount=paid_price,
            context=(
                f"paidPrice uyuşmazlığı booking={booking_id} "
                f"(beklenen {payment.amount}, tahsil {paid_price})"
            ),
        )
        return payment
    if not success:
        if token and payment.provider_ref and token != payment.provider_ref:
            return payment  # bayat oturumun başarısızlığı aktif oturumu FAILED'lamasın
        await escrow.claim(
            db,
            Payment,
            payment.id,
            from_statuses=[PaymentStatus.PENDING],
            values={"status": PaymentStatus.FAILED},
        )
        await db.refresh(payment)
        return payment

    booking = await db.get(Booking, booking_id)
    booking_dead = (
        booking is None
        or booking.deleted_at is not None
        or booking.status in (BookingStatus.CANCELLED, BookingStatus.REJECTED)
    )
    if booking_dead:
        # Para sağlayıcıda tahsil edildi ama ders artık yok: emanete almak parayı
        # süresiz kilitler (hiçbir akış release/refund etmez). Doğrudan iade başlat.
        async def _notify_refund() -> None:
            if booking is not None:
                await notification_service.notify(
                    db,
                    user_id=booking.client_id,
                    role_id=ROLE_IDS[RoleType.CLIENT],
                    message=(
                        f"İptal edilen ders için ödemen iade edildi: "
                        f"{payment.amount} {payment.currency}"
                    ),
                    link="/student/bookings",
                )

        outcome = await escrow.refund_escrow(
            db,
            payment,
            escrow.PAYMENT_SPEC,
            from_statuses=[PaymentStatus.PENDING, PaymentStatus.FAILED],
            provider_ref=provider_ref,
            notify=_notify_refund,
        )
        logger.error(
            "iyzico callback: iptal edilmiş booking'e tahsilat geldi; iade akışı=%s "
            "(booking=%s payment=%s)",
            outcome,
            booking_id,
            payment.id,
        )
        return payment

    values: dict = {"status": PaymentStatus.HELD, "paid_at": _now()}
    if provider_ref:
        values["provider_ref"] = provider_ref
    claimed = await escrow.claim(
        db,
        Payment,
        payment.id,
        from_statuses=[PaymentStatus.PENDING, PaymentStatus.FAILED],
        values=values,
    )
    await db.refresh(payment)
    if claimed:
        await notification_service.notify(
            db,
            user_id=booking.tutor_id,
            role_id=ROLE_IDS[RoleType.TUTOR],
            message="Bir ders için ödeme alındı (emanette). Ders sonunda kazancına geçecek.",
            link="/tutor",
        )
    return payment


async def release(db: AsyncSession, booking: Booking) -> Payment | None:
    """Ders tamamlanınca emanetteki tutarı eğitmene serbest bırakır (RELEASED).

    Atomik claim (HELD→RELEASED): eşzamanlı bir iade ile yarışırsa yalnız biri
    kazanır — kaybeden hiçbir para hareketi yapmaz.
    """
    payment = await get_for_booking(db, booking.id)
    if payment is None:
        return None
    claimed = await escrow.claim(
        db,
        Payment,
        payment.id,
        from_statuses=[PaymentStatus.HELD],
        values={"status": PaymentStatus.RELEASED, "released_at": _now()},
    )
    if not claimed:
        return payment
    await db.refresh(payment)
    await notification_service.notify(
        db,
        user_id=booking.tutor_id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message=f"Ders tamamlandı; {payment.tutor_earning} {payment.currency} kazancına eklendi.",
        link="/tutor",
    )
    return payment


async def refund(db: AsyncSession, booking: Booking) -> Payment | None:
    """İptal durumunda emanetteki ödemeyi öğrenciye iade eder (iki fazlı).

    Faz 1 niyeti claim edip commit'ler (HELD→REFUNDING; yarışta tek kazanan),
    Faz 2 sağlayıcı iadesi + REFUNDED finalize. Sağlayıcı başarısızsa kayıt
    REFUNDING'de kalır ve reconciler devralır — sessiz kilitli para kalmaz.
    Ödeme yoksa ya da emanette değilse no-op.
    """
    payment = await get_for_booking(db, booking.id)
    if payment is None:
        return None

    async def _notify() -> None:
        await notification_service.notify(
            db,
            user_id=booking.client_id,
            role_id=ROLE_IDS[RoleType.CLIENT],
            message=(
                f"İptal edilen ders için ödemen iade edildi: "
                f"{payment.amount} {payment.currency}"
            ),
            link="/student/bookings",
        )

    await escrow.refund_escrow(db, payment, escrow.PAYMENT_SPEC, notify=_notify)
    return payment


def _month_start(now: datetime.datetime) -> datetime.datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def earnings_summary(db: AsyncSession, *, tutor_id: int) -> dict:
    """Eğitmenin kazanç özeti: RELEASED (net), HELD (emanette), bu ay ve iade toplamı."""
    stmt = (
        select(
            Payment.status,
            func.coalesce(func.sum(Payment.tutor_earning), 0),
            func.coalesce(func.sum(Payment.amount), 0),
        )
        .join(Booking, Booking.id == Payment.booking_id)
        .where(Booking.tutor_id == tutor_id, Payment.deleted_at.is_(None))
        .group_by(Payment.status)
    )
    earning_by_status: dict = {}
    amount_by_status: dict = {}
    for s, earning_total, amount_total in (await db.execute(stmt)).all():
        earning_by_status[s] = Decimal(str(earning_total))
        amount_by_status[s] = Decimal(str(amount_total))

    month_start = _month_start(_now())
    this_month_stmt = (
        select(func.coalesce(func.sum(Payment.tutor_earning), 0))
        .join(Booking, Booking.id == Payment.booking_id)
        .where(
            Booking.tutor_id == tutor_id,
            Payment.deleted_at.is_(None),
            Payment.status == PaymentStatus.RELEASED,
            Payment.released_at >= month_start,
        )
    )
    this_month = Decimal(str((await db.execute(this_month_stmt)).scalar_one()))

    # ── Mağaza dijital satışları (doğrudan satış; escrow yok → PAID anında "released") ──
    store_stmt = (
        select(func.coalesce(func.sum(OrderItem.tutor_earning), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.tutor_id == tutor_id,
            OrderItem.seller_type == SellerType.TUTOR.value,
            Order.payment_status == "PAID",
            Order.deleted_at.is_(None),
        )
    )
    store_released = Decimal(str((await db.execute(store_stmt)).scalar_one()))
    store_month = Decimal(
        str(
            (
                await db.execute(
                    store_stmt.where(Order.paid_at >= month_start)
                )
            ).scalar_one()
        )
    )

    return {
        "released": earning_by_status.get(PaymentStatus.RELEASED, Decimal("0"))
        + store_released,
        "pending": earning_by_status.get(PaymentStatus.HELD, Decimal("0")),
        "this_month": this_month + store_month,
        # REFUNDING = iade niyeti kesin (para eğitmene gelmeyecek) → iade kalemine
        # şimdiden dahil; "emanette" göstermek yanıltıcı olurdu.
        "refunded": amount_by_status.get(PaymentStatus.REFUNDED, Decimal("0"))
        + amount_by_status.get(PaymentStatus.REFUNDING, Decimal("0")),
        "currency": settings.PAYMENT_CURRENCY,
    }


async def earnings_transactions(
    db: AsyncSession, *, tutor_id: int, limit: int = 200
) -> list[dict]:
    """Eğitmenin ödeme hareketleri (en yeni önce) — Bakiye sayfası dökümü.

    Bekleyen (PENDING: öğrenci henüz ödemedi) dahil tüm ödemeler döner; böylece
    "ödeme bekleniyor" da listede görünür. ``occurred_at`` = serbest/ödeme/oluşturma.
    """
    stmt = (
        select(Payment, Booking, Client)
        .join(Booking, Booking.id == Payment.booking_id)
        .join(Client, Client.id == Booking.client_id)
        .where(Booking.tutor_id == tutor_id, Payment.deleted_at.is_(None))
        .order_by(Payment.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    out: list[dict] = []
    for payment, booking, client in rows:
        occurred = payment.released_at or payment.paid_at or payment.created_at
        out.append(
            {
                "id": payment.id,
                "source": "LESSON",
                "title": f"Özel ders #{booking.id}",
                "counterparty": client.full_name,
                "gross": Decimal(str(payment.amount)),
                "commission": Decimal(str(payment.commission_amount)),
                "net": Decimal(str(payment.tutor_earning)),
                "status": payment.status.value,
                "currency": payment.currency,
                "occurred_at": occurred,
                "created_at": payment.created_at,
            }
        )

    # ── Mağaza dijital satışları (kalem başına; PAID = serbest) ──
    store_rows = (
        await db.execute(
            select(OrderItem, Order, Client)
            .join(Order, Order.id == OrderItem.order_id)
            .join(Client, Client.id == Order.client_id)
            .where(
                OrderItem.tutor_id == tutor_id,
                OrderItem.seller_type == SellerType.TUTOR.value,
                Order.payment_status == "PAID",
                Order.deleted_at.is_(None),
            )
            .order_by(Order.created_at.desc())
            .limit(limit)
        )
    ).all()
    for item, order, client in store_rows:
        out.append(
            {
                "id": item.id,
                "source": "STORE",
                "title": item.title,
                "counterparty": client.full_name,
                "gross": Decimal(str(item.unit_price)) * item.quantity,
                "commission": Decimal(str(item.commission_amount or 0)),
                "net": Decimal(str(item.tutor_earning or 0)),
                "status": "RELEASED",
                "currency": order.currency,
                "occurred_at": order.paid_at or order.created_at,
                "created_at": order.created_at,
            }
        )

    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out[:limit]


async def platform_summary(db: AsyncSession) -> dict[str, Decimal]:
    """Platform geliri: serbest bırakılmış ödemelerin komisyon ve hacim toplamı."""
    stmt = select(
        func.coalesce(func.sum(Payment.commission_amount), 0),
        func.coalesce(func.sum(Payment.amount), 0),
    ).where(Payment.status == PaymentStatus.RELEASED, Payment.deleted_at.is_(None))
    commission, volume = (await db.execute(stmt)).one()
    # Mağaza: PAID siparişlerin hacmi + eğitmen dijital kalemlerinden alınan komisyon.
    store_volume = (
        await db.execute(
            select(func.coalesce(func.sum(Order.total), 0)).where(
                Order.payment_status == "PAID", Order.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    store_commission = (
        await db.execute(
            select(func.coalesce(func.sum(OrderItem.commission_amount), 0))
            .join(Order, Order.id == OrderItem.order_id)
            .where(Order.payment_status == "PAID", Order.deleted_at.is_(None))
        )
    ).scalar_one()
    return {
        "commission_total": Decimal(str(commission)) + Decimal(str(store_commission)),
        "volume_total": Decimal(str(volume)) + Decimal(str(store_volume)),
    }
