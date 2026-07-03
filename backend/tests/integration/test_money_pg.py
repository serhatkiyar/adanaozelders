"""Para yolu repro testleri — C1 / C2 / H2 (gerçek Postgres, READ COMMITTED).

Bu dosya denetim bulgularını ÜRETEREK kanıtlar: escrow claim katmanı gelene dek
bu testlerin BAŞARISIZ olması beklenir (kırmızı → fix → yeşil).

C1: release/refund yarışı — kilit yok, check-then-act atomik değil.
C2: iyzico callback'i iptal edilmiş varlıkta parayı kara deliğe düşürür.
H2: released_at damgalı (no-show release edilmiş) kayıt ikinci kez iade edilir.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.booking import Booking, BookingStatus
from models.library_exam import ExamRegistration, RegistrationStatus
from models.payment import Payment, PaymentStatus
from services import library_exam_service, payment_service


async def _load_payment(booking_id: int) -> Payment:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Payment).where(Payment.booking_id == booking_id))
        ).scalar_one()


async def test_isolation_level_matches_production(pg):
    """Kanıt geçerliliği: testler üretimle aynı isolation'da koşmalı."""
    async with AsyncSessionLocal() as s:
        level = (await s.execute(text("SHOW transaction_isolation"))).scalar_one()
    assert level == "read committed"


async def test_c1_concurrent_cancels_double_refund(factory, provider):
    """İki eşzamanlı refund → sağlayıcıya İKİ iade emri gitmemeli (C1).

    Gate, iki transaction'ı da "status HELD okundu, henüz yazılmadı" penceresinde
    buluşturur — yarış deterministik hale gelir.
    """
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED, payment_status=PaymentStatus.HELD
    )
    provider.refund_gate = asyncio.Event()

    async def do_refund() -> None:
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, seeded.booking_id)
            await payment_service.refund(s, booking)
            await s.commit()

    t1 = asyncio.create_task(do_refund())
    t2 = asyncio.create_task(do_refund())
    await asyncio.sleep(0.5)  # ikisi de status kontrolünü geçsin
    provider.refund_gate.set()
    await asyncio.gather(t1, t2)

    assert len(provider.refund_calls) == 1, (
        f"çift iade: sağlayıcıya {len(provider.refund_calls)} iade emri gitti"
    )
    payment = await _load_payment(seeded.booking_id)
    assert payment.status in (PaymentStatus.REFUNDED, PaymentStatus.REFUNDING)


async def test_c1_release_refund_race(factory, provider):
    """Auto-complete release'i ile eşzamanlı cancel refund'u: yalnız BİRİ kazanmalı.

    Bugünkü kodda ikisi de HELD okur → hem released_at hem refunded_at damgalanır
    (eğitmene 'kazanç eklendi' + öğrenciye iade birlikte gerçekleşir).
    """
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.ACCEPTED, payment_status=PaymentStatus.HELD
    )
    provider.refund_gate = asyncio.Event()

    async def do_refund() -> None:
        async with AsyncSessionLocal() as s:
            booking = await s.get(Booking, seeded.booking_id)
            await payment_service.refund(s, booking)
            await s.commit()

    refund_task = asyncio.create_task(do_refund())
    await asyncio.sleep(0.3)  # refund status'u okuyup provider'da beklesin

    async with AsyncSessionLocal() as s:
        booking = await s.get(Booking, seeded.booking_id)
        await payment_service.release(s, booking)
        await s.commit()

    provider.refund_gate.set()
    await refund_task

    payment = await _load_payment(seeded.booking_id)
    assert not (payment.released_at is not None and payment.refunded_at is not None), (
        "hem release hem refund gerçekleşti: eğitmen kazancı + öğrenci iadesi birlikte"
    )
    assert len(provider.refund_calls) <= 1


async def test_c2_booking_callback_after_cancel(factory, provider):
    """Booking iptal edildikten SONRA gelen başarılı callback (C2a).

    Para iyzico'da tahsil edildi; HELD'e geçip süresiz kilitlenmemeli —
    iade edilmeli.
    """
    seeded = await factory.booking_with_payment(
        booking_status=BookingStatus.CANCELLED, payment_status=PaymentStatus.PENDING
    )
    async with AsyncSessionLocal() as s:
        await payment_service.complete_checkout(
            s, booking_id=seeded.booking_id, success=True, provider_ref="ptx-1"
        )
        await s.commit()

    payment = await _load_payment(seeded.booking_id)
    assert payment.status != PaymentStatus.HELD, (
        "iptal edilmiş dersin parası emanette (HELD) kilitli kaldı"
    )
    assert len(provider.refund_calls) == 1, "tahsil edilen para iade edilmedi"


async def test_c2_examreg_callback_after_cancel(factory, provider):
    """Kayıt iptal edildikten SONRA gelen başarılı callback (C2b).

    Bugünkü kod sessizce return eder — para iyzico'da çekilmiş ama hiçbir kayda
    bağlanmamış olur. Beklenen: anında iade.
    """
    seeded = await factory.exam_registration(
        reg_status=RegistrationStatus.CANCELLED.value
    )
    async with AsyncSessionLocal() as s:
        await library_exam_service.complete_checkout(
            s, registration_id=seeded.reg_id, success=True, provider_ref="ptx-2"
        )
        await s.commit()

    assert len(provider.refund_calls) == 1, (
        "iptal edilmiş kayda gelen tahsilat iade edilmedi (para kara delikte)"
    )


async def test_h2_cancel_session_skips_released_no_show(factory, provider):
    """No-show release edilmiş (released_at dolu, status PAID) kayıt, oturum
    iptalinde İKİNCİ kez para hareketi görmemeli (H2).

    Bugünkü cancel_session yalnız status==PAID'e bakar → release edilmiş kaydı
    da iade eder: kütüphane kazancı + öğrenci iadesi = çifte ödeme.
    """
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    seeded = await factory.exam_registration(
        reg_status=RegistrationStatus.PAID.value,
        paid_at=now - datetime.timedelta(days=2),
        released_at=now - datetime.timedelta(days=1),
    )
    async with AsyncSessionLocal() as s:
        await library_exam_service.cancel_session(s, seeded.session_id)

    async with AsyncSessionLocal() as s:
        reg = (
            await s.execute(
                select(ExamRegistration).where(ExamRegistration.id == seeded.reg_id)
            )
        ).scalar_one()
    assert provider.refund_calls == [], (
        "emaneti zaten serbest bırakılmış no-show kaydına iade emri gönderildi"
    )
    assert reg.status != RegistrationStatus.REFUNDED.value
