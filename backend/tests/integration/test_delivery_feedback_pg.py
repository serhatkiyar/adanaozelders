"""Teslimat değerlendirmesi (Faz 7) entegrasyon testleri — GERÇEK Postgres.

1) Yalnız DELIVERED sipariş değerlendirilir (PAID → 409).
2) 👎'de en az bir sorun kodu zorunlu (422).
3) Sipariş başına TEK değerlendirme (tekrar → 409); KPI sayımı doğru.
4) order_tracking DELIVERED'da can_feedback/feedback_given bayraklarını döndürür.
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
from schemas.delivery import DeliveryFeedbackIn
from services import delivery_feedback_service as dfs
from services import delivery_service
from tests.integration.filo_yardim import arac_id


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class FeedbackFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def order(
        self, *, status: str = "DELIVERED", with_delivered_stop: bool = False
    ) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@fb.test", hashed_password="x",
                first_name="Fb", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            self.client_ids.append(client.id)
            order = Order(
                client_id=client.id, status=status, payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Fb Testi",
                ship_phone="+905551112233", ship_address="Test adres",
                ship_in_zone=True,
                delivered_at=_now() if status == "DELIVERED" else None,
            )
            s.add(order)
            await s.flush()
            order_id = order.id
            self.order_ids.append(order_id)
            if with_delivered_stop:
                run = DeliveryRun(
                    run_date=datetime.date.today(), vehicle_id=await arac_id(),
                    status="DONE",
                )
                s.add(run)
                await s.flush()
                self.run_ids.append(run.id)
                s.add(
                    DeliveryStop(
                        run_id=run.id, order_id=order_id, sequence=1,
                        qr_token=delivery_service.new_qr_token(),
                        status="DELIVERED", delivered_at=_now(), proof="OTP",
                    )
                )
            await s.commit()
        return order_id

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            ids = {"ids": self.order_ids or [0]}
            await s.execute(
                text("DELETE FROM delivery_feedback WHERE order_id = ANY(:ids)"), ids
            )
            await s.execute(
                text("DELETE FROM delivery_stops WHERE order_id = ANY(:ids)"), ids
            )
            await s.execute(
                text("DELETE FROM delivery_runs WHERE id = ANY(:ids)"),
                {"ids": self.run_ids or [0]},
            )
            await s.execute(
                text("DELETE FROM order_status_history WHERE order_id = ANY(:ids)"), ids
            )
            await s.execute(text("DELETE FROM orders WHERE id = ANY(:ids)"), ids)
            await s.execute(
                text("DELETE FROM clients WHERE id = ANY(:ids)"),
                {"ids": self.client_ids or [0]},
            )
            await s.commit()


@pytest.fixture
async def fb(pg) -> FeedbackFactory:
    f = FeedbackFactory()
    yield f
    await f.cleanup()


async def _get_order(order_id: int) -> Order:
    async with AsyncSessionLocal() as s:
        return await s.get(Order, order_id)


@pytest.mark.asyncio
async def test_feedback_yalniz_delivered(fb: FeedbackFactory):
    order_id = await fb.order(status="PAID")
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        with pytest.raises(HTTPException) as exc:
            await dfs.create_feedback(
                s, order, DeliveryFeedbackIn(thumbs_up=True), source="CLIENT"
            )
        assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_thumbs_down_sorun_kodu_zorunlu(fb: FeedbackFactory):
    order_id = await fb.order()
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        with pytest.raises(HTTPException) as exc:
            await dfs.create_feedback(
                s, order, DeliveryFeedbackIn(thumbs_up=False), source="CLIENT"
            )
        assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_tek_degerlendirme_ve_kpi(fb: FeedbackFactory):
    down_id = await fb.order()
    up_id = await fb.order()
    since = _now() - datetime.timedelta(minutes=5)

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, down_id)
        out = await dfs.create_feedback(
            s,
            order,
            DeliveryFeedbackIn(
                thumbs_up=False,
                problem_codes=["GEC_TESLIMAT", "HASARLI_PAKET"],
                comment="Kutu ezikti",
            ),
            source="PUBLIC",
        )
        assert out.thumbs_up is False
        assert out.source == "PUBLIC"

        # Tekrar → 409 (sipariş başına tek).
        with pytest.raises(HTTPException) as exc:
            await dfs.create_feedback(
                s, order, DeliveryFeedbackIn(thumbs_up=True), source="CLIENT"
            )
        assert exc.value.status_code == 409

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, up_id)
        # 👍'de yanlışlıkla işaretlenen sorun kodları taşınmaz.
        out = await dfs.create_feedback(
            s,
            order,
            DeliveryFeedbackIn(thumbs_up=True, problem_codes=["DIGER"]),
            source="CLIENT",
        )
        assert out.problem_codes == []

    async with AsyncSessionLocal() as s:
        up, down, problems = await dfs.kpi_counts(s, since)
        assert (up, down) == (1, 1)
        assert problems == {"GEC_TESLIMAT": 1, "HASARLI_PAKET": 1}


@pytest.mark.asyncio
async def test_tracking_feedback_bayraklari(fb: FeedbackFactory):
    order_id = await fb.order(with_delivered_stop=True)
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        tracking = await delivery_service.order_tracking(
            s, order_id=order_id, client_id=order.client_id
        )
        assert tracking.status == "DELIVERED"
        assert tracking.can_feedback is True
        assert tracking.feedback_given is False

        await dfs.create_feedback(
            s, order, DeliveryFeedbackIn(thumbs_up=True), source="CLIENT"
        )
        tracking = await delivery_service.order_tracking(
            s, order_id=order_id, client_id=order.client_id
        )
        assert tracking.can_feedback is False
        assert tracking.feedback_given is True
