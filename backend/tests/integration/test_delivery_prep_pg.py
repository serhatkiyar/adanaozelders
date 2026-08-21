"""Hazırlama istasyonu kapısı (Faz 2, PDS O1) — GERÇEK Postgres.

- Hazırlanmamış sipariş prep_queue'da; eligible_orders'ta DEĞİL.
- **Paket tamamlanınca** eligible'a geçer, prep_queue'dan düşer.
- add_stops hazırlanmamış siparişi 409 ile reddeder.
- fail_stop hazırlığı sıfırlar (paket depoya döner).

> **F30 commit 5 güncellemesi.** Bu dosya eskiden `delivery_service.mark_prepared`
> ile hazırlıyordu; o iş mantığı ve uçları **kaldırıldı** (sözleşme §3.5, boşluk
> G1: iki kapı bırakmak "eksik kalem kabul edilmez" ilkesini boşa çıkarır).
> Hazırlama artık YALNIZ paketleme akışıyla olur: `open_package` → `scan` →
> `complete`. Dosyanın ölçtüğü KUYRUK davranışı aynen korundu; yalnız siparişi
> hazır hâle getiren yol değişti. Paket gerektiren düğümler `PaketFabrikasi`
> kullanır (gerçek ürün + SKU + kalem), gerektirmeyenler eski hafif fabrikada
> kalır.
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
from models.delivery import DeliveryRun
from models.store import Order
from services import delivery_service
from tests.integration.filo_yardim import arac_id


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class PrepFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def paid_order(self, *, prepared: bool = False) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@prep.test", hashed_password="x",
                first_name="Prep", last_name="Testi", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Prep Testi",
                ship_address="Test adres", ship_in_zone=True,
                ship_lat=Decimal("37.00"), ship_lng=Decimal("35.32"),
                prepared_at=_now() if prepared else None,
            )
            s.add(order)
            await s.flush()
            oid = order.id
            self.client_ids.append(client.id)
            self.order_ids.append(oid)
            await s.commit()
        return oid

    async def run(self) -> int:
        async with AsyncSessionLocal() as s:
            run = DeliveryRun(
                run_date=datetime.date.today(), status="PLANNED",
                vehicle_id=await arac_id(),
            )
            s.add(run)
            await s.flush()
            rid = run.id
            self.run_ids.append(rid)
            await s.commit()
        return rid

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            for q, _p in [
                ("DELETE FROM delivery_stops WHERE order_id = ANY(:ids)", "order_ids"),
                ("DELETE FROM delivery_runs WHERE id = ANY(:runs)", "run_ids"),
                ("DELETE FROM order_status_history WHERE order_id = ANY(:ids)", "order_ids"),
                ("DELETE FROM orders WHERE id = ANY(:ids)", "order_ids"),
                ("DELETE FROM clients WHERE id = ANY(:cids)", "client_ids"),
            ]:
                await s.execute(
                    text(q),
                    {
                        "ids": self.order_ids or [0],
                        "runs": self.run_ids or [0],
                        "cids": self.client_ids or [0],
                    },
                )
            await s.commit()


@pytest.fixture
async def pf(pg) -> PrepFactory:
    f = PrepFactory()
    yield f
    await f.cleanup()


async def _ids(fn) -> set[int]:
    async with AsyncSessionLocal() as s:
        rows = await fn(s)
    return {r.order_id for r in rows}


@pytest.mark.asyncio
async def test_hazirlanmamis_prep_queuede_eligible_disinda(pf):
    oid = await pf.paid_order(prepared=False)
    assert oid in await _ids(delivery_service.prep_queue)
    assert oid not in await _ids(delivery_service.eligible_orders)


@pytest.fixture
async def paket_fab(pg):
    """Gerçek ürün + kalem üreten F30 fabrikası (paketleme akışı için)."""
    from tests.integration.f30_factory import PaketFabrikasi

    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _paketle(fab) -> int:
    """Sipariş → paket aç → tara → tamamla. Hazırlamanın TEK yolu (F30 §3.5)."""
    from services import packing_service

    aid = await fab.admin()
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    async with AsyncSessionLocal() as s:
        paket = await packing_service.open_package(s, oid, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await packing_service.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        await packing_service.complete(s, paket.id, admin_id=aid)
    return oid


@pytest.mark.asyncio
async def test_PAKET_TAMAMLANINCA_eligible_olur(paket_fab):
    """Eskiden `mark_prepared` yapıyordu; artık paketin tamamlanması yapıyor.

    Ölçülen davranış AYNI: sipariş `prep_queue`'dan düşer, `eligible_orders`'a
    girer. Değişen tek şey damgayı kimin koyduğu — ve artık damga kalem kalem
    doğrulanmış bir paketten geliyor (boşluk G1).
    """
    oid = await _paketle(paket_fab)
    assert await paket_fab.prepared_at(oid) is not None
    assert oid in await _ids(delivery_service.eligible_orders)
    assert oid not in await _ids(delivery_service.prep_queue)


@pytest.mark.asyncio
async def test_add_stops_hazirlanmamisi_reddeder(pf):
    oid = await pf.paid_order(prepared=False)
    run_id = await pf.run()
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await delivery_service.add_stops(s, run_id, [oid])
        assert exc.value.status_code == 409
        assert "hazırlan" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_PAKETLENMIS_SIPARIS_TURA_EKLENEBILIR(paket_fab):
    """Ters prova: kapı yalnız hazırlanmamışı reddetmeli, her siparişi değil."""
    oid = await _paketle(paket_fab)
    run_id = await paket_fab.tur()
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_id, [oid])
    # Taze session'dan doğrula (aynı session'da get_run identity-map'ten stale
    # koleksiyon dönebilir; gerçek uygulamada her istek ayrı session).
    async with AsyncSessionLocal() as s:
        count = (
            await s.execute(
                text(
                    "SELECT count(*) FROM delivery_stops "
                    "WHERE order_id = :o AND run_id = :r"
                ),
                {"o": oid, "r": run_id},
            )
        ).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_fail_stop_hazirligi_sifirlar(pf):
    """Teslim başarısız → sipariş PAID'e döner, prepared_at düşer (paket depoya)."""
    oid = await pf.paid_order(prepared=True)
    run_id = await pf.run()
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_id, [oid])
        await delivery_service.start_run(s, run_id)
    async with AsyncSessionLocal() as s:
        stop = (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"), {"o": oid}
            )
        ).scalar_one()
        await delivery_service.fail_stop(s, stop, reason="Test: ulaşılamadı")
    async with AsyncSessionLocal() as s:
        order = await s.get(Order, oid)
        assert order.status == "PAID"
        assert order.prepared_at is None
    # Yeniden prep_queue'da (hazırlanmamış).
    assert oid in await _ids(delivery_service.prep_queue)
