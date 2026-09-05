"""Erteleme (postpone) akışı — GERÇEK Postgres (bkz. conftest.py başlığı).

ACTIVE turda erteleme: durak RESCHEDULED + sipariş SHIPPED→PAID geri sarımı +
tracking_no temizliği + sipariş yeniden eligible (RESCHEDULED "açık durak"
sayılmaz). Erteleme sınırı POSTPONE_LIMIT'te 409'lar.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.store import Order
from services import delivery_service, order_service
from tests.integration.filo_yardim import arac_id


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class PostponeFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def order_in_active_run(self) -> tuple[int, int]:
        """SHIPPED sipariş + ACTIVE turda PENDING durak. (order_id, stop_id) döner."""
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@postpone.test", hashed_password="x",
                first_name="Ertele", last_name="Testi", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status="SHIPPED", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Ertele Testi",
                ship_address="Test adres", ship_in_zone=True,
                # Turdaki sipariş hazırlanmıştır; müşteri ertelemesi (RESCHEDULED)
                # paketi depoya döndürmez → hazırlık korunur, yeniden eligible olur.
                prepared_at=datetime.datetime.now(datetime.timezone.utc),
                tracking_no="ELDEN-TEST",
            )
            run = DeliveryRun(
                run_date=datetime.date.today(), vehicle_id=await arac_id(), status="ACTIVE"
            )
            s.add_all([order, run])
            await s.flush()
            stop = DeliveryStop(
                run_id=run.id, order_id=order.id, sequence=1,
                qr_token=delivery_service.new_qr_token(), status="PENDING",
            )
            s.add(stop)
            await s.flush()
            ids = (order.id, stop.id)
            self.client_ids.append(client.id)
            self.order_ids.append(order.id)
            self.run_ids.append(run.id)
            await s.commit()
        return ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
            )
            await s.execute(
                text(
                    "DELETE FROM outbox_events "
                    "WHERE (payload->>'order_id')::int = ANY(:ids)"
                ),
                {"ids": self.order_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM delivery_stops WHERE order_id = ANY(:ids)"),
                {"ids": self.order_ids or [0]},
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
async def postpone_factory(pg) -> PostponeFactory:
    f = PostponeFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_postpone_in_active_run_rewinds_and_requeues(
    postpone_factory: PostponeFactory,
):
    order_id, stop_id = await postpone_factory.order_in_active_run()

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        await order_service.postpone_delivery(s, order)

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        stop = await s.get(DeliveryStop, stop_id)
        assert stop.status == "RESCHEDULED"
        assert order.status == "PAID"
        assert order.tracking_no is None
        assert order.postpone_count == 1
        assert order.promised_delivery_date > datetime.date.today()

        # RESCHEDULED "açık durak" sayılmaz → sipariş yeniden eligible.
        eligible = await delivery_service.eligible_orders(s)
        assert order_id in {o.order_id for o in eligible}

        # Takip durumu müşteri kopyasında POSTPONED.
        tracking = await delivery_service.order_tracking(s, track_token=order.track_token)
        assert tracking.status == "POSTPONED"
        assert any(e.code == "POSTPONED" for e in tracking.timeline)


@pytest.mark.asyncio
async def test_postpone_limit_enforced(postpone_factory: PostponeFactory):
    order_id, _ = await postpone_factory.order_in_active_run()
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        order.postpone_count = order_service.POSTPONE_LIMIT
        await s.commit()

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        with pytest.raises(HTTPException) as exc:
            await order_service.postpone_delivery(s, order)
        assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_komsuya_pref_requires_note(postpone_factory: PostponeFactory):
    order_id, _ = await postpone_factory.order_in_active_run()
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        with pytest.raises(HTTPException) as exc:
            await order_service.set_delivery_pref(
                s, order, pref="KOMSUYA_BIRAK", note=None
            )
        assert exc.value.status_code == 422

        await order_service.set_delivery_pref(
            s, order, pref="KOMSUYA_BIRAK", note="Ayşe Hn. D:4"
        )
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        assert order.delivery_pref == "KOMSUYA_BIRAK"
        assert order.delivery_pref_note == "Ayşe Hn. D:4"
