"""I — HAKEDİŞ DEFTERİ (gerçek DB, gerçek servis).

BEKLENEN DAVRANIŞ:

I1. Borç = hak edilmiş − ödenen. Hiç ödeme yapılmadıysa borç = hak edilmiş.
I2. EMANETTEKİ para borç DEĞİLDİR: ders henüz yapılmamıştır ve iade edilebilir.
    Emaneti borç saymak, iade halinde platformu zarara sokar.
I3. Mağaza dijital satışı PAID anında hak edilir (doğrudan satış, emanet yok).
I4. Ödeme kaydedilince borç düşer; kısmi ödeme meşrudur.
I5. Borçtan fazlası kaydedilemez (bakiye negatife düşerse mutabakat bozulur).
I6. Kütüphane geliri yalnız `released_at` doluysa (QR ile katılım doğrulandı)
    hak edilmiş sayılır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

pytestmark = pytest.mark.asyncio

UTC = datetime.timezone.utc


def _now():
    return datetime.datetime.now(UTC)


async def _booking_payment(db, factory, tutor, client, *, status, earning="450.00"):
    """Ders + ödeme kaydı kurar."""
    from models.booking import Booking, BookingStatus
    from models.payment import Payment

    start = _now() + datetime.timedelta(days=1)
    b = Booking(
        tutor_id=tutor.id,
        client_id=client.id,
        status=BookingStatus.ACCEPTED,
        start_at=start,
        end_at=start + datetime.timedelta(hours=1),
        price=Decimal("500.00"),
        mode="ONLINE",
    )
    db.add(b)
    await db.flush()
    p = Payment(
        booking_id=b.id,
        amount=Decimal("500.00"),
        commission_amount=Decimal("50.00"),
        tutor_earning=Decimal(earning),
        commission_rate=Decimal("0.1000"),
        currency="TRY",
        status=status,
        provider="fake",
        released_at=_now() if status.value == "RELEASED" else None,
    )
    db.add(p)
    await db.flush()
    return b, p


async def _balance(db, tutor_id: int):
    from services import payout_ledger

    return await payout_ledger.balance_for(
        db, payee_type="TUTOR", payee_id=tutor_id
    )


# ── I1/I2: hak edilmiş vs emanetteki ─────────────────────────────────────────


async def test_I1_released_ders_borc_olarak_gorunur(db, factory, fake_provider):
    from models.payment import PaymentStatus
    from services import payout_ledger

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.RELEASED)
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal is not None
    assert bal.earned == Decimal("450.00"), f"hak ediş {bal.earned}"
    assert bal.paid == Decimal("0.00")
    assert bal.balance == Decimal("450.00")

    # Borçlular listesinde görünmeli.
    owed = await payout_ledger.list_balances(db, only_owed=True)
    assert any(b.payee_id == tutor.id and b.payee_type == "TUTOR" for b in owed)


async def test_I2_emanetteki_para_borc_degildir(db, factory, fake_provider):
    """HELD = ders yapılmadı; iade edilebilir. Borç saymak zarar üretir."""
    from models.payment import PaymentStatus

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.HELD)
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal is not None
    assert bal.earned == Decimal("0.00"), "emanetteki para hak ediş sayılmamalı"
    assert bal.balance == Decimal("0.00"), "emanet için borç oluşmamalı"
    assert bal.pending == Decimal("450.00"), "emanet ayrı gösterilmeli"


async def test_I2b_iade_edilmis_ders_borc_uretmez(db, factory, fake_provider):
    from models.payment import PaymentStatus

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.REFUNDED)
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal is None or bal.balance == Decimal("0.00")


# ── I3: mağaza dijital satışı ────────────────────────────────────────────────


async def test_I3_magaza_dijital_satisi_paid_aninda_hak_edilir(
    db, factory, fake_provider
):
    """Doğrudan satış — emanet yok, ödeme kesinleşince eğitmen hak eder."""
    from models.store import OrderItem

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    product = await factory.product(db, price="200.00", kind="DIGITAL", stock=None)
    order = await factory.order(
        db, client=client, items=[(product, 1)],
        payment_status="PAID", status="PAID",
    )
    # Kalemi eğitmen satışı yap (factory PLATFORM üretiyor).
    item = (
        await db.execute(
            __import__("sqlalchemy").text(
                "SELECT id FROM order_items WHERE order_id = :i"
            ),
            {"i": order.id},
        )
    ).scalar()
    row = await db.get(OrderItem, item)
    row.seller_type = "TUTOR"
    row.tutor_id = tutor.id
    row.tutor_earning = Decimal("180.00")
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal is not None
    assert bal.earned == Decimal("180.00"), f"dijital satış hak edişi {bal.earned}"


# ── I4/I5: ödeme kaydı ───────────────────────────────────────────────────────


async def test_I4_odeme_kaydi_borcu_dusurur(db, factory, fake_provider):
    from models.payment import PaymentStatus
    from services import payout_ledger

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.RELEASED)
    await db.commit()

    # Kısmi ödeme
    await payout_ledger.record_payment(
        db, payee_type="TUTOR", payee_id=tutor.id,
        amount=Decimal("200.00"), admin_id=None, reference="EFT-1",
    )
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal.paid == Decimal("200.00")
    assert bal.balance == Decimal("250.00"), "kalan borç 450 − 200 olmalı"

    # Kalanı öde
    await payout_ledger.record_payment(
        db, payee_type="TUTOR", payee_id=tutor.id,
        amount=Decimal("250.00"), admin_id=None,
    )
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal.balance == Decimal("0.00")
    owed = await payout_ledger.list_balances(db, only_owed=True)
    assert not any(b.payee_id == tutor.id for b in owed), "borcu bitmiş kişi listede kalmamalı"


async def test_I5_fazla_odeme_bakiyeyi_negatife_dusurmez(db, factory, fake_provider):
    """Servis katmanı kaydı yazar; NEGATİF bakiye üretmemeli (uç ayrıca reddeder)."""
    from models.payment import PaymentStatus
    from services import payout_ledger

    tutor = await factory.tutor(db)
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.RELEASED)
    await db.commit()

    await payout_ledger.record_payment(
        db, payee_type="TUTOR", payee_id=tutor.id,
        amount=Decimal("9999.00"), admin_id=None,
    )
    await db.commit()

    bal = await _balance(db, tutor.id)
    assert bal.balance == Decimal("0.00"), "bakiye negatife düşmemeli"


async def test_I5b_iban_snapshot_alinir(db, factory, fake_provider):
    """Alıcı sonradan IBAN'ını değiştirirse geçmiş ödemenin izi kaybolmamalı."""
    from models.payment import PaymentStatus
    from services import payout_ledger

    tutor = await factory.tutor(db)
    tutor.iban = "TR000000000000000000000001"
    client = await factory.client(db)
    await _booking_payment(db, factory, tutor, client, status=PaymentStatus.RELEASED)
    await db.commit()

    row = await payout_ledger.record_payment(
        db, payee_type="TUTOR", payee_id=tutor.id,
        amount=Decimal("100.00"), admin_id=None,
    )
    await db.commit()
    assert row.iban_snapshot == "TR000000000000000000000001"


# ── I6: kütüphane geliri ─────────────────────────────────────────────────────


async def test_I6_kutuphane_geliri_yalniz_release_sonrasi_borctur(
    db, factory, fake_provider
):
    from models.library import Library, LibraryStatus
    from models.study_reservation import StudyReservation
    from services import payout_ledger

    client = await factory.client(db)
    lib = Library(name="Test Kütüphane", slug=f"tk-{client.id}", status=LibraryStatus.ACTIVE.value)
    db.add(lib)
    await db.flush()

    ortak = dict(
        library_id=lib.id,
        client_id=client.id,
        hourly_price=Decimal("50.00"),
        amount=Decimal("100.00"),
        commission_amount=Decimal("10.00"),
        library_earning=Decimal("90.00"),
        commission_rate=Decimal("0.1000"),
        currency="TRY",
        provider="fake",
        paid_at=_now(),
        starts_at=_now() + datetime.timedelta(days=1),
        ends_at=_now() + datetime.timedelta(days=1, hours=2),
        status="PAID",
    )
    # Biri katılım doğrulanmış (released), biri değil.
    db.add(StudyReservation(**ortak, released_at=_now()))
    db.add(StudyReservation(**ortak, released_at=None))
    await db.commit()

    try:
        bal = await payout_ledger.balance_for(
            db, payee_type="LIBRARY", payee_id=lib.id
        )
        assert bal is not None
        assert bal.earned == Decimal("90.00"), (
            f"yalnız released olan hak ediş sayılmalı, bulundu: {bal.earned}"
        )
        assert bal.pending == Decimal("90.00"), "diğeri emanette görünmeli"
    finally:
        from sqlalchemy import text

        await db.execute(
            text("DELETE FROM study_reservations WHERE library_id = :i"), {"i": lib.id}
        )
        await db.execute(text("DELETE FROM libraries WHERE id = :i"), {"i": lib.id})
        await db.commit()
