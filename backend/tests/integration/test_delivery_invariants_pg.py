"""Teslimat invariant + yarış testleri — GERÇEK Postgres (bkz. conftest.py başlığı).

P0 seti:
1) İptal/iade, siparişin bekleyen durağını CANCELLED'a kapatır (order_fsm
   merkezinde) ve tek kaçak durak turun başlatılmasını BLOKLAMAZ.
2) Sipariş başına tek açık durak (uq_delivery_stop_open) ve gün+araç başına
   tek planlı tur (uq_delivery_run_planned) DB otoritesindedir.
3) postpone ↔ verify yarışı FOR UPDATE ile serileşir — teslim edilmiş sipariş
   ertelemeyle PAID'e GERİ SARILAMAZ (lost update kapalı).
"""
from __future__ import annotations

import asyncio
import datetime
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.store import Order
from schemas.delivery import DeliveryRunCreate
from services import delivery_service, order_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class DeliveryFactory:
    """Sipariş+tur+durak senaryoları üretir; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def _client(self, s) -> Client:
        u = _uniq()
        client = Client(
            email=f"c-{u}@delivery.test", hashed_password="x",
            first_name="Teslimat", last_name="Testi", username=f"c{u}", role_id=3,
        )
        s.add(client)
        await s.flush()
        self.client_ids.append(client.id)
        return client

    async def run(self, *, status: str = "PLANNED", vehicle: str = "LADA") -> int:
        async with AsyncSessionLocal() as s:
            run = DeliveryRun(
                run_date=datetime.date.today(), vehicle=vehicle, status=status
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
    ) -> tuple[int, int]:
        """(order_id, stop_id) döner. order_status=SHIPPED ise tracking_no dolu."""
        async with AsyncSessionLocal() as s:
            client = await self._client(s)
            order = Order(
                client_id=client.id, status=order_status, payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Teslimat Testi",
                ship_address="Test adres", ship_in_zone=True,
                prepared_at=_now(),
                tracking_no="ELDEN-TEST" if order_status == "SHIPPED" else None,
            )
            s.add(order)
            await s.flush()
            stop = DeliveryStop(
                run_id=run_id, order_id=order.id, sequence=sequence,
                qr_token=delivery_service.new_qr_token(), status="PENDING",
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
async def dfactory(pg) -> DeliveryFactory:
    f = DeliveryFactory()
    yield f
    await f.cleanup()


# ── 1) İptal/iade → açık durak temizliği + start_run savunması ────────────────────


@pytest.mark.asyncio
async def test_cancel_closes_stop_and_run_still_starts(dfactory, provider):
    run_id = await dfactory.run(status="PLANNED")
    order_a, stop_a = await dfactory.order_with_stop(run_id, sequence=1)
    order_b, stop_b = await dfactory.order_with_stop(run_id, sequence=2)

    # Müşteri A siparişini iptal eder (ödenmiş → sağlayıcı iadesi).
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, order_a)
        await order_service.cancel_by_client(s, order)

    async with AsyncSessionLocal() as s:
        stop = await s.get(DeliveryStop, stop_a)
        order = await s.get(Order, order_a)
        assert order.status == "CANCELLED"
        assert stop.status == "CANCELLED"  # FAILED değil — kurye metriğine sayılmaz

    # Kaçak durak turu BLOKLAMAZ: tur kalan durakla başlar.
    async with AsyncSessionLocal() as s:
        out = await delivery_service.start_run(s, run_id)
    assert out.status == "ACTIVE"
    async with AsyncSessionLocal() as s:
        b = await s.get(Order, order_b)
        sb = await s.get(DeliveryStop, stop_b)
        sa = await s.get(DeliveryStop, stop_a)
        assert b.status == "SHIPPED" and b.tracking_no
        assert sb.status == "PENDING"
        assert sa.status == "CANCELLED"


@pytest.mark.asyncio
async def test_refund_in_active_run_closes_stop(dfactory, provider):
    run_id = await dfactory.run(status="ACTIVE")
    order_id, stop_id = await dfactory.order_with_stop(run_id, order_status="SHIPPED")

    async with AsyncSessionLocal() as s:
        await order_service.refund_order(s, order_id)

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        stop = await s.get(DeliveryStop, stop_id)
        assert order.status == "REFUNDED"
        assert stop.status == "CANCELLED"


# ── 2) DB invariant'ları ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_second_open_stop_rejected_by_index(dfactory):
    run1 = await dfactory.run(status="PLANNED")
    order_id, _stop = await dfactory.order_with_stop(run1)
    run2 = await dfactory.run(status="PLANNED", vehicle="COROLLA")

    with pytest.raises(IntegrityError):
        async with AsyncSessionLocal() as s:
            s.add(
                DeliveryStop(
                    run_id=run2, order_id=order_id, sequence=1,
                    qr_token=delivery_service.new_qr_token(), status="PENDING",
                )
            )
            await s.commit()


@pytest.mark.asyncio
async def test_duplicate_planned_run_rejected(dfactory, pg):
    # Uzak bir tarih: dev verisiyle çakışmasın; her iki tur da temizlenir.
    day = datetime.date(2031, 3, 4)
    async with AsyncSessionLocal() as s:
        first = await delivery_service.create_run(
            s, DeliveryRunCreate(run_date=day, vehicle="LADA")
        )
        dfactory.run_ids.append(first.id)
        with pytest.raises(HTTPException) as exc:
            await delivery_service.create_run(
                s, DeliveryRunCreate(run_date=day, vehicle="LADA")
            )
        assert exc.value.status_code == 409


# ── 3) postpone ↔ verify yarışı ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_postpone_verify_race_single_winner(dfactory):
    run_id = await dfactory.run(status="ACTIVE")
    order_id, stop_id = await dfactory.order_with_stop(
        run_id, order_status="SHIPPED", otp_code="123456"
    )

    async def do_verify() -> str | None:
        async with AsyncSessionLocal() as s:
            try:
                await delivery_service.verify_delivery(s, stop_id, code="123456")
                return "verify"
            except HTTPException:
                return None

    async def do_postpone() -> str | None:
        async with AsyncSessionLocal() as s:
            order = await s.get(Order, order_id)
            try:
                await order_service.postpone_delivery(s, order)
                return "postpone"
            except HTTPException:
                return None

    results = await asyncio.gather(do_verify(), do_postpone())
    winners = [r for r in results if r is not None]
    assert len(winners) == 1, f"tam olarak biri kazanmalı: {results}"

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        stop = await s.get(DeliveryStop, stop_id)
        if winners[0] == "verify":
            # Teslim kazandı: erteleme DELIVERED'ı PAID'e GERİ SARAMAZ.
            assert order.status == "DELIVERED"
            assert stop.status == "DELIVERED"
            assert order.postpone_count == 0
        else:
            assert order.status == "PAID"
            assert stop.status == "RESCHEDULED"
            assert order.postpone_count == 1
