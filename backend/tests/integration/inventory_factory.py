"""F29 testleri için gerçek veri fabrikası — YALNIZ bugün var olan modeller.

Ürün, müşteri, sipariş ve defter hareketleri gerçek tablolara yazılır; F29'un
kendi tabloları (sayım oturumu, hasar olayı) burada YOKTUR — onlar servis
üzerinden üretilir, çünkü testin ölçtüğü şey servisin davranışıdır.

İzolasyon: `db_guard.purge_products` ile ürünler ve defter satırları FİZİKSEL
olarak silinir (append-only trigger yalnız test DB'sinde geçici kapatılır).
Sipariş/müşteri satırları da temizlenir — hijyen nöbetçisi (conftest) suite
öncesi/sonrası sayıları karşılaştırıyor ve artık satır suite'i kırar.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order, OrderItem, Product
from services import stock_ledger
from tests.integration.db_guard import purge_products
from tests.integration.product_category import integration_product_category_id


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class Fabrika:
    """Test verisi üretir ve teardown'da tamamını geri alır."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []

    # ── Ürün ──
    async def urun(
        self, *, stock: int | None = 0, kind: str = "PHYSICAL",
        damaged: int | None = 0, title: str | None = None,
    ) -> int:
        """Ürün + (takip ediliyorsa) açılış hareketi.

        `damaged` bugün kolon olarak YOK; commit 3'te eklenecek. Fabrika onu
        yalnız kolon varsa yazar, böylece bu dosya commit 2'de de import
        edilebilir kalır ve testler ImportError yerine kendi iddialarıyla kırılır.
        """
        async with AsyncSessionLocal() as s:
            # Gerçek yolun aynısı (`store_service.create_product`): ürün stok 0
            # doğar, açılış bakiyesi INITIAL hareketiyle yazılır. Ürünü doğrudan
            # `stock=n` ile yaratıp üstüne INITIAL eklemek stoğu iki katına
            # çıkarır ve fabrikayı sessizce yalancı yapardı.
            p = Product(
                slug=f"sayim-test-{uniq()}",
                title=title or f"Sayim Testi {uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal("100.00"),
                stock=None if stock is None else 0,
                status="ACTIVE",
                category_id=await integration_product_category_id(s),
            )
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        if stock:
            async with AsyncSessionLocal() as s:
                await stock_ledger.apply_movement(
                    s, pid,
                    qty_delta=stock,
                    # F29 commit 4: defter `bucket`'i ZORUNLU ister.
                    bucket=stock_ledger.StockBucket.SALEABLE,
                    movement_type=stock_ledger.StockMovementType.INITIAL,
                    reason_code="PRODUCT_CREATE",
                    ref_type="product", ref_id=pid,
                    idempotency_key=f"test-initial:{pid}",
                )
                await s.commit()
        if damaged:
            await self._damaged_yaz(pid, damaged)
        return pid

    async def _damaged_yaz(self, pid: int, adet: int) -> None:
        async with AsyncSessionLocal() as s:
            var = (
                await s.execute(
                    text(
                        "SELECT 1 FROM information_schema.columns "
                        "WHERE table_name='products' AND column_name='damaged_stock'"
                    )
                )
            ).first()
            if not var:
                return
            await s.execute(
                text("UPDATE products SET damaged_stock = :v WHERE id = :i"),
                {"v": adet, "i": pid},
            )
            await s.commit()

    # ── Admin ──
    async def admin(self) -> int:
        """İkinci bir admin — "başkası yeniden saydı" senaryosu için.

        Sabit bir id (ör. 2) VARSAYILAMAZ: sayım tabloları aktör kolonlarını
        `admins` tablosuna `RESTRICT` FK ile bağlıyor, olmayan bir admin
        kimliği FK ihlaliyle patlar. Bu, kaydın aktörünü kaybedememesi
        anlamına gelir ve istenen davranıştır.
        """
        from models.admin import Admin

        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"sayim-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Sayim",
                last_name="Admin",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            aid = a.id
            await s.commit()
        self.admin_ids.append(aid)
        return aid

    # ── Müşteri + sipariş ──
    async def musteri(self) -> int:
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"sayim-{uniq()}@test.local",
                hashed_password="test-only",
                first_name="Sayim",
                last_name="Musteri",
                role_id=3,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        return cid

    async def siparis(
        self,
        *,
        product_id: int,
        quantity: int,
        status: str = "PAID",
        payment_status: str = "PAID",
        client_id: int | None = None,
        sale_yaz: bool = True,
    ) -> int:
        """Gerçek `orders` + `order_items` satırı; istenirse SALE hareketi.

        `sale_yaz=True` gerçek satış yolunu taklit eder: `products.stock`
        düşer, kitap fiziksel olarak İŞLETMEDE kalır.
        """
        cid = client_id if client_id is not None else await self.musteri()
        async with AsyncSessionLocal() as s:
            o = Order(
                client_id=cid,
                subtotal=Decimal("100.00"),
                total=Decimal("100.00"),
                status=status,
                payment_status=payment_status,
                track_token=uniq() + uniq(),
                has_physical=True,
            )
            s.add(o)
            await s.flush()
            s.add(
                OrderItem(
                    order_id=o.id,
                    product_id=product_id,
                    title="Sayim Testi",
                    unit_price=Decimal("100.00"),
                    quantity=quantity,
                    kind="PHYSICAL",
                    seller_type="PLATFORM",
                )
            )
            await s.flush()
            oid = o.id
            item_id = (
                await s.execute(
                    text("SELECT id FROM order_items WHERE order_id = :o"), {"o": oid}
                )
            ).scalar_one()
            await s.commit()
        self.order_ids.append(oid)
        if sale_yaz:
            async with AsyncSessionLocal() as s:
                await stock_ledger.apply_movement(
                    s, product_id,
                    qty_delta=-quantity,
                    bucket=stock_ledger.StockBucket.SALEABLE,
                    movement_type=stock_ledger.StockMovementType.SALE,
                    reason_code="ORDER_PAID",
                    ref_type="order", ref_id=oid, ref_line_id=item_id,
                    idempotency_key=stock_ledger.idempotency_key_for(
                        stock_ledger.StockMovementType.SALE, order_item_id=item_id
                    ),
                )
                await s.commit()
        return oid

    async def stok(self, product_id: int) -> int | None:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
                )
            ).scalar_one()

    async def hareket_sayisi(self, product_id: int) -> int:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT count(*) FROM stock_movements WHERE product_id = :i"),
                    {"i": product_id},
                )
            ).scalar_one()

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.order_ids:
                await s.execute(
                    text("DELETE FROM order_items WHERE order_id = ANY(:i)"),
                    {"i": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM order_status_history WHERE order_id = ANY(:i)"),
                    {"i": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM orders WHERE id = ANY(:i)"), {"i": self.order_ids}
                )
            if self.product_ids:
                await purge_products(s, self.product_ids)
            if self.client_ids:
                await s.execute(
                    text("DELETE FROM clients WHERE id = ANY(:i)"), {"i": self.client_ids}
                )
            if self.admin_ids:
                # Sayım/iz satırları admin'e RESTRICT FK ile bağlı → önce onlar.
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) "
                        "AND actor_role = 1"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"), {"i": self.admin_ids}
                )
            await s.commit()
