"""İP-2a mağaza iade/refund kabul testleri için gerçek veri fabrikası.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md §6.

- Ürünler üretim yolunun aynısıyla doğar: stok 0 + INITIAL defter hareketi
  (ham ``stock=n`` defter zincirini doğuştan kırar — verify paketindeki bilinen
  kusur burada TEKRARLANMAZ).
- Siparişler gerçek ``orders``/``order_items`` satırlarıyla, istenirse kuponlu
  ve SALE hareketiyle kurulur; ``provider_ref`` verilir ki iade yolu gerçek
  akıştaki gibi sağlayıcı referansı bulsun.
- Admin'ler gerçek rol + izin satırları ve gerçek imzalı JWT ile üretilir.
- Temizlik YALNIZ fabrikanın kaydettiği ID'lerle, FK sırasına göre; ürün ve
  defter satırları ``db_guard.purge_products`` ile. Global TRUNCATE yok.
- İdempotency anahtarları koşuma özgüdür (ürün/sipariş/kalem ID'leri her
  koşumda yenidir); sabit anahtar paylaşılmaz.
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from models.client import Client
from models.store import (
    Coupon,
    CouponRedemption,
    Order,
    OrderItem,
    OrderReturn,
    OrderReturnItem,
    Product,
)
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, stock_ledger
from tests.integration.db_guard import purge_products


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@dataclasses.dataclass
class Siparis:
    """Kurulmuş bir sipariş — testin ihtiyaç duyduğu tüm kimlikler."""

    order_id: int
    client_id: int
    item_ids: list[int]
    total: Decimal
    subtotal: Decimal
    discount: Decimal
    shipping: Decimal
    coupon_id: int | None


class IadeFabrikasi:
    """Test verisi üretir ve teardown'da tamamını ID bazlı geri alır."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.coupon_ids: list[int] = []

    # ── Kullanıcılar ──────────────────────────────────────────────────────────

    async def musteri(self) -> tuple[int, dict]:
        """Gerçek CLIENT + gerçek imzalı token başlığı."""
        ek = uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"ip2a-{ek}@test.local",
                hashed_password="test-only",
                first_name="Iade",
                last_name="Musteri",
                username=f"ip2a{ek}",
                role_id=3,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        token = create_access_token(subject=cid, role="CLIENT", role_id=3)
        return cid, {"Authorization": f"Bearer {token}"}

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları + gerçek imzalı JWT."""
        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip2a-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Iade",
                last_name="Admin",
                username=f"ia{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"IP2A_{ek.upper()}",
                        name="IP2A Test Rolü",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
                )
                self.role_ids.append(rol.id)
            await s.commit()
            self.admin_ids.append(a.id)
            token = create_access_token(subject=a.id, role="ADMIN", role_id=1)
            return a.id, {"Authorization": f"Bearer {token}"}

    # ── Katalog ───────────────────────────────────────────────────────────────

    async def urun(self, *, price: str = "100.00", stock: int = 10) -> int:
        """Ürün + INITIAL açılış hareketi (üretim yolunun aynısı)."""
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"ip2a-{uniq()}",
                title=f"IP2A Kitap {uniq()}",
                kind="PHYSICAL",
                seller_type="PLATFORM",
                price=Decimal(price),
                stock=0,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        if stock:
            async with AsyncSessionLocal() as s:
                await stock_ledger.apply_movement(
                    s,
                    pid,
                    qty_delta=stock,
                    bucket=stock_ledger.StockBucket.SALEABLE,
                    movement_type=stock_ledger.StockMovementType.INITIAL,
                    reason_code="PRODUCT_CREATE",
                    ref_type="product",
                    ref_id=pid,
                    idempotency_key=stock_ledger.idempotency_key_for(
                        stock_ledger.StockMovementType.INITIAL, product_id=pid
                    ),
                )
                await s.commit()
        return pid

    async def kupon(
        self,
        *,
        discount_type: str = "FIXED",
        value: str = "50.00",
        max_uses: int | None = None,
        per_user_limit: int | None = None,
        used_count: int = 0,
    ) -> int:
        async with AsyncSessionLocal() as s:
            c = Coupon(
                code=f"IP2A{uniq().upper()}",
                discount_type=discount_type,
                discount_value=Decimal(value),
                is_active=True,
                max_uses=max_uses,
                per_user_limit=per_user_limit,
                used_count=used_count,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.coupon_ids.append(cid)
        return cid

    # ── Sipariş ───────────────────────────────────────────────────────────────

    async def siparis(
        self,
        *,
        items: list[tuple[int, int]],
        client_id: int | None = None,
        status: str = "DELIVERED",
        payment_status: str = "PAID",
        discount: str = "0.00",
        shipping: str = "0.00",
        coupon_id: int | None = None,
        coupon_redeemed: bool = False,
        provider_ref: str | None = None,
        delivered_days_ago: int | None = 1,
        sale_yaz: bool = True,
    ) -> Siparis:
        """Gerçek sipariş: ``items`` = [(product_id, quantity), ...].

        ``coupon_redeemed=True`` gerçek PAID yolunu taklit eder: ``used_count``
        artar ve ``coupon_redemptions`` satırı yazılır (``_finalize_paid`` gibi).
        ``sale_yaz=True`` her kalem için SALE hareketi yazar (stok düşer).
        """
        if client_id is None:
            client_id, _ = await self.musteri()
        delivered_at = (
            now() - datetime.timedelta(days=delivered_days_ago)
            if delivered_days_ago is not None
            else None
        )
        async with AsyncSessionLocal() as s:
            fiyatlar: dict[int, tuple[Decimal, str]] = {}
            for pid, _q in items:
                row = (
                    await s.execute(
                        text("SELECT price, title FROM products WHERE id = :i"),
                        {"i": pid},
                    )
                ).one()
                fiyatlar[pid] = (Decimal(str(row[0])), row[1])
            subtotal = sum(
                (fiyatlar[pid][0] * q for pid, q in items), Decimal("0.00")
            ).quantize(Decimal("0.01"))
            d = Decimal(discount)
            sh = Decimal(shipping)
            total = (subtotal - d + sh).quantize(Decimal("0.01"))
            coupon_code = None
            if coupon_id is not None:
                coupon_code = (
                    await s.execute(
                        text("SELECT code FROM coupons WHERE id = :i"),
                        {"i": coupon_id},
                    )
                ).scalar_one()
            o = Order(
                client_id=client_id,
                status=status,
                subtotal=subtotal,
                shipping_fee=sh,
                discount=d,
                total=total,
                currency="TRY",
                payment_status=payment_status,
                provider="fake",
                provider_ref=provider_ref or f"txn-{uniq()}",
                paid_at=now() if payment_status == "PAID" else None,
                delivered_at=delivered_at,
                has_physical=True,
                track_token=uniq() + uniq(),
                coupon_id=coupon_id,
                coupon_code=coupon_code,
            )
            s.add(o)
            await s.flush()
            oid = o.id
            item_ids: list[int] = []
            for pid, q in items:
                it = OrderItem(
                    order_id=oid,
                    product_id=pid,
                    title=fiyatlar[pid][1],
                    unit_price=fiyatlar[pid][0],
                    quantity=q,
                    kind="PHYSICAL",
                    seller_type="PLATFORM",
                )
                s.add(it)
                await s.flush()
                item_ids.append(it.id)
            if coupon_id is not None and coupon_redeemed:
                await s.execute(
                    text(
                        "UPDATE coupons SET used_count = used_count + 1 "
                        "WHERE id = :c"
                    ),
                    {"c": coupon_id},
                )
                s.add(
                    CouponRedemption(
                        coupon_id=coupon_id, client_id=client_id, order_id=oid
                    )
                )
            await s.commit()
        self.order_ids.append(oid)
        if sale_yaz:
            for (pid, q), item_id in zip(items, item_ids, strict=True):
                async with AsyncSessionLocal() as s:
                    await stock_ledger.apply_movement(
                        s,
                        pid,
                        qty_delta=-q,
                        bucket=stock_ledger.StockBucket.SALEABLE,
                        movement_type=stock_ledger.StockMovementType.SALE,
                        reason_code="ORDER_PAID",
                        ref_type="order",
                        ref_id=oid,
                        ref_line_id=item_id,
                        idempotency_key=stock_ledger.idempotency_key_for(
                            stock_ledger.StockMovementType.SALE,
                            order_item_id=item_id,
                        ),
                    )
                    await s.commit()
        return Siparis(
            order_id=oid,
            client_id=client_id,
            item_ids=item_ids,
            total=total,
            subtotal=subtotal,
            discount=d,
            shipping=sh,
            coupon_id=coupon_id,
        )

    async def iade_tohumla(
        self,
        *,
        order_id: int,
        client_id: int,
        items: list[tuple[int, int, str]],
        return_type: str = "AYIPLI",
        status: str = "PENDING",
        refund_amount: str = "0.00",
        is_partial: bool = True,
    ) -> int:
        """Ham PENDING iade talebi tohumlar (yarış testleri için).

        ``items`` = [(order_item_id, quantity, amount), ...]. Talep, gerçek
        ``request_return`` yolunun ÜRETTİĞİ şekle birebir uygun kurulur; yarış
        testleri iki ayrı PENDING talebi aynı siparişte buluşturmak için
        kullanır (uygulama guard'ı ardışık ikinci PENDING'i 409'lar).
        """
        async with AsyncSessionLocal() as s:
            ret = OrderReturn(
                order_id=order_id,
                client_id=client_id,
                reason="ip2a yarış tohumu",
                type=return_type,
                status=status,
                refund_amount=Decimal(refund_amount),
                is_partial=is_partial,
            )
            s.add(ret)
            await s.flush()
            for item_id, qty, amount in items:
                s.add(
                    OrderReturnItem(
                        return_id=ret.id,
                        order_item_id=item_id,
                        quantity=qty,
                        amount=Decimal(amount),
                    )
                )
            rid = ret.id
            await s.commit()
        return rid

    # ── Okuma yardımcıları (ham SQL — ORM kimlik haritasını atlar) ───────────

    async def stok(self, product_id: int) -> int | None:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT stock FROM products WHERE id = :i"),
                    {"i": product_id},
                )
            ).scalar_one()

    async def hareketler(
        self, product_id: int, movement_type: str | None = None
    ) -> list[tuple]:
        """(movement_type, bucket, qty_delta, idempotency_key) listesi."""
        q = (
            "SELECT movement_type, bucket, qty_delta, idempotency_key "
            "FROM stock_movements WHERE product_id = :i"
        )
        params: dict = {"i": product_id}
        if movement_type is not None:
            q += " AND movement_type = :t"
            params["t"] = movement_type
        q += " ORDER BY id"
        async with AsyncSessionLocal() as s:
            return [tuple(r) for r in (await s.execute(text(q), params)).all()]

    async def siparis_satiri(self, order_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT status, payment_status, refunded_amount, "
                        "refunded_at, refund_attempts FROM orders WHERE id = :i"
                    ),
                    {"i": order_id},
                )
            ).one()
            return {
                "status": row[0],
                "payment_status": row[1],
                "refunded_amount": Decimal(str(row[2])),
                "refunded_at": row[3],
                "refund_attempts": row[4],
            }

    async def iade_satirlari(self, order_id: int) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT id, status, type, refund_status, refund_amount, "
                        "provider_ref, refund_attempts, is_partial "
                        "FROM order_returns WHERE order_id = :i ORDER BY id"
                    ),
                    {"i": order_id},
                )
            ).all()
            return [
                {
                    "id": r[0],
                    "status": r[1],
                    "type": r[2],
                    "refund_status": r[3],
                    "refund_amount": Decimal(str(r[4])),
                    "provider_ref": r[5],
                    "refund_attempts": r[6],
                    "is_partial": r[7],
                }
                for r in rows
            ]

    async def bildirim_sayisi(self, client_id: int, *, icinde: str) -> int:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text(
                        "SELECT count(*) FROM notifications "
                        "WHERE user_id = :u AND role_id = 3 "
                        "AND message LIKE '%' || :m || '%'"
                    ),
                    {"u": client_id, "m": icinde},
                )
            ).scalar_one()

    async def audit_sayisi(
        self, *, action: str, target_type: str, target_id: int
    ) -> int:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text(
                        "SELECT count(*) FROM audit_logs WHERE action = :a "
                        "AND target_type = :t AND target_id = :i"
                    ),
                    {"a": action, "t": target_type, "i": target_id},
                )
            ).scalar_one()

    async def kupon_satiri(self, coupon_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT used_count, (SELECT count(*) FROM "
                        "coupon_redemptions WHERE coupon_id = :i) "
                        "FROM coupons WHERE id = :i"
                    ),
                    {"i": coupon_id},
                )
            ).one()
            return {"used_count": row[0], "redemptions": row[1]}

    # ── Temizlik ──────────────────────────────────────────────────────────────

    async def temizle(self) -> None:
        """FK sırasına göre, yalnız fabrikanın kaydettiği ID'lerle."""
        async with AsyncSessionLocal() as s:
            if self.order_ids:
                return_ids = [
                    r[0]
                    for r in (
                        await s.execute(
                            text(
                                "SELECT id FROM order_returns "
                                "WHERE order_id = ANY(:o)"
                            ),
                            {"o": self.order_ids},
                        )
                    ).all()
                ]
                if return_ids:
                    await s.execute(
                        text(
                            "DELETE FROM order_return_items "
                            "WHERE return_id = ANY(:r)"
                        ),
                        {"r": return_ids},
                    )
                    await s.execute(
                        text(
                            "DELETE FROM audit_logs "
                            "WHERE target_type = 'order_return' "
                            "AND target_id = ANY(:r)"
                        ),
                        {"r": return_ids},
                    )
                    await s.execute(
                        text("DELETE FROM order_returns WHERE id = ANY(:r)"),
                        {"r": return_ids},
                    )
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE target_type = 'order' "
                        "AND target_id = ANY(:o)"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM outbox_events "
                        "WHERE kind = 'email:order_status' "
                        "AND (payload->>'order_id')::int = ANY(:o)"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM coupon_redemptions WHERE order_id = ANY(:o)"),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM order_items WHERE order_id = ANY(:o)"),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM order_status_history WHERE order_id = ANY(:o)"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM orders WHERE id = ANY(:o)"),
                    {"o": self.order_ids},
                )
            if self.coupon_ids:
                await s.execute(
                    text(
                        "DELETE FROM coupon_redemptions WHERE coupon_id = ANY(:c)"
                    ),
                    {"c": self.coupon_ids},
                )
                await s.execute(
                    text("DELETE FROM coupons WHERE id = ANY(:c)"),
                    {"c": self.coupon_ids},
                )
            if self.product_ids:
                await purge_products(s, self.product_ids)
            if self.client_ids:
                await s.execute(
                    text(
                        "DELETE FROM notifications "
                        "WHERE user_id = ANY(:c) AND role_id = 3"
                    ),
                    {"c": self.client_ids},
                )
                await s.execute(
                    text("DELETE FROM clients WHERE id = ANY(:c)"),
                    {"c": self.client_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:a) "
                        "AND actor_role = 1"
                    ),
                    {"a": self.admin_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments "
                        "WHERE admin_id = ANY(:a)"
                    ),
                    {"a": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions "
                        "WHERE admin_role_id = ANY(:r)"
                    ),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:r)"),
                    {"r": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            await s.commit()
