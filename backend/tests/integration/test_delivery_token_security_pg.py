"""Public takip token'ı güvenlik sınırları — GERÇEK Postgres (bkz. conftest).

Faz 0 bulguları G-1/G-2'nin regresyon kilidi (docs/arsiv/teslimat/teslimat-faz0-denetim-matrisi.md §6):
1) G-1 — PoD fotoğrafı public token projeksiyonunda ASLA dönmez; yalnız
   oturumlu (client_id doğrulamalı) yol döndürür. Token = SMS linki, sızabilir.
2) G-2 — public token'la bırakma tercihine (KAPIYA/KOMSUYA) yükseltme 403;
   zararsız tercih (BENI_ARA) ve oturumlu yol serbesttir.
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
from models.store import DeliveryPref, Order
from services import delivery_service, order_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class TokenFactory:
    """Teslim edilmiş/bekleyen sipariş senaryoları üretir; teardown fiziksel siler."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def delivered_order(self, *, photo_url: str) -> tuple[int, int, str]:
        """Fotoğraflı teslim edilmiş sipariş: (order_id, client_id, track_token)."""
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@toksec.test", hashed_password="x",
                first_name="Token", last_name="Testi", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status="DELIVERED", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Token Testi",
                ship_address="Test adres", ship_in_zone=True,
                tracking_no="ELDEN-TOKSEC",
            )
            s.add(order)
            await s.flush()
            from tests.integration.filo_yardim import arac_id

            run = DeliveryRun(
                run_date=datetime.date.today(),
                status="DONE",
                vehicle_id=await arac_id(),
            )
            s.add(run)
            await s.flush()
            stop = DeliveryStop(
                run_id=run.id, order_id=order.id, sequence=1,
                qr_token=delivery_service.new_qr_token(), status="DELIVERED",
                delivered_at=_now(), proof="PHOTO", photo_url=photo_url,
            )
            s.add(stop)
            await s.flush()
            ids = (order.id, client.id, order.track_token)
            self.client_ids.append(client.id)
            self.order_ids.append(order.id)
            self.run_ids.append(run.id)
            await s.commit()
        return ids

    async def paid_order(self) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@toksec.test", hashed_password="x",
                first_name="Token", last_name="Testi", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Token Testi",
                ship_address="Test adres", ship_in_zone=True,
            )
            s.add(order)
            await s.flush()
            order_id = order.id
            self.client_ids.append(client.id)
            self.order_ids.append(order_id)
            await s.commit()
        return order_id

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
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
async def tfactory(pg) -> TokenFactory:
    f = TokenFactory()
    yield f
    await f.cleanup()


# ── G-1: PoD fotoğrafı token'a sızmaz ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_public_token_pod_fotografi_dondurmez(tfactory):
    photo = "https://minio.test/pod/kapi-onu.jpg"
    order_id, client_id, token = await tfactory.delivered_order(photo_url=photo)

    async with AsyncSessionLocal() as s:
        public = await delivery_service.order_tracking(s, track_token=token)
    assert public.status == "DELIVERED"
    assert public.delivered_at is not None
    assert public.proof == "PHOTO"
    assert public.proof_photo_url is None, "PoD fotoğrafı public token'a sızmamalı"

    async with AsyncSessionLocal() as s:
        owned = await delivery_service.order_tracking(
            s, order_id=order_id, client_id=client_id
        )
    assert owned.proof_photo_url == photo, "Oturumlu sahip kanıt fotoğrafını görmeli"


# ── G-2: token'la bırakma tercihine yükseltme yasak ───────────────────────────


@pytest.mark.asyncio
async def test_public_token_drop_pref_403(tfactory):
    order_id = await tfactory.paid_order()

    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        with pytest.raises(HTTPException) as exc:
            await order_service.set_delivery_pref(
                s, order,
                pref=DeliveryPref.KAPIYA_BIRAK.value, note=None,
                from_public_token=True,
            )
        assert exc.value.status_code == 403

    # Zararsız tercih token'dan serbest (PDS token yetkisi: izleme+erteleme+beni-ara).
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        await order_service.set_delivery_pref(
            s, order, pref=DeliveryPref.BENI_ARA.value, note=None,
            from_public_token=True,
        )
        assert order.delivery_pref == DeliveryPref.BENI_ARA.value

    # Oturumlu yol bırakma tercihini seçebilir.
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, order_id)
        await order_service.set_delivery_pref(
            s, order, pref=DeliveryPref.KAPIYA_BIRAK.value, note=None,
        )
        assert order.delivery_pref == DeliveryPref.KAPIYA_BIRAK.value
