"""Escrow mutabakatı (reconciler) — sarkan iade niyetleri + bayat checkout'lar.

60 sn'lik arka plan döngüsünden çağrılır (main.py). İki işi vardır:

1. ``reconcile_refunding``: REFUNDING'de sarkan kayıtlar (claim commit'lendi ama
   sağlayıcı çağrısı sonuçsuz kaldı — crash/timeout). Karantina penceresi dolan
   kayıt için önce sağlayıcıdan POZİTİF kanıt aranır (refund_state); iade
   görünüyorsa yalnız yerel finalize. Görünmüyorsa sınırlı retry — tam-tutar
   iadenin sağlayıcıdaki AŞIRI-İADE REDDİ emniyet kemeridir (kayıp ilk çağrı
   aslında kabul edildiyse retry reddedilir; çift iade imkânsız). Deneme sınırı
   dolunca retry durur, kayıt alarm loguyla görünür kalır.

2. ``reconcile_stale_checkouts``: kullanıcı iyzico'da ödedi ama callback bize hiç
   ulaşmadı (tarayıcı kapandı) YA DA varlık bu arada iptal edildi. provider_ref'i
   (CF token) olan bayat PENDING/PENDING_PAYMENT/CANCELLED kayıtlar sağlayıcıdan
   ``retrieve_checkout`` ile doğrulanır ve callback'le AYNI idempotent
   ``complete_checkout`` yoluna verilir (ölü varlıkta otomatik iade dahil).

Her kayıt kendi commit'iyle işlenir — bir kayıttaki hata diğerlerini geciktirmez.
"""
from __future__ import annotations

import datetime
import logging
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import payments
from core.config import settings
from models.library_exam import ExamRegistration, RegistrationStatus
from models.payment import Payment, PaymentStatus
from models.store import Order, OrderPaymentStatus
from models.study_reservation import StudyReservation
from services import escrow

logger = logging.getLogger("adana.escrow")

# Bayat checkout taraması her CHECKOUT_RECONCILE_INTERVAL_SECONDS'ta bir koşar
# (60 sn'lik loop'tan daha seyrek — sağlayıcıya gereksiz okuma yapmamak için).
_last_checkout_scan: float = 0.0


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _reference_for(db: AsyncSession, obj, spec: escrow.EscrowSpec) -> str:
    if isinstance(obj, Payment):
        return f"{spec.reference_prefix}:{obj.booking_id}"
    return f"{spec.reference_prefix}:{obj.id}"


_REFUNDING_TARGETS: tuple[tuple[type, escrow.EscrowSpec], ...] = (
    (Payment, escrow.PAYMENT_SPEC),
    (ExamRegistration, escrow.EXAM_SPEC),
    (StudyReservation, escrow.STUDY_SPEC),
    (Order, escrow.ORDER_SPEC),
)


async def reconcile_refunding(db: AsyncSession) -> int:
    """Sarkan REFUNDING kayıtlarını güvenli biçimde sonuca sürer. Dönen: işlenen."""
    provider = payments.get_payment_provider()
    min_age = datetime.timedelta(minutes=settings.REFUND_RECONCILE_MIN_AGE_MINUTES)
    now = _now()
    handled = 0

    for model, spec in _REFUNDING_TARGETS:
        # Para durumunun kolonu modele göre değişir (Order'da `payment_status`).
        status_col = getattr(model, spec.status_attr)
        rows = (
            await db.execute(
                select(model).where(
                    status_col == spec.refunding,
                    model.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for obj in rows:
            reference = await _reference_for(db, obj, spec)
            state = await provider.refund_state(
                provider_ref=obj.provider_ref, reference=reference
            )
            action = escrow.next_refund_action(
                attempts=obj.refund_attempts,
                requested_at=obj.refund_requested_at,
                now=now,
                provider_state=state,
                min_age=min_age,
                max_attempts=settings.REFUND_MAX_ATTEMPTS,
            )
            if action == escrow.ACTION_WAIT:
                continue
            if action == escrow.ACTION_FINALIZE:
                # Sağlayıcıda iade POZİTİF görünüyor — yazma çağrısı yapmadan bitir.
                if await escrow.finalize_refund(db, obj, spec):
                    await db.commit()
                    handled += 1
                    logger.warning(
                        "reconciler: sağlayıcıda görünen iade yerelde finalize edildi "
                        "(%s#%s)", model.__name__, obj.id,
                    )
                continue
            if action == escrow.ACTION_ALERT:
                logger.error(
                    "reconciler: iade %s denemede sonuçlanamadı — MANUEL müdahale "
                    "gerekli (%s#%s ref=%s)",
                    obj.refund_attempts, model.__name__, obj.id, obj.provider_ref,
                )
                continue
            # ACTION_RETRY: deneme sayacını + karantinayı atomik tazele (bu turda
            # yalnız biz retry'layalım), sonra sağlayıcı iadesi.
            claimed = await escrow.claim(
                db,
                model,
                obj.id,
                from_statuses=[spec.refunding],
                values={
                    "refund_requested_at": now,
                    "refund_attempts": model.refund_attempts + 1,
                },
                status_attr=spec.status_attr,
            )
            if not claimed:
                continue
            await db.commit()
            await db.refresh(obj)
            if await escrow.perform_refund(db, obj, spec):
                await db.commit()
                handled += 1
    return handled


async def reconcile_stale_checkouts(db: AsyncSession) -> int:
    """Callback'i hiç gelmemiş (ya da varlığı ölmüş) checkout'ları sağlayıcıdan doğrular.

    Yalnız ``retrieve_checkout`` destekleyen sağlayıcıda (iyzico) çalışır; fake'te
    no-op. Sonuç, callback ile AYNI ``complete_checkout`` yoluna verilir — başarılı
    tahsilat ölü varlığa denk gelirse oradaki otomatik iade devreye girer.
    """
    global _last_checkout_scan
    provider = payments.get_payment_provider()
    retrieve = getattr(provider, "retrieve_checkout", None)
    if retrieve is None:
        return 0
    if time.monotonic() - _last_checkout_scan < settings.CHECKOUT_RECONCILE_INTERVAL_SECONDS:
        return 0
    _last_checkout_scan = time.monotonic()

    now = _now()
    newest = now - datetime.timedelta(minutes=settings.CHECKOUT_RECONCILE_MIN_AGE_MINUTES)
    oldest = now - datetime.timedelta(hours=settings.CHECKOUT_RECONCILE_MAX_AGE_HOURS)
    handled = 0

    # Booking ödemeleri: CF token'ı yazılmış ama hâlâ PENDING/FAILED olanlar.
    # (Yerel import: order_service → delivery_service → ... zincirinde döngü var.)
    from services import (
        library_exam_service,
        order_service,
        payment_service,
        study_reservation_service,
    )

    payments_rows = (
        await db.execute(
            select(Payment).where(
                Payment.status.in_([PaymentStatus.PENDING, PaymentStatus.FAILED]),
                Payment.provider_ref.isnot(None),
                Payment.deleted_at.is_(None),
                Payment.updated_at <= newest,
                Payment.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for p in payments_rows:
        result = await retrieve(token=p.provider_ref)
        if not result.success:
            continue
        await payment_service.complete_checkout(
            db, booking_id=p.booking_id, success=True,
            provider_ref=result.provider_ref,
            token=p.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning(
            "reconciler: kayıp callback tamamlandı (payment#%s booking=%s)",
            p.id, p.booking_id,
        )

    pendingish = [
        RegistrationStatus.PENDING_PAYMENT.value,
        RegistrationStatus.CANCELLED.value,
    ]
    reg_rows = (
        await db.execute(
            select(ExamRegistration).where(
                ExamRegistration.status.in_(pendingish),
                ExamRegistration.provider_ref.isnot(None),
                ExamRegistration.paid_at.is_(None),
                ExamRegistration.deleted_at.is_(None),
                ExamRegistration.updated_at <= newest,
                ExamRegistration.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for reg in reg_rows:
        result = await retrieve(token=reg.provider_ref)
        if not result.success:
            continue
        await library_exam_service.complete_checkout(
            db, registration_id=reg.id, success=True,
            provider_ref=result.provider_ref,
            token=reg.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (examreg#%s)", reg.id)

    res_rows = (
        await db.execute(
            select(StudyReservation).where(
                StudyReservation.status.in_(pendingish),
                StudyReservation.provider_ref.isnot(None),
                StudyReservation.paid_at.is_(None),
                StudyReservation.deleted_at.is_(None),
                StudyReservation.updated_at <= newest,
                StudyReservation.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for res in res_rows:
        result = await retrieve(token=res.provider_ref)
        if not result.success:
            continue
        await study_reservation_service.complete_checkout(
            db, reservation_id=res.id, success=True,
            provider_ref=result.provider_ref,
            token=res.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (studyres#%s)", res.id)

    # Mağaza siparişleri: en yüksek hacimli ödeme yüzeyi ve en uzun süre
    # kapsam dışında kalmış olan. Müşteri iyzico'da öder, tarayıcıyı kapatır →
    # para çekilmiştir ama sipariş sonsuza dek PENDING kalır, kitap gönderilmez
    # ve kimse fark etmezdi.
    order_rows = (
        await db.execute(
            select(Order).where(
                Order.payment_status.in_(
                    [OrderPaymentStatus.PENDING.value, OrderPaymentStatus.FAILED.value]
                ),
                Order.provider_ref.isnot(None),
                Order.paid_at.is_(None),
                Order.deleted_at.is_(None),
                Order.updated_at <= newest,
                Order.updated_at >= oldest,
            )
        )
    ).scalars().all()
    for order in order_rows:
        result = await retrieve(token=order.provider_ref)
        if not result.success:
            continue
        await order_service.complete_checkout(
            db, order_id=order.id, success=True,
            provider_ref=result.provider_ref,
            token=order.provider_ref, paid_price=result.paid_price,
        )
        await db.commit()
        handled += 1
        logger.warning("reconciler: kayıp callback tamamlandı (order#%s)", order.id)

    return handled
