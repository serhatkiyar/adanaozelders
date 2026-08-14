"""İP-2b (sipariş iptali ve telafi) testleri için gerçek veri fabrikası.

`inventory_factory.Fabrika` deseninin İP-2b genişletmesi: kupon, çok kalemli /
karışık sepetli sipariş, izinli admin + gerçek JWT, teslimat turu/durağı ve
kayıt tutan SMS sahtesi. Ödeme sağlayıcısı için conftest'teki `provider`
(StubProvider) fixture'ı kullanılır — burada yeniden tanımlanmaz.

İzolasyon sözleşmesi (kök CLAUDE.md → Test Kalitesi §G):
- Temizlik YALNIZ bu fabrikanın ürettiği ID'lerle yapılır; global TRUNCATE yok.
- `outbox_events` yalnız üretilen siparişlerin `payload->>'order_id'`
  satırlarıyla daraltılır (verify paketindeki koşulsuz DELETE deseni bilinçli
  olarak KOPYALANMAMIŞTIR).
- Ürün + defter satırları `db_guard.purge_products` ile silinir (append-only
  trigger yalnız test DB'sinde, o işlem süresince kapatılır).
- Teardown test başarısız olsa da koşar (yield-fixture finally semantiği).
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.client import Client
from models.delivery import DeliveryRun, DeliveryStop
from models.store import Coupon, CouponRedemption, Order, OrderItem, Product
from services import delivery_service, stock_ledger
from tests.integration.auth_headers import bearer_headers
from tests.integration.db_guard import purge_products


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def client_headers(client_id: int) -> dict[str, str]:
    """Gerçek imzalı CLIENT JWT'si — login akışı olmadan (şifre gerçek değil).

    İP-3 §6'dan sonra `async`: `auth_ver` claim'i zorunlu ve değeri gerçek
    satırdan okunur (bkz. `auth_headers.py`). Claim'siz token her uçta 401 alır.
    """
    return await bearer_headers(client_id, role="CLIENT", role_id=3)


async def admin_headers(admin_id: int) -> dict[str, str]:
    return await bearer_headers(admin_id, role="ADMIN", role_id=1)


class Ip2bFabrika:
    """Test verisi üretir ve teardown'da ürettiklerini fiziksel geri alır."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.admin_role_ids: list[int] = []
        self.coupon_ids: list[int] = []
        self.run_ids: list[int] = []

    # ── Ürün ──────────────────────────────────────────────────────────────────
    async def urun(
        self, *, stock: int | None = 10, kind: str = "PHYSICAL",
        price: str = "100.00", title: str | None = None,
    ) -> int:
        """Ürün + (takip ediliyorsa) açılış INITIAL hareketi — gerçek yol taklidi."""
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"ip2b-{uniq()}",
                title=title or f"IP2b Ürün {uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal(price),
                stock=None if kind != "PHYSICAL" else 0,
                status="ACTIVE",
            )
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        if kind == "PHYSICAL" and stock:
            async with AsyncSessionLocal() as s:
                await stock_ledger.apply_movement(
                    s, pid,
                    qty_delta=stock,
                    bucket=stock_ledger.StockBucket.SALEABLE,
                    movement_type=stock_ledger.StockMovementType.INITIAL,
                    reason_code="PRODUCT_CREATE",
                    ref_type="product", ref_id=pid,
                    idempotency_key=f"ip2b-initial:{pid}",
                )
                await s.commit()
        return pid

    # ── Kullanıcılar ──────────────────────────────────────────────────────────
    async def musteri(self) -> int:
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"ip2b-{uniq()}@test.local",
                hashed_password="test-only",
                first_name="Ip2b",
                last_name="Musteri",
                username=f"ip2b{uniq()}",
                role_id=3,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        return cid

    async def admin_izinli(self, izinler: list[str]) -> tuple[int, dict[str, str]]:
        """Gerçek admin + gerçek rol/izin ataması + imzalı token.

        `require_admin_permission` gerçek `admin_access` çözümünden geçer —
        dependency override YOKTUR.
        """
        from models.admin import Admin
        from schemas.admin_access import AdminRoleCreate
        from services import admin_access_service

        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip2b-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Ip2b",
                last_name="Admin",
                username=f"ipa{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            aid = a.id
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"IP2B_{ek.upper()}", name="IP2b Test Rolü",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=aid, role_id=rol.id, assigned_by_admin_id=aid
            )
            await s.commit()
            self.admin_ids.append(aid)
            self.admin_role_ids.append(rol.id)
        return aid, await admin_headers(aid)

    # ── Kupon ─────────────────────────────────────────────────────────────────
    async def kupon(
        self, *, discount_type: str = "FIXED", value: str = "50.00",
        max_uses: int | None = None, per_user_limit: int | None = None,
        used_count: int = 0, valid_until: datetime.datetime | None = None,
    ) -> tuple[int, str]:
        async with AsyncSessionLocal() as s:
            c = Coupon(
                code=f"IP2B{uniq().upper()}",
                discount_type=discount_type,
                discount_value=Decimal(value),
                is_active=True,
                max_uses=max_uses,
                per_user_limit=per_user_limit,
                used_count=used_count,
                valid_until=valid_until,
            )
            s.add(c)
            await s.flush()
            cid, code = c.id, c.code
            await s.commit()
        self.coupon_ids.append(cid)
        return cid, code

    async def kupon_kullanimi(
        self, *, coupon_id: int, client_id: int, order_id: int
    ) -> None:
        """`_finalize_paid`'in redeem yan etkisini kurar: used_count++ + satır."""
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE coupons SET used_count = used_count + 1 WHERE id = :c"),
                {"c": coupon_id},
            )
            s.add(
                CouponRedemption(
                    coupon_id=coupon_id, client_id=client_id, order_id=order_id
                )
            )
            await s.commit()

    async def kupon_durumu(self, coupon_id: int) -> tuple[int, int]:
        """(used_count, redemption satır sayısı)"""
        async with AsyncSessionLocal() as s:
            uc = (
                await s.execute(
                    text("SELECT used_count FROM coupons WHERE id = :c"),
                    {"c": coupon_id},
                )
            ).scalar_one()
            rows = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM coupon_redemptions WHERE coupon_id = :c"
                    ),
                    {"c": coupon_id},
                )
            ).scalar_one()
        return uc, rows

    # ── Sipariş ───────────────────────────────────────────────────────────────
    async def siparis(
        self,
        *,
        items: list[tuple[int, int, str, str]],  # (product_id, qty, kind, unit_price)
        client_id: int | None = None,
        status: str = "PAID",
        payment_status: str = "PAID",
        coupon: tuple[int, str] | None = None,
        discount: str = "0",
        provider_ref: str | None = None,
        prepared: bool = False,
        sale_yaz: bool | None = None,
        ship_phone: str | None = "+905551112233",
    ) -> tuple[int, list[int]]:
        """Gerçek `orders` + `order_items`; PAID ise satışın SALE hareketi.

        `sale_yaz=None` → payment_status PAID ise fiziksel kalemlere SALE yazar
        (gerçek `_finalize_paid` yolunun defter yan etkisi).
        """
        cid = client_id if client_id is not None else await self.musteri()
        if sale_yaz is None:
            sale_yaz = payment_status == "PAID"
        subtotal = sum(Decimal(up) * q for _pid, q, _k, up in items)
        total = subtotal - Decimal(discount)
        async with AsyncSessionLocal() as s:
            o = Order(
                client_id=cid,
                status=status,
                payment_status=payment_status,
                subtotal=subtotal,
                discount=Decimal(discount),
                total=total,
                currency="TRY",
                provider="fake",
                provider_ref=provider_ref,
                track_token=uniq() + uniq(),
                has_physical=any(k == "PHYSICAL" for _p, _q, k, _u in items),
                coupon_id=coupon[0] if coupon else None,
                coupon_code=coupon[1] if coupon else None,
                ship_recipient="Ip2b Testi",
                ship_address="Test adres",
                ship_phone=ship_phone,
                ship_in_zone=True,
                prepared_at=now() if prepared else None,
                prepared_by="ip2b-test" if prepared else None,
                paid_at=now() if payment_status == "PAID" else None,
            )
            s.add(o)
            await s.flush()
            oid = o.id
            item_ids: list[int] = []
            for pid, qty, kind, up in items:
                it = OrderItem(
                    order_id=oid,
                    product_id=pid,
                    title=f"IP2b Kalem {pid}",
                    unit_price=Decimal(up),
                    quantity=qty,
                    kind=kind,
                    seller_type="PLATFORM",
                )
                s.add(it)
                await s.flush()
                item_ids.append(it.id)
            await s.commit()
        self.order_ids.append(oid)
        if sale_yaz:
            async with AsyncSessionLocal() as s:
                specs = [
                    {
                        "product_id": pid,
                        "qty_delta": -qty,
                        "bucket": stock_ledger.StockBucket.SALEABLE,
                        "movement_type": stock_ledger.StockMovementType.SALE,
                        "reason_code": "ORDER_PAID",
                        "ref_type": "order",
                        "ref_id": oid,
                        "ref_line_id": iid,
                        "idempotency_key": stock_ledger.idempotency_key_for(
                            stock_ledger.StockMovementType.SALE, order_item_id=iid
                        ),
                    }
                    for (pid, qty, kind, _up), iid in zip(items, item_ids, strict=True)
                    if kind == "PHYSICAL"
                ]
                if specs:
                    await stock_ledger.apply_many(s, specs)
                    await s.commit()
        return oid, item_ids

    # ── Teslimat ──────────────────────────────────────────────────────────────
    async def run(
        self, *, status: str = "PLANNED", vehicle: str = "LADA",
        run_date: datetime.date | None = None,
    ) -> int:
        """Teslimat turu. `run_date` verilmezse bugün.

        `uq_delivery_run_planned` (run_date, vehicle_id) çifti başına TEK planlı
        tur ister; çok turlu yarış testleri bu yüzden tur başına farklı bir tarih
        verir — aksi hâlde ikinci tur, ölçmek istediği davranışa hiç varamadan
        IntegrityError'a çarpar.

        İP-19: `vehicle` parametresi araç KODU olarak kaldı (çağıranlar
        "LADA"/"COROLLA" veriyor); id'ye seed'li tablodan çevrilir.
        """
        from tests.integration.filo_yardim import arac_id

        vid = await arac_id(vehicle)
        async with AsyncSessionLocal() as s:
            r = DeliveryRun(
                run_date=run_date or datetime.date.today(), vehicle_id=vid,
                status=status,
                started_at=now() if status == "ACTIVE" else None,
            )
            s.add(r)
            await s.flush()
            rid = r.id
            await s.commit()
        self.run_ids.append(rid)
        return rid

    async def durak(
        self, *, run_id: int, order_id: int, sequence: int = 1,
        status: str = "PENDING", otp_code: str | None = None,
    ) -> int:
        async with AsyncSessionLocal() as s:
            st = DeliveryStop(
                run_id=run_id, order_id=order_id, sequence=sequence,
                qr_token=delivery_service.new_qr_token(), status=status,
            )
            if otp_code is not None:
                st.otp_hash = delivery_service.hash_otp(otp_code)
                st.otp_sent_at = now()
            s.add(st)
            await s.flush()
            sid = st.id
            await s.commit()
        return sid

    # ── Okuma yardımcıları ────────────────────────────────────────────────────
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
    ) -> list[tuple[str, int]]:
        """[(movement_type, qty_delta), ...]"""
        async with AsyncSessionLocal() as s:
            q = "SELECT movement_type, qty_delta FROM stock_movements WHERE product_id = :i"
            params: dict = {"i": product_id}
            if movement_type:
                q += " AND movement_type = :t"
                params["t"] = movement_type
            rows = (await s.execute(text(q + " ORDER BY id"), params)).all()
        return [(r[0], r[1]) for r in rows]

    async def siparis_durumu(self, order_id: int) -> tuple[str, str]:
        """(status, payment_status)"""
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text("SELECT status, payment_status FROM orders WHERE id = :i"),
                    {"i": order_id},
                )
            ).one()
        return row[0], row[1]

    async def iade_tutari(self, order_id: int) -> str:
        """`orders.refunded_amount` (ciro raporu + kısmi iade tavanı buradan okur)."""
        async with AsyncSessionLocal() as s:
            return str(
                (
                    await s.execute(
                        text(
                            "SELECT COALESCE(refunded_amount, 0) FROM orders "
                            "WHERE id = :i"
                        ),
                        {"i": order_id},
                    )
                ).scalar_one()
            )

    async def bildirim_sayisi(self, client_id: int, *, icerik: str = "") -> int:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text(
                        "SELECT count(*) FROM notifications "
                        "WHERE user_id = :u AND role_id = 3 AND message LIKE :m"
                    ),
                    {"u": client_id, "m": f"%{icerik}%"},
                )
            ).scalar_one()

    async def outbox_olaylari(self, order_id: int) -> list[tuple[str, str]]:
        """[(kind, status), ...] — yalnız bu siparişin olayları."""
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT kind, status FROM outbox_events "
                        "WHERE (payload->>'order_id')::int = :o ORDER BY id"
                    ),
                    {"o": order_id},
                )
            ).all()
        return [(r[0], r[1]) for r in rows]

    async def audit_kayitlari(
        self, *, action: str, target_id: int
    ) -> list[tuple[int, str | None]]:
        """[(actor_id, reason), ...]"""
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT actor_id, reason FROM audit_logs "
                        "WHERE action = :a AND target_type = 'order' "
                        "AND target_id = :t ORDER BY id"
                    ),
                    {"a": action, "t": target_id},
                )
            ).all()
        return [(r[0], r[1]) for r in rows]

    async def history(self, order_id: int) -> list[tuple[str | None, str, str]]:
        """[(old_status, new_status, changed_by), ...]"""
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT old_status, new_status, changed_by "
                        "FROM order_status_history WHERE order_id = :o ORDER BY id"
                    ),
                    {"o": order_id},
                )
            ).all()
        return [(r[0], r[1], r[2]) for r in rows]

    # ── Temizlik ──────────────────────────────────────────────────────────────
    async def temizle(self) -> None:
        o = self.order_ids or [0]
        c = self.client_ids or [0]
        a = self.admin_ids or [0]
        cp = self.coupon_ids or [0]
        r = self.run_ids or [0]
        rl = self.admin_role_ids or [0]
        async with AsyncSessionLocal() as s:
            stmts = [
                "DELETE FROM notifications WHERE role_id = 3 AND user_id = ANY(:c)",
                "DELETE FROM notifications WHERE role_id = 1 AND user_id = ANY(:a)",
                # İP-2b R17 MANUAL_REVIEW bildirimi TÜM adminlere gider — seed
                # admin dahil, yani fabrikanın YARATMADIĞI bir kullanıcıya.
                # Kimliğe göre silme onu kaçırır; bu yüzden bu fabrikanın kendi
                # sipariş numaralarını anan admin bildirimleri de temizlenir
                # (kapsam yine dar: yalnız `self.order_ids`).
                "DELETE FROM notifications WHERE role_id = 1 AND EXISTS ("
                "  SELECT 1 FROM unnest(CAST(:o AS int[])) AS x(oid)"
                "  WHERE message LIKE '%#' || x.oid || '%')",
                "DELETE FROM outbox_events WHERE (payload->>'order_id')::int = ANY(:o)",
                "DELETE FROM coupon_redemptions WHERE coupon_id = ANY(:cp) OR order_id = ANY(:o)",
                "DELETE FROM order_return_items WHERE return_id IN "
                "(SELECT id FROM order_returns WHERE order_id = ANY(:o))",
                "DELETE FROM order_returns WHERE order_id = ANY(:o)",
                "DELETE FROM delivery_stops WHERE order_id = ANY(:o) OR run_id = ANY(:r)",
                "DELETE FROM delivery_runs WHERE id = ANY(:r)",
                "DELETE FROM order_status_history WHERE order_id = ANY(:o)",
                "DELETE FROM order_items WHERE order_id = ANY(:o)",
                "DELETE FROM orders WHERE id = ANY(:o)",
                "DELETE FROM coupons WHERE id = ANY(:cp)",
            ]
            params = {"o": o, "c": c, "a": a, "cp": cp, "r": r, "rl": rl}
            for sql in stmts:
                await s.execute(text(sql), params)
            await s.commit()

            if self.product_ids:
                # stock_movements + products (append-only trigger'ı yalnız test
                # DB'sinde geçici kapatır; kendi commit'ini yapar).
                await purge_products(s, self.product_ids)

            son = [
                "DELETE FROM audit_logs WHERE actor_role = 1 AND actor_id = ANY(:a)",
                "DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)",
                "DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:rl)",
                "DELETE FROM admin_roles WHERE id = ANY(:rl)",
                "DELETE FROM admins WHERE id = ANY(:a)",
                "DELETE FROM clients WHERE id = ANY(:c)",
            ]
            for sql in son:
                await s.execute(text(sql), params)
            await s.commit()


@pytest.fixture
async def fab(pg):
    f = Ip2bFabrika()
    yield f
    await f.temizle()


@pytest.fixture
async def http(pg):
    """Gerçek ASGI HTTP istemcisi — dependency override YOK, gerçek auth çözümü."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class KayitliSms:
    """Gönderilen SMS'leri kaydeden sahte sender (core/sms/base.SmsSender uyumlu)."""

    def __init__(self) -> None:
        self.mesajlar: list[tuple[str, str]] = []  # (to, text)

    async def send(self, message) -> None:
        self.mesajlar.append((message.to, message.text))


@pytest.fixture
def sms_kayit(monkeypatch) -> KayitliSms:
    """`core.sms.sender.get_sms_sender`'ı kayıt tutan sender'la değiştirir.

    `_safe_send` sender'ı çağrı anında çözer → geç bağlama; OTP ve outbox SMS
    yolları aynı kayıtçıdan geçer.
    """
    from core.sms import sender as sms_sender

    kayit = KayitliSms()
    monkeypatch.setattr(sms_sender, "get_sms_sender", lambda: kayit)
    return kayit
