"""Cıncık Teslimat bölge kuyruğu — GERÇEK Postgres (bkz. conftest.py başlığı).

eligible_orders yalnız bölge-içi (ship_in_zone=True) ödenmiş fiziksel siparişleri,
söz verilen günü önde olacak şekilde sıralı döner; bölge-dışı/bilinmeyenler
outsourced_orders ("dış kargo bekliyor") kuyruğuna düşer.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order
from services import delivery_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class ZoneFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []

    async def order(
        self,
        *,
        in_zone: bool | None,
        promised: datetime.date | None = None,
        status: str = "PAID",
    ) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@zone.test", hashed_password="x",
                first_name="Bolge", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status=status, payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Bölge Testi",
                ship_address=f"Test adres {u}", ship_in_zone=in_zone,
                promised_delivery_date=promised,
            )
            s.add(order)
            await s.flush()
            self.client_ids.append(client.id)
            self.order_ids.append(order.id)
            oid = order.id
            await s.commit()
        return oid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
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
async def zone_factory(pg) -> ZoneFactory:
    f = ZoneFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_zone_split_and_promise_order(zone_factory: ZoneFactory):
    today = datetime.date(2026, 7, 10)
    id_in_late = await zone_factory.order(
        in_zone=True, promised=today + datetime.timedelta(days=1)
    )
    id_in_urgent = await zone_factory.order(in_zone=True, promised=today)
    id_out = await zone_factory.order(in_zone=False)
    id_unknown = await zone_factory.order(in_zone=None)

    async with AsyncSessionLocal() as s:
        eligible = await delivery_service.eligible_orders(s)
        outsourced = await delivery_service.outsourced_orders(s)

    ours = [o for o in eligible if o.order_id in zone_factory.order_ids]
    assert [o.order_id for o in ours] == [id_in_urgent, id_in_late]
    assert all(o.in_zone is True for o in ours)
    assert ours[0].promised_delivery_date == today

    out_ids = {o.order_id for o in outsourced if o.order_id in zone_factory.order_ids}
    # Bölge dışı VE bölgesi belirlenemeyen (None) birlikte dış-kargo kuyruğunda.
    assert out_ids == {id_out, id_unknown}


@pytest.mark.asyncio
async def test_non_paid_orders_in_neither_queue(zone_factory: ZoneFactory):
    oid = await zone_factory.order(in_zone=True, status="SHIPPED")
    async with AsyncSessionLocal() as s:
        eligible = await delivery_service.eligible_orders(s)
        outsourced = await delivery_service.outsourced_orders(s)
    assert oid not in {o.order_id for o in eligible}
    assert oid not in {o.order_id for o in outsourced}
