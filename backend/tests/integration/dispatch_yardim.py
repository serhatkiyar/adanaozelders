"""`dispatch_day` testleri için ortak fixture altyapısı.

Buradaki iki sınıf `test_delivery_dispatch_live_pg.py` içinde doğmuştu; bağımsız
denetimin B-2 bulgusu için VROOM'suz da koşan bir ikinci dosya gerekince
kopyalanmak yerine buraya taşındı — kopyalanan iki fixture'ın zamanla ayrışması
bu paketin düzeltmeye çalıştığı hata sınıfının ta kendisi.

`DispatchFactory` testin kendi ödenmiş fiziksel siparişlerini üretir ve
teardown'da FİZİKSEL siler. `EligibleParking` ise dev veritabanındaki YABANCI
uygun siparişleri test süresince kuyruk dışına alır: `dispatch_day` tasarımı
gereği sistem genelinde çalışır, tarihle izole edilemez (filtre
`promised_delivery_date <= gun`), o yüzden veri silmek yerine "park edilir" —
geçici bir PLANNED tura durak olarak bağlanır, teardown'da o tur ve durakları
fiziksel silinir. Hiçbir üretim verisi değişmez.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order
from tests.integration.db_guard import assert_test_database

# Adana merkezde gerçek mahalle ölçeğinde dağılmış teslimat noktaları.
ADRESLER = [
    (37.0025, 35.3210), (36.9760, 35.3400), (37.0140, 35.3050),
    (36.9900, 35.3600), (37.0300, 35.3300), (36.9650, 35.3100),
    (37.0080, 35.3480), (36.9820, 35.2950), (37.0200, 35.3620),
    (36.9700, 35.3520), (37.0350, 35.3150), (36.9950, 35.2880),
    (37.0120, 35.3700), (36.9600, 35.3350), (37.0260, 35.2980),
]


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def gelecek_gun() -> datetime.date:
    """Mevcut PLANNED turlarla (varsa gerçek veri) çakışmayan bir gün."""
    return datetime.date.today() + datetime.timedelta(days=400)


class DispatchFactory:
    """Testin kendi siparişleri — teardown'da FİZİKSEL silinir."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def orders(self, n: int) -> list[int]:
        ids: list[int] = []
        async with AsyncSessionLocal() as s:
            for i in range(n):
                u = uniq()
                client = Client(
                    email=f"c-{u}@dispatch.test", hashed_password="x",
                    first_name="Dagitim", last_name=f"Musteri{i}",
                    username=f"c{u}", role_id=3,
                )
                s.add(client)
                await s.flush()
                lat, lng = ADRESLER[i % len(ADRESLER)]
                order = Order(
                    client_id=client.id, status="PAID", payment_status="PAID",
                    subtotal=Decimal("100.00"), total=Decimal("100.00"),
                    has_physical=True, ship_recipient=f"Dagitim Musteri{i}",
                    ship_address=f"Test adres {i}", ship_in_zone=True,
                    ship_lat=Decimal(str(lat)), ship_lng=Decimal(str(lng)),
                    prepared_at=datetime.datetime.now(datetime.timezone.utc),
                )
                s.add(order)
                await s.flush()
                ids.append(order.id)
                self.client_ids.append(client.id)
                self.order_ids.append(order.id)
            await s.commit()
        return ids

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            params = {
                "ids": self.order_ids or [0],
                "runs": self.run_ids or [0],
                "cids": self.client_ids or [0],
            }
            for q in (
                "DELETE FROM delivery_stops WHERE order_id = ANY(:ids)",
                "DELETE FROM delivery_stops WHERE run_id = ANY(:runs)",
                "DELETE FROM delivery_runs WHERE id = ANY(:runs)",
                "DELETE FROM order_status_history WHERE order_id = ANY(:ids)",
                "DELETE FROM orders WHERE id = ANY(:ids)",
                "DELETE FROM clients WHERE id = ANY(:cids)",
            ):
                await s.execute(text(q), params)
            await s.commit()


class SeedFilosu:
    """Test süresince aktif filoyu migration seed'inin kendisine (LADA+COROLLA)
    indirger.

    Gerekçe: dev/test veritabanında elle eklenmiş araçlar (ör. tarayıcı kabul
    turundan kalan DOBLO/KANGOO) bölüşüm sayısını belirsizleştirir. Bu düzenek
    hiçbir aracı SİLMEZ, yalnız `is_active`'ini geçici olarak kapatır ve
    teardown'da aynen geri açar.
    """

    SEED_KODLARI = ("LADA", "COROLLA")

    def __init__(self) -> None:
        self.kapatilanlar: list[int] = []

    async def daralt(self) -> None:
        assert_test_database()
        async with AsyncSessionLocal() as s:
            self.kapatilanlar = list(
                (
                    await s.execute(
                        text(
                            "SELECT id FROM vehicles WHERE is_active IS TRUE "
                            "AND deleted_at IS NULL AND code <> ALL(:kod)"
                        ),
                        {"kod": list(self.SEED_KODLARI)},
                    )
                ).scalars()
            )
            if self.kapatilanlar:
                await s.execute(
                    text("UPDATE vehicles SET is_active = false WHERE id = ANY(:i)"),
                    {"i": self.kapatilanlar},
                )
            await s.commit()

    async def geri_al(self) -> None:
        if not self.kapatilanlar:
            return
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE vehicles SET is_active = true WHERE id = ANY(:i)"),
                {"i": self.kapatilanlar},
            )
            await s.commit()


class EligibleParking:
    """Test süresince yabancı uygun siparişleri kuyruk dışına alır."""

    def __init__(self) -> None:
        self.run_id: int | None = None
        self.stop_ids: list[int] = []

    async def park(self) -> int:
        # `pg` fixture'ı zaten kilitliyor; burada da doğrulanır çünkü park etmek
        # canlı dağıtım kuyruğunu geçici olarak değiştiren TEK test adımıdır.
        assert_test_database()
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        """
                        SELECT o.id FROM orders o
                        WHERE o.deleted_at IS NULL
                          AND o.payment_status = 'PAID'
                          AND o.has_physical IS TRUE
                          AND o.status IN ('PAID', 'SHIPPED')
                          AND NOT EXISTS (
                              SELECT 1 FROM delivery_stops ds
                              WHERE ds.order_id = o.id
                                AND ds.status IN ('PENDING', 'DELIVERED')
                          )
                        """
                    )
                )
            ).scalars().all()
            if not rows:
                return 0
            # Park turu testin kullandığı günden AYRI bir günde açılır: gün+araç
            # başına tek PLANNED tur kısıtı testin kendi turlarıyla çakışmasın.
            park_date = gelecek_gun() - datetime.timedelta(days=1)
            run_id = (
                await s.execute(
                    text(
                        """
                        INSERT INTO delivery_runs (run_date, vehicle_id, status)
                        VALUES (
                            :d,
                            (SELECT id FROM vehicles WHERE code = 'LADA'),
                            'PLANNED'
                        ) RETURNING id
                        """
                    ),
                    {"d": park_date},
                )
            ).scalar_one()
            self.run_id = run_id
            for i, oid in enumerate(rows, start=1):
                sid = (
                    await s.execute(
                        text(
                            """
                            INSERT INTO delivery_stops
                                (run_id, order_id, sequence, status, qr_token)
                            VALUES (:r, :o, :seq, 'PENDING', :tok) RETURNING id
                            """
                        ),
                        {"r": run_id, "o": oid, "seq": i, "tok": f"park-{uniq()}"},
                    )
                ).scalar_one()
                self.stop_ids.append(sid)
            await s.commit()
        return len(rows)

    async def release(self) -> None:
        if self.run_id is None:
            return
        async with AsyncSessionLocal() as s:
            # Silme HEM id ile HEM işaretle sınırlı: yanlış bir id gerçek bir
            # durağı/turu silemesin. `park-` öneki yalnız bu fixture'ın ürettiği
            # satırlarda bulunur.
            await s.execute(
                text(
                    "DELETE FROM delivery_stops "
                    "WHERE id = ANY(:ids) AND qr_token LIKE 'park-%'"
                ),
                {"ids": self.stop_ids or [0]},
            )
            await s.execute(
                text(
                    "DELETE FROM delivery_runs WHERE id = :r AND status = 'PLANNED' "
                    "AND NOT EXISTS (SELECT 1 FROM delivery_stops ds WHERE ds.run_id = :r)"
                ),
                {"r": self.run_id},
            )
            await s.commit()
