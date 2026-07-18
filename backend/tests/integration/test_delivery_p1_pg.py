"""P1 seti entegrasyon testleri — GERÇEK Postgres (bkz. conftest.py başlığı).

1) Outbox: enqueue → dispatch (SENT); hata → backoff'la retry → SENT.
2) Watchdog: saatlerce ACTIVE kalan tur otomatik kapanır (stop FAILED,
   sipariş PAID'e döner, sms:failed outbox'a yazılır).
3) ETA: start_run optimize-anı ETA'larını gerçek çıkışa kaydırır; teslim
   gecikmesi kalan durakların ETA'sına drift olarak yansır.
4) Kapasite: dolu güne söz verilmez (_first_capacity_day sorgusu).
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from core import outbox, sms
from core.config import settings
from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.outbox import OutboxEvent
from models.store import Order
from services import delivery_service, order_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class P1Factory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def run(
        self,
        *,
        status: str = "PLANNED",
        started_at: datetime.datetime | None = None,
        optimized_at: datetime.datetime | None = None,
    ) -> int:
        async with AsyncSessionLocal() as s:
            run = DeliveryRun(
                run_date=datetime.date.today(), vehicle="LADA", status=status,
                started_at=started_at, optimized_at=optimized_at,
            )
            s.add(run)
            await s.flush()
            run_id = run.id
            self.run_ids.append(run_id)
            await s.commit()
        return run_id

    async def order_with_stop(
        self,
        run_id: int,
        *,
        order_status: str = "PAID",
        sequence: int = 1,
        otp_code: str | None = None,
        eta: datetime.datetime | None = None,
        phone: str | None = "+905551112233",
        promised: datetime.date | None = None,
    ) -> tuple[int, int]:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@p1.test", hashed_password="x",
                first_name="P1", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            self.client_ids.append(client.id)
            order = Order(
                client_id=client.id, status=order_status, payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="P1 Testi",
                ship_phone=phone, ship_address="Test adres", ship_in_zone=True,
                promised_delivery_date=promised,
                tracking_no="ELDEN-TEST" if order_status == "SHIPPED" else None,
            )
            s.add(order)
            await s.flush()
            stop = DeliveryStop(
                run_id=run_id, order_id=order.id, sequence=sequence,
                qr_token=delivery_service.new_qr_token(), status="PENDING",
                eta=eta,
            )
            if otp_code is not None:
                stop.otp_hash = delivery_service.hash_otp(otp_code)
                stop.otp_sent_at = _now()
            s.add(stop)
            await s.flush()
            ids = (order.id, stop.id)
            self.order_ids.append(order.id)
            await s.commit()
        return ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            for run_id in self.run_ids:
                await s.execute(
                    text(
                        "DELETE FROM notifications WHERE role_id = 1 "
                        "AND message LIKE :pat"
                    ),
                    {"pat": f"%Dağıtım turu #{run_id} %"},
                )
            await s.execute(
                text(
                    "DELETE FROM outbox_events "
                    "WHERE (payload->>'order_id')::int = ANY(:ids)"
                ),
                {"ids": self.order_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM delivery_stops WHERE order_id = ANY(:ids) OR run_id = ANY(:runs)"),
                {"ids": self.order_ids or [0], "runs": self.run_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM delivery_runs WHERE id = ANY(:ids)"),
                {"ids": self.run_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM order_status_history WHERE order_id = ANY(:ids)"),
                {"ids": self.order_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM orders WHERE id = ANY(:ids)"),
                {"ids": self.order_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:ids)"),
                {"ids": self.client_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def p1(pg) -> P1Factory:
    f = P1Factory()
    yield f
    await f.cleanup()


# ── 1) Outbox ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_outbox_dispatch_sends_and_marks_sent(p1, monkeypatch):
    # Bu test sessiz saatle ilgili değil; deterministik olsun diye kapat
    # (aksi halde gerçek saat gece ise SMS ertelenir → test zamana bağımlı olur).
    monkeypatch.setattr(settings, "DELIVERY_QUIET_START_HOUR", 0)
    marker = 987650001  # cleanup payload order_id ile siler
    p1.order_ids.append(marker)
    async with AsyncSessionLocal() as s:
        outbox.enqueue(s, "sms:failed", {"to": "+905551112233", "order_id": marker})
        await s.commit()
    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)
    async with AsyncSessionLocal() as s:
        ev = (
            await s.execute(
                select(OutboxEvent).where(
                    OutboxEvent.payload["order_id"].as_integer() == marker
                )
            )
        ).scalars().first()
        assert ev is not None
        assert ev.status == "SENT"
        assert ev.attempts == 1


@pytest.mark.asyncio
async def test_outbox_retries_with_backoff_then_succeeds(p1, monkeypatch):
    # Sessiz saat bu testin konusu değil — kapat (bkz. yukarıdaki not).
    monkeypatch.setattr(settings, "DELIVERY_QUIET_START_HOUR", 0)
    marker = 987650002
    p1.order_ids.append(marker)
    calls = {"n": 0}

    async def flaky(*, to: str, order_id: int) -> bool:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("SMS sağlayıcısı düştü")
        return True

    monkeypatch.setattr(sms, "send_failed_sms", flaky)

    async with AsyncSessionLocal() as s:
        outbox.enqueue(s, "sms:failed", {"to": "+905551112233", "order_id": marker})
        await s.commit()
    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)
    async with AsyncSessionLocal() as s:
        ev = (
            await s.execute(
                select(OutboxEvent).where(
                    OutboxEvent.payload["order_id"].as_integer() == marker
                )
            )
        ).scalars().first()
        assert ev.status == "PENDING"  # backoff'ta bekliyor
        assert ev.attempts == 1
        assert ev.next_attempt_at > _now()
        assert "SMS sağlayıcısı" in (ev.last_error or "")
        # Zamanı öne çekip yeniden dene → SENT.
        ev.next_attempt_at = _now() - datetime.timedelta(seconds=1)
        await s.commit()
    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)
    async with AsyncSessionLocal() as s:
        ev = (
            await s.execute(
                select(OutboxEvent).where(
                    OutboxEvent.payload["order_id"].as_integer() == marker
                )
            )
        ).scalars().first()
        assert ev.status == "SENT"
        assert ev.attempts == 2


# ── 2) Watchdog ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_watchdog_expires_stale_active_run(p1):
    stale_start = _now() - datetime.timedelta(hours=settings.DELIVERY_STALE_RUN_HOURS + 6)
    run_id = await p1.run(status="ACTIVE", started_at=stale_start)
    order_id, stop_id = await p1.order_with_stop(run_id, order_status="SHIPPED")

    async with AsyncSessionLocal() as s:
        closed = await delivery_service.expire_stale_runs(s)
    assert closed >= 1

    async with AsyncSessionLocal() as s:
        run = await s.get(DeliveryRun, run_id)
        stop = await s.get(DeliveryStop, stop_id)
        order = await s.get(Order, order_id)
        assert run.status == "CANCELLED"
        assert "Watchdog" in (run.notes or "")
        assert stop.status == "FAILED"
        assert order.status == "PAID"
        assert order.tracking_no is None
        # SMS outbox'a yazıldı (worker gönderecek).
        ev = (
            await s.execute(
                select(OutboxEvent).where(
                    OutboxEvent.kind == "sms:failed",
                    OutboxEvent.payload["order_id"].as_integer() == order_id,
                )
            )
        ).scalars().first()
        assert ev is not None


# ── 3) ETA kaydırma / drift ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_start_run_shifts_stale_etas(p1):
    optimized = _now() - datetime.timedelta(hours=2)
    run_id = await p1.run(status="PLANNED", optimized_at=optimized)
    _order, stop_id = await p1.order_with_stop(
        run_id, eta=optimized + datetime.timedelta(minutes=30)
    )

    async with AsyncSessionLocal() as s:
        out = await delivery_service.start_run(s, run_id)
    assert out.status == "ACTIVE"

    async with AsyncSessionLocal() as s:
        run = await s.get(DeliveryRun, run_id)
        stop = await s.get(DeliveryStop, stop_id)
        expected = run.started_at + datetime.timedelta(minutes=30)
        assert abs((stop.eta - expected).total_seconds()) < 5


@pytest.mark.asyncio
async def test_delivery_drift_shifts_remaining_etas(p1):
    run_id = await p1.run(status="ACTIVE", started_at=_now())
    # Kurye 1. durağa planlanandan 30 dk GEÇ vardı.
    _o1, stop1 = await p1.order_with_stop(
        run_id, order_status="SHIPPED", sequence=1, otp_code="123456",
        eta=_now() - datetime.timedelta(minutes=30),
    )
    eta2 = _now() + datetime.timedelta(minutes=30)
    _o2, stop2 = await p1.order_with_stop(
        run_id, order_status="SHIPPED", sequence=2, eta=eta2
    )

    async with AsyncSessionLocal() as s:
        await delivery_service.verify_delivery(s, stop1, code="123456")

    async with AsyncSessionLocal() as s:
        s2 = await s.get(DeliveryStop, stop2)
        expected = eta2 + datetime.timedelta(minutes=30)
        assert abs((s2.eta - expected).total_seconds()) < 90  # drift ± işlem süresi


# ── 4) Kapasite ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_day_promise_rolls_forward(p1, monkeypatch):
    monkeypatch.setattr(settings, "DELIVERY_DAILY_CAPACITY", 1)
    day = datetime.date(2032, 3, 2)  # Salı (uzak gelecek — dev verisiyle çakışmaz)
    run_id = await p1.run()  # order_with_stop için taşıyıcı tur
    await p1.order_with_stop(run_id, promised=day)  # günü dolduran söz

    async with AsyncSessionLocal() as s:
        got = await order_service._first_capacity_day(s, day)
    assert got == datetime.date(2032, 3, 3)  # Çarşamba — Salı dolu
