"""Kapasiteli söz — atomik rezervasyon + retry önceliği (Faz 1) — GERÇEK Postgres.

1) Eşzamanlı iki ödeme son kapasite slotuna yarışırsa advisory kilit serileştirir:
   ikisi AYNI güne söz alamaz (overbooking yok).
2) Kurye kaynaklı FAILED: söz ertesi çalışma gününe kapasite kontrolsüz yazılır
   (retry önceliği — söz borcu yeni satıştan önce) ve failed_delivery_count artar.
"""
from __future__ import annotations

import asyncio
import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.store import Order
from services import delivery_promise, delivery_service, order_service
from tests.integration.filo_yardim import arac_id


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class CapacityFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def _client(self, s) -> Client:
        u = _uniq()
        client = Client(
            email=f"c-{u}@cap.test", hashed_password="x",
            first_name="Kapasite", last_name="Testi", username=f"c{u}", role_id=3,
        )
        s.add(client)
        await s.flush()
        self.client_ids.append(client.id)
        return client

    async def reserve_and_insert(self, paid_at: datetime.datetime) -> datetime.date:
        """Üretimdeki _finalize_paid dizisinin çekirdeği: kilit → sayım → atama →
        satır ekleme → commit. İki eşzamanlı çağrı yarış penceresini dener."""
        async with AsyncSessionLocal() as s:
            await order_service._lock_promise_counter(s)
            day = await order_service.promised_date_for(s, paid_at)
            client = await self._client(s)
            order = Order(
                client_id=client.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Kapasite Testi",
                ship_address="Test adres", ship_in_zone=True,
                promised_delivery_date=day,
            )
            s.add(order)
            await s.flush()
            self.order_ids.append(order.id)
            await s.commit()
        return day

    async def shipped_order_with_stop(self) -> tuple[int, int]:
        async with AsyncSessionLocal() as s:
            client = await self._client(s)
            order = Order(
                client_id=client.id, status="SHIPPED", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Kapasite Testi",
                ship_address="Test adres", ship_in_zone=True,
                tracking_no="ELDEN-CAPTEST",
            )
            s.add(order)
            await s.flush()
            run = DeliveryRun(
                run_date=datetime.date.today(), status="ACTIVE",
                vehicle_id=await arac_id(),
            )
            s.add(run)
            await s.flush()
            stop = DeliveryStop(
                run_id=run.id, order_id=order.id, sequence=1,
                qr_token=delivery_service.new_qr_token(), status="PENDING",
            )
            s.add(stop)
            await s.flush()
            ids = (order.id, stop.id)
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
async def cfactory(pg) -> CapacityFactory:
    f = CapacityFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_eszamanli_odeme_son_slota_overbooking_yapamaz(cfactory, monkeypatch):
    """Kapasite = mevcut doluluk + 1: yarışan iki rezervasyondan yalnız biri
    aday günü alır, diğeri sonraki çalışma gününe düşer."""
    paid_at = _now()
    # Aday günü ve o günün MEVCUT doluluğunu öğren (dev DB'de gerçek sipariş olabilir).
    async with AsyncSessionLocal() as s:
        candidate = delivery_promise.compute_promised_date(
            paid_at,
            cutoff_hour=settings.DELIVERY_CUTOFF_HOUR,
            non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
            utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
        )
        booked_now = (
            await s.execute(
                text(
                    "SELECT count(*) FROM orders WHERE deleted_at IS NULL "
                    "AND has_physical AND ship_in_zone "
                    "AND status IN ('PAID','SHIPPED') "
                    "AND promised_delivery_date = :d"
                ),
                {"d": candidate},
            )
        ).scalar_one()
    monkeypatch.setattr(settings, "DELIVERY_DAILY_CAPACITY", int(booked_now) + 1)

    day1, day2 = await asyncio.gather(
        cfactory.reserve_and_insert(paid_at),
        cfactory.reserve_and_insert(paid_at),
    )
    assert {day1, day2} != {candidate}, "İki sipariş aynı son slota söz almamalı"
    assert candidate in (day1, day2), "Slotlardan biri aday güne verilmeli"
    assert day1 != day2


@pytest.mark.asyncio
async def test_capacity_overview_booked_ve_retry_sayar(cfactory):
    """Kapasite şeridi: eklenen siparişler booked'a, başarısız denemeli olan
    retry_debt'e yansır (dev DB'de başka sipariş olabilir → delta ile ölçülür)."""
    target = delivery_promise.next_delivery_day(
        _now(),
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
    )

    async def snapshot() -> tuple[int, int]:
        async with AsyncSessionLocal() as s:
            rows = await delivery_service.capacity_overview(s, days=14)
        row = next(r for r in rows if r.day == target)
        return row.booked, row.retry_debt

    booked0, retry0 = await snapshot()

    async with AsyncSessionLocal() as s:
        for failed in (0, 1):
            u = _uniq()
            client = Client(
                email=f"c-{u}@cap.test", hashed_password="x",
                first_name="Kapasite", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            cfactory.client_ids.append(client.id)
            order = Order(
                client_id=client.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Kapasite Testi",
                ship_address="Test adres", ship_in_zone=True,
                promised_delivery_date=target, failed_delivery_count=failed,
            )
            s.add(order)
            await s.flush()
            cfactory.order_ids.append(order.id)
        await s.commit()

    booked1, retry1 = await snapshot()
    assert booked1 - booked0 == 2
    assert retry1 - retry0 == 1


@pytest.mark.asyncio
async def test_failed_durak_retry_onceligi_ve_sayac(cfactory):
    """fail_stop: söz ertesi çalışma gününe (kapasiteden bağımsız) yazılır,
    failed_delivery_count artar, sipariş PAID'e döner."""
    order_id, stop_id = await cfactory.shipped_order_with_stop()

    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(s, stop_id, reason="Test: kapı açılmadı")

    expected = delivery_promise.next_delivery_day(
        _now(),
        non_working_weekdays=settings.DELIVERY_NON_WORKING_WEEKDAYS,
        utc_offset_hours=settings.APP_UTC_OFFSET_HOURS,
    )
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        assert order.status == "PAID"
        assert order.failed_delivery_count == 1
        assert order.promised_delivery_date == expected
