"""Sipariş kalemlerinin dağıtım kuyruklarına taşınması (F26) — GERÇEK Postgres.

Kullanıcının bildirdiği hata: hazırlama havuzu yalnız "N parça · ₺X" gösteriyor,
operatör NE toplayacağını hiçbir admin yüzeyinden göremiyor.

Buradaki iki soru:
1. Kalemler doğru **projekte** ediliyor mu (adet, çok satır, dijital hariç)?
2. Bu bilgi **ek sorgu maliyeti olmadan** mı geliyor? `item_count` zaten
   `o.items`'tan hesaplandığı için koleksiyon yüklüydü; kalem listesi bedava
   gelmeli. Test sorgu sayısını SAYARAK bunu kanıtlıyor — aksi halde 40 sipariş
   40 ek SELECT üretir ve fark yalnız sahada anlaşılır.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import event, text

from core.database import AsyncSessionLocal, engine
from models.client import Client
from models.store import Order, OrderItem
from services import delivery_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class _ItemFactory:
    def __init__(self) -> None:
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []

    async def order(self, items: list[tuple[str, int, str]]) -> int:
        """`items`: (başlık, adet, kind) — kind 'PHYSICAL' | 'DIGITAL'."""
        async with AsyncSessionLocal() as s:
            u = _uniq()
            c = Client(
                email=f"f26-{u}@items.test", hashed_password="x",
                first_name="Kalem", last_name="Testi", role_id=3,
            )
            s.add(c)
            await s.flush()
            o = Order(
                client_id=c.id, status="PAID", payment_status="PAID",
                subtotal=Decimal("100.00"), total=Decimal("100.00"),
                has_physical=True, ship_recipient="Kalem Testi",
                ship_address="Test adres", ship_in_zone=True,
                ship_lat=Decimal("37.0"), ship_lng=Decimal("35.32"),
                prepared_at=datetime.datetime.now(datetime.timezone.utc),
            )
            s.add(o)
            await s.flush()
            for title, qty, kind in items:
                s.add(
                    OrderItem(
                        order_id=o.id, title=title, unit_price=Decimal("50.00"),
                        quantity=qty, kind=kind, seller_type="PLATFORM",
                    )
                )
            await s.commit()
            self.client_ids.append(c.id)
            self.order_ids.append(o.id)
            return o.id

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            p = {"ids": self.order_ids or [0], "cids": self.client_ids or [0]}
            for q in (
                "DELETE FROM delivery_stops WHERE order_id = ANY(:ids)",
                "DELETE FROM order_items WHERE order_id = ANY(:ids)",
                "DELETE FROM order_status_history WHERE order_id = ANY(:ids)",
                "DELETE FROM orders WHERE id = ANY(:ids)",
                "DELETE FROM clients WHERE id = ANY(:cids)",
            ):
                await s.execute(text(q), p)
            await s.commit()


@pytest.fixture
async def items_factory(pg):
    f = _ItemFactory()
    yield f
    await f.cleanup()


def _find(rows, order_id: int):
    return next((r for r in rows if r.order_id == order_id), None)


@pytest.mark.asyncio
async def test_kalemler_baslik_ve_adetle_doner(items_factory):
    """Tek ürün, çok ürün ve aynı üründen çok adet — üçü de doğru projekte."""
    tek = await items_factory.order([("TYT Matematik Soru Bankası", 1, "PHYSICAL")])
    cok = await items_factory.order(
        [
            ("AYT Fizik Konu Anlatımı", 1, "PHYSICAL"),
            ("Paragraf Denemeleri 40'lı", 3, "PHYSICAL"),
        ]
    )
    coklu_adet = await items_factory.order([("TYT Türkçe Video Defteri", 4, "PHYSICAL")])

    async with AsyncSessionLocal() as s:
        rows = await delivery_service.eligible_orders(s)

    r = _find(rows, tek)
    assert r is not None
    assert [(i.title, i.quantity) for i in r.items] == [
        ("TYT Matematik Soru Bankası", 1)
    ]
    assert r.item_count == 1

    r = _find(rows, cok)
    assert {(i.title, i.quantity) for i in r.items} == {
        ("AYT Fizik Konu Anlatımı", 1),
        ("Paragraf Denemeleri 40'lı", 3),
    }
    # "N parça" özeti kalem listesiyle tutarlı olmalı (biri diğerinin yerine geçmez).
    assert r.item_count == 4

    r = _find(rows, coklu_adet)
    assert [(i.title, i.quantity) for i in r.items] == [("TYT Türkçe Video Defteri", 4)]
    assert r.item_count == 4


@pytest.mark.asyncio
async def test_dijital_kalem_pakete_girmez(items_factory):
    """Dijital ürün kutuya konmaz; toplama listesinde görünmemeli."""
    oid = await items_factory.order(
        [
            ("Fizik Formül Kitabı", 2, "PHYSICAL"),
            ("Eğitmen PDF Ders Notu", 1, "DIGITAL"),
        ]
    )
    async with AsyncSessionLocal() as s:
        rows = await delivery_service.eligible_orders(s)
    r = _find(rows, oid)
    assert [i.title for i in r.items] == ["Fizik Formül Kitabı"]
    assert r.item_count == 2


@pytest.mark.asyncio
async def test_kalemsiz_legacy_siparis_patlamaz(items_factory):
    """Eski/bozuk veri: `order_items` satırı yok. Boş liste dönmeli, hata değil.

    Yüzey bu durumda "kalem bilgisi yok" demek zorundadır — sessiz boşluk
    "toplanacak bir şey yok" diye okunur.
    """
    oid = await items_factory.order([])
    async with AsyncSessionLocal() as s:
        rows = await delivery_service.eligible_orders(s)
    r = _find(rows, oid)
    assert r is not None
    assert r.items == []
    assert r.item_count == 0


@pytest.mark.asyncio
async def test_kalemler_EK_SORGU_maliyeti_olmadan_gelir(items_factory):
    """N+1 nöbetçisi: kalem sayısı sorgu sayısını ARTIRMAMALI.

    `item_count` zaten `o.items`'tan hesaplanıyordu, yani koleksiyon yüklüydü;
    listeyi eklemek bedava olmalı. Bu test 1 siparişlik ve 5 siparişlik koşumun
    AYNI sayıda sorgu attığını doğrular.
    """
    counter = {"n": 0}

    def _count(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        if statement.lstrip().upper().startswith("SELECT"):
            counter["n"] += 1

    async def _measure() -> int:
        counter["n"] = 0
        event.listen(engine.sync_engine, "before_cursor_execute", _count)
        try:
            async with AsyncSessionLocal() as s:
                rows = await delivery_service.eligible_orders(s)
                # Kalemlere DOKUN: lazy yükleme varsa burada tetiklenir.
                for r in rows:
                    _ = [(i.title, i.quantity) for i in r.items]
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", _count)
        return counter["n"]

    await items_factory.order([("Kitap A", 1, "PHYSICAL")])
    tek_siparis = await _measure()

    for i in range(4):
        await items_factory.order([(f"Kitap {i}", i + 1, "PHYSICAL")])
    bes_siparis = await _measure()

    assert bes_siparis == tek_siparis, (
        f"kalem listesi N+1 üretiyor: 1 sipariş {tek_siparis} sorgu, "
        f"5 sipariş {bes_siparis} sorgu"
    )
