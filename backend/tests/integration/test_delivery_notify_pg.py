""""Kuryen yaklaşıyor" bildirimi — GERÇEK Postgres (bkz. conftest.py başlığı).

Bir durak teslim edilince sıradaki DELIVERY_NEXT_NOTIFY_COUNT durağın müşterisine
TEK SEFERLİK bildirim gider (approach_notified_at damgası); ikinci tetikte
damgalılar atlanır.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.notification import Notification
from models.store import Order
from services import delivery_service
from tests.integration.filo_yardim import arac_id


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class NotifyFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def active_run_with_stops(self, n: int) -> tuple[int, list[int]]:
        """ACTIVE tur + n adet PENDING durak (sequence 1..n). (run_id, stop_ids)."""
        async with AsyncSessionLocal() as s:
            run = DeliveryRun(
                run_date=datetime.date.today(), vehicle_id=await arac_id(),
                status="ACTIVE",
            )
            s.add(run)
            await s.flush()
            stop_ids: list[int] = []
            for i in range(n):
                u = _uniq()
                client = Client(
                    email=f"c-{u}@notify.test", hashed_password="x",
                    first_name="Yaklas", last_name=f"Testi{i}",
                    role_id=3,
                )
                s.add(client)
                await s.flush()
                order = Order(
                    client_id=client.id, status="SHIPPED", payment_status="PAID",
                    subtotal=Decimal("50.00"), total=Decimal("50.00"),
                    has_physical=True, ship_recipient=f"Test {i}",
                    ship_address="Adres", ship_in_zone=True,
                )
                s.add(order)
                await s.flush()
                stop = DeliveryStop(
                    run_id=run.id, order_id=order.id, sequence=i + 1,
                    qr_token=delivery_service.new_qr_token(), status="PENDING",
                )
                s.add(stop)
                await s.flush()
                stop_ids.append(stop.id)
                self.client_ids.append(client.id)
                self.order_ids.append(order.id)
            self.run_ids.append(run.id)
            rid = run.id
            await s.commit()
        return rid, stop_ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM delivery_stops WHERE run_id = ANY(:ids)"),
                {"ids": self.run_ids or [0]},
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
async def notify_factory(pg) -> NotifyFactory:
    f = NotifyFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_notify_upcoming_once(notify_factory: NotifyFactory):
    run_id, stop_ids = await notify_factory.active_run_with_stops(4)

    async with AsyncSessionLocal() as s:
        await delivery_service._notify_upcoming(s, run_id)

    async with AsyncSessionLocal() as s:
        stops = (
            (await s.execute(select(DeliveryStop).where(DeliveryStop.run_id == run_id)))
            .scalars()
            .all()
        )
        stamped = sorted(s2.sequence for s2 in stops if s2.approach_notified_at)
        assert stamped == [1, 2]  # yalnız sıradaki DELIVERY_NEXT_NOTIFY_COUNT (2)

        notif_count = len(
            (
                await s.execute(
                    select(Notification).where(
                        Notification.user_id.in_(notify_factory.client_ids),
                        Notification.role_id == 3,
                    )
                )
            ).scalars().all()
        )
        assert notif_count == 2

    # İkinci tetik: damgalılar atlanır — yeni bildirim ÜRETİLMEZ.
    async with AsyncSessionLocal() as s:
        await delivery_service._notify_upcoming(s, run_id)
    async with AsyncSessionLocal() as s:
        notif_count = len(
            (
                await s.execute(
                    select(Notification).where(
                        Notification.user_id.in_(notify_factory.client_ids),
                        Notification.role_id == 3,
                    )
                )
            ).scalars().all()
        )
        assert notif_count == 2

    # 1. durak teslim edilince 3. durak da damgalanır (pencere kayar).
    async with AsyncSessionLocal() as s:
        first = await s.get(DeliveryStop, stop_ids[0])
        first.status = "DELIVERED"
        await s.commit()
        await delivery_service._notify_upcoming(s, run_id)
    async with AsyncSessionLocal() as s:
        stops = (
            (await s.execute(select(DeliveryStop).where(DeliveryStop.run_id == run_id)))
            .scalars()
            .all()
        )
        stamped = sorted(s2.sequence for s2 in stops if s2.approach_notified_at)
        assert stamped == [1, 2, 3]
