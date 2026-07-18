"""Üç-deneme kuralı — istisna kuyruğu geçişi (Faz 5) — GERÇEK Postgres.

- Deneme hakkı dolan sipariş prep/eligible'dan düşer, attention_orders'a girer.
- retry_exhausted_order bir tur daha hak tanır → attention'dan çıkar, prep'e döner.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order
from services import delivery_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class AttemptFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []

    async def order(self, *, failed: int, prepared: bool) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            c = Client(
                email=f"c-{u}@att.test", hashed_password="x",
                first_name="Att", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(c)
            await s.flush()
            o = Order(
                client_id=c.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Att", ship_address="adres",
                ship_in_zone=True, failed_delivery_count=failed,
                prepared_at=_now() if prepared else None,
            )
            s.add(o)
            await s.flush()
            oid = o.id
            self.client_ids.append(c.id)
            self.order_ids.append(oid)
            await s.commit()
        return oid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)"),
                {"c": self.client_ids or [0]},
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
async def af(pg) -> AttemptFactory:
    f = AttemptFactory()
    yield f
    await f.cleanup()


async def _ids(fn) -> set[int]:
    async with AsyncSessionLocal() as s:
        rows = await fn(s)
    return {r.order_id for r in rows}


@pytest.mark.asyncio
async def test_tavan_siparis_attention_kuyrugunda(af):
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    exhausted = await af.order(failed=cap, prepared=False)
    normal = await af.order(failed=cap - 1, prepared=False)

    attention = await _ids(delivery_service.attention_orders)
    prep = await _ids(delivery_service.prep_queue)

    assert exhausted in attention
    assert exhausted not in prep  # otomatik kuyruklardan düştü
    assert normal in prep
    assert normal not in attention


@pytest.mark.asyncio
async def test_tavan_siparis_eligible_disinda(af):
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    exhausted = await af.order(failed=cap, prepared=True)  # hazır olsa bile
    assert exhausted not in await _ids(delivery_service.eligible_orders)


@pytest.mark.asyncio
async def test_retry_bir_tur_daha_hak_tanir(af):
    cap = settings.DELIVERY_MAX_DELIVERY_ATTEMPTS
    oid = await af.order(failed=cap, prepared=False)
    assert oid in await _ids(delivery_service.attention_orders)

    async with AsyncSessionLocal() as s:
        out = await delivery_service.retry_exhausted_order(s, oid)
    assert out.order_id == oid

    assert oid not in await _ids(delivery_service.attention_orders)
    assert oid in await _ids(delivery_service.prep_queue)  # yeniden hazırlanabilir

    # İkinci retry çağrısı 409 (artık deneme hakkı var).
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await delivery_service.retry_exhausted_order(s, oid)
        assert exc.value.status_code == 409
