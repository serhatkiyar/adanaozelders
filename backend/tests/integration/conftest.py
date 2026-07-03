"""Para yolu entegrasyon testleri — GERÇEK Postgres (docker compose) gerektirir.

Üretimle AYNI engine/session fabrikası (core.database.AsyncSessionLocal) kullanılır;
engine isolation override etmez → testler üretimle birebir aynı seviyede
(READ COMMITTED) çalışır. Testler kendi satırlarını üretir ve teardown'da
FİZİKSEL siler; dev DB'de kalıcı iz bırakmaz.

Çalıştırma (backend/ içinden; kök conftest.py CI için sahte POSTGRES_* default'ları
koyduğundan gerçek değerler pytest'ten ÖNCE env ile verilmelidir):

    $env:POSTGRES_USER='postgres'; $env:POSTGRES_PASSWORD='...'
    $env:POSTGRES_DB='ceyhandb'; $env:POSTGRES_HOST='localhost'
    $env:POSTGRES_PORT='5433'   # docker compose host yayını (yerel 5432 çakışması!)
    python -m pytest tests/integration -q

DİKKAT: Hostta ayrıca yerel bir PostgreSQL servisi 5432'yi dinliyorsa loopback
bağlantıları sessizce ORAYA gider — compose postgres'i bu yüzden 5433'ten yayınlanır.

Postgres'e ulaşılamıyorsa testler FAIL değil SKIP olur.
"""
from __future__ import annotations

import asyncio
import dataclasses
import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal, engine
from core.payments.fake import FakePaymentProvider
from models.booking import Booking, BookingStatus
from models.client import Client
from models.library import Library
from models.library_exam import ExamRegistration, LibraryExamSession
from models.payment import Payment, PaymentStatus
from models.tutor import Tutor, TutorStatus
from services import commission


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def pg():
    """Gerçek Postgres erişilebilir mi? Değilse skip. Test sonunda engine havuzunu
    boşaltır (pytest-asyncio her testte yeni event loop kurar; asyncpg bağlantıları
    loop'a bağlıdır — dispose edilmezse sonraki test kırık bağlantı alır)."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres erişilemiyor ({exc.__class__.__name__}); docker compose ayakta mı?")
    yield engine
    await engine.dispose()


class StubProvider(FakePaymentProvider):
    """Çağrı sayan + kapı (gate) ile yarış penceresi genişletilebilen sağlayıcı.

    ``refund_gate`` verilirse refund çağrısı, event set edilene dek bekler — iki
    eşzamanlı transaction'ın "status okundu ama henüz yazılmadı" penceresinde
    buluşmasını DETERMİNİSTİK yapar.
    """

    def __init__(self) -> None:
        self.refund_calls: list[tuple[str | None, Decimal]] = []
        self.refund_gate: asyncio.Event | None = None
        self.refund_result: bool = True

    async def refund(self, *, provider_ref: str | None, amount: Decimal) -> bool:
        self.refund_calls.append((provider_ref, Decimal(str(amount))))
        if self.refund_gate is not None:
            await self.refund_gate.wait()
        return self.refund_result


@pytest.fixture
def provider(monkeypatch) -> StubProvider:
    stub = StubProvider()
    from core import payments

    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    return stub


@dataclasses.dataclass
class SeededBooking:
    tutor_id: int
    client_id: int
    booking_id: int
    payment_id: int
    amount: Decimal


@dataclasses.dataclass
class SeededExamReg:
    client_id: int
    library_id: int
    session_id: int
    reg_id: int
    amount: Decimal


class MoneyFactory:
    """Test verisi üretir ve ürettiklerini kaydeder; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.tutor_ids: list[int] = []
        self.client_ids: list[int] = []
        self.booking_ids: list[int] = []
        self.library_ids: list[int] = []
        self.session_ids: list[int] = []

    async def booking_with_payment(
        self,
        *,
        booking_status: BookingStatus = BookingStatus.ACCEPTED,
        payment_status: PaymentStatus = PaymentStatus.HELD,
        provider_ref: str | None = "cf-token",
        amount: Decimal = Decimal("500.00"),
    ) -> SeededBooking:
        rate = Decimal("0.1000")
        commission_amount, earning = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            u = _uniq()
            tutor = Tutor(
                email=f"t-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Testi", username=f"t{u}",
                role_id=2, status=TutorStatus.APPROVED, hourly_rate=Decimal("500"),
            )
            client = Client(
                email=f"c-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Ogrenci", username=f"c{u}", role_id=3,
            )
            s.add_all([tutor, client])
            await s.flush()
            start = _now() + datetime.timedelta(days=30)
            booking = Booking(
                tutor_id=tutor.id, client_id=client.id, status=booking_status,
                start_at=start, end_at=start + datetime.timedelta(hours=1),
                price=amount, mode="ONLINE",
            )
            s.add(booking)
            await s.flush()
            payment = Payment(
                booking_id=booking.id, amount=amount,
                commission_amount=commission_amount, tutor_earning=earning,
                commission_rate=rate, currency="TRY", status=payment_status,
                provider="fake", provider_ref=provider_ref,
                paid_at=_now() if payment_status == PaymentStatus.HELD else None,
            )
            s.add(payment)
            await s.flush()
            seeded = SeededBooking(
                tutor_id=tutor.id, client_id=client.id,
                booking_id=booking.id, payment_id=payment.id, amount=amount,
            )
            await s.commit()
        self.tutor_ids.append(seeded.tutor_id)
        self.client_ids.append(seeded.client_id)
        self.booking_ids.append(seeded.booking_id)
        return seeded

    async def exam_registration(
        self,
        *,
        reg_status: str,
        provider_ref: str | None = "cf-token",
        amount: Decimal = Decimal("100.00"),
        released_at: datetime.datetime | None = None,
        paid_at: datetime.datetime | None = None,
    ) -> SeededExamReg:
        rate = Decimal("0.1000")
        commission_amount, earning = commission.split(amount, rate)
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@money.test", hashed_password="x",
                first_name="Para", last_name="Ogrenci", username=f"c{u}", role_id=3,
            )
            library = Library(name=f"Test Kutuphane {u}", slug=f"test-kutuphane-{u}")
            s.add_all([client, library])
            await s.flush()
            session = LibraryExamSession(
                library_id=library.id, exam_type="TYT", title=f"Deneme {u}",
                starts_at=_now() + datetime.timedelta(days=30),
                duration_minutes=120, capacity=50, price=amount, currency="TRY",
                status="SCHEDULED",
            )
            s.add(session)
            await s.flush()
            reg = ExamRegistration(
                session_id=session.id, client_id=client.id, status=reg_status,
                amount=amount, commission_amount=commission_amount,
                library_earning=earning, commission_rate=rate, currency="TRY",
                provider="fake", provider_ref=provider_ref,
                paid_at=paid_at, released_at=released_at,
            )
            s.add(reg)
            await s.flush()
            seeded = SeededExamReg(
                client_id=client.id, library_id=library.id,
                session_id=session.id, reg_id=reg.id, amount=amount,
            )
            await s.commit()
        self.client_ids.append(seeded.client_id)
        self.library_ids.append(seeded.library_id)
        self.session_ids.append(seeded.session_id)
        return seeded

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "DELETE FROM notifications WHERE (role_id = 2 AND user_id = ANY(:t))"
                    " OR (role_id = 3 AND user_id = ANY(:c))"
                ),
                {"t": self.tutor_ids or [0], "c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM payments WHERE booking_id = ANY(:ids)"),
                {"ids": self.booking_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM bookings WHERE id = ANY(:ids)"),
                {"ids": self.booking_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM exam_registrations WHERE session_id = ANY(:ids)"),
                {"ids": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM library_exam_sessions WHERE id = ANY(:ids)"),
                {"ids": self.session_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM libraries WHERE id = ANY(:ids)"),
                {"ids": self.library_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM tutors WHERE id = ANY(:ids)"),
                {"ids": self.tutor_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:ids)"),
                {"ids": self.client_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def factory(pg) -> MoneyFactory:
    f = MoneyFactory()
    yield f
    await f.cleanup()
