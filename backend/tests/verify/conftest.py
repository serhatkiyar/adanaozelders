"""Bağımsız doğrulama paketi — GERÇEK Postgres + gerçek servis katmanı.

Bu paket, geliştirme sırasında yazılmış birim testlerinden BAĞIMSIZ olarak
davranışı doğrular. Birim testleri sahte (fake) db/nesnelerle çalışıyor ve
yazarının varsayımlarını taşıyabilir; burada:

  - gerçek PostgreSQL (izole `adana_verify` veritabanı, `alembic upgrade head`),
  - gerçek servis katmanı (order_service, coupon_service, escrow, …),
  - gerçek DB kısıtları (unique index, CHECK, FK, exclusion constraint)

kullanılır. Yalnız **ödeme sağlayıcısı** sahtedir — dış dünyaya para çağrısı
yapılamayacağı için.

Çalıştırma (backend/ içinden):
    POSTGRES_DB=adana_verify python -m pytest tests/verify -q

ÖNEMLİ: Bu testler yazdıkları satırları teardown'da FİZİKSEL siler; asla
geliştirme veritabanına yönlendirmeyin (guard aşağıda).
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal, engine

VERIFY_DB_NAME = "adana_verify"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture(scope="session", autouse=True)
def _guard_database() -> None:
    """Yanlış veritabanına bağlanmayı ENGELLE.

    Bu paket veri yazar ve siler; geliştirme veritabanında çalıştırılırsa
    gerçek kayıtlar zarar görür.
    """
    if settings.POSTGRES_DB != VERIFY_DB_NAME:
        pytest.exit(
            f"tests/verify yalnız '{VERIFY_DB_NAME}' veritabanında çalışır "
            f"(şu an: '{settings.POSTGRES_DB}'). "
            f"Çalıştırma: POSTGRES_DB={VERIFY_DB_NAME} pytest tests/verify",
            returncode=1,
        )




@pytest.fixture
async def db():
    """Gerçek DB oturumu; erişilemezse test ATLANMAZ, HATA verir.

    (Sessiz skip, "testler geçti" yanılsaması üretir — doğrulama paketinde
    bunu istemiyoruz.)

    Rol satırları burada seed edilir: migration yalnız ŞEMAYI kurar, roller
    uygulama açılışında (`core.seed.seed_roles`) yazılır. Bu paket uygulamayı
    ayağa kaldırmadığından FK'ler (clients.role_id → roles.id) aksi halde
    üretimdekinden farklı davranırdı. Seed idempotenttir.

    NOT: `engine.dispose()` ÇAĞRILMAZ. Paket tek (session kapsamlı) event
    loop'ta koşar; her testte dispose etmek Windows/asyncpg'de bağlantıyı
    asılı bırakıyordu.
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"Postgres erişilemiyor: {exc!r}")

    from core import seed

    async with AsyncSessionLocal() as session:
        await seed.seed_roles(session)
        await session.commit()

    async with AsyncSessionLocal() as session:
        yield session


class Factory:
    """Test verisi üretir ve teardown'da fiziksel siler."""

    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.tutor_ids: list[int] = []
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.coupon_ids: list[int] = []
        self.category_ids: list[int] = []

    async def client(self, session) -> "Client":  # type: ignore[name-defined]
        from models.client import Client

        u = _uniq()
        c = Client(
            email=f"c-{u}@verify.test",
            hashed_password="x",
            first_name="Test",
            last_name="Musteri",
            username=f"c{u}",
            role_id=3,
        )
        session.add(c)
        await session.flush()
        self.client_ids.append(c.id)
        return c

    async def tutor(self, session, *, status=None, is_active: bool = True):
        from models.tutor import Tutor, TutorStatus

        u = _uniq()
        t = Tutor(
            email=f"t-{u}@verify.test",
            hashed_password="x",
            first_name="Test",
            last_name="Egitmen",
            username=f"t{u}",
            role_id=2,
            status=status or TutorStatus.APPROVED,
            is_active=is_active,
            hourly_rate=Decimal("500"),
        )
        session.add(t)
        await session.flush()
        self.tutor_ids.append(t.id)
        return t

    async def category(self, session, *, name: str, parent_id: int | None = None):
        from models.store import ProductCategory

        u = _uniq()
        cat = ProductCategory(slug=f"{name.lower()}-{u}", name=name, parent_id=parent_id)
        session.add(cat)
        await session.flush()
        self.category_ids.append(cat.id)
        return cat

    async def product(
        self,
        session,
        *,
        price: str = "100.00",
        stock: int | None = 10,
        kind: str = "PHYSICAL",
        tax_rate: str = "0",
        category_id: int | None = None,
        status: str = "ACTIVE",
    ):
        from models.store import Product

        u = _uniq()
        p = Product(
            slug=f"urun-{u}",
            title=f"Test Ürün {u}",
            kind=kind,
            seller_type="PLATFORM",
            price=Decimal(price),
            tax_rate=Decimal(tax_rate),
            stock=stock,
            status=status,
            category_id=category_id,
        )
        session.add(p)
        await session.flush()
        self.product_ids.append(p.id)
        return p

    async def coupon(
        self,
        session,
        *,
        code: str | None = None,
        discount_type: str = "FIXED",
        value: str = "50.00",
        max_uses: int | None = None,
        per_user_limit: int | None = None,
    ):
        from models.store import Coupon

        c = Coupon(
            code=code or f"KUPON{_uniq().upper()}",
            discount_type=discount_type,
            discount_value=Decimal(value),
            is_active=True,
            max_uses=max_uses,
            per_user_limit=per_user_limit,
            used_count=0,
        )
        session.add(c)
        await session.flush()
        self.coupon_ids.append(c.id)
        return c

    async def order(
        self,
        session,
        *,
        client,
        items: list[tuple],  # (product, quantity)
        payment_status: str = "PENDING",
        status: str = "PENDING",
        provider_ref: str | None = None,
        coupon=None,
        discount: str = "0",
        shipping: str = "0",
    ):
        from models.store import Order, OrderItem

        subtotal = sum(
            Decimal(str(p.price)) * q for p, q in items
        )
        total = subtotal - Decimal(discount) + Decimal(shipping)
        o = Order(
            client_id=client.id,
            status=status,
            subtotal=subtotal,
            shipping_fee=Decimal(shipping),
            discount=Decimal(discount),
            total=total,
            currency="TRY",
            payment_status=payment_status,
            provider="fake",
            provider_ref=provider_ref,
            has_physical=any(p.kind == "PHYSICAL" for p, _ in items),
            coupon_id=coupon.id if coupon else None,
            coupon_code=coupon.code if coupon else None,
        )
        session.add(o)
        await session.flush()
        for p, q in items:
            session.add(
                OrderItem(
                    order_id=o.id,
                    product_id=p.id,
                    title=p.title,
                    unit_price=p.price,
                    quantity=q,
                    kind=p.kind,
                    seller_type=p.seller_type,
                    tax_rate=p.tax_rate,
                    tax_amount=Decimal("0"),
                )
            )
        await session.flush()
        self.order_ids.append(o.id)
        return o

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            stmts = [
                # Ders/ödeme kayıtları: eğitmen silinmeden önce temizlenmeli (FK).
                ("DELETE FROM payments WHERE booking_id IN "
                 "(SELECT id FROM bookings WHERE tutor_id = ANY(:t) OR client_id = ANY(:c))", None),
                ("DELETE FROM bookings WHERE tutor_id = ANY(:t) OR client_id = ANY(:c)", None),
                ("DELETE FROM payout_records WHERE payee_id = ANY(:t) AND payee_type = 'TUTOR'", None),
                ("DELETE FROM order_return_items WHERE return_id IN "
                 "(SELECT id FROM order_returns WHERE order_id = ANY(:o))", "o"),
                ("DELETE FROM order_returns WHERE order_id = ANY(:o)", "o"),
                ("DELETE FROM coupon_redemptions WHERE order_id = ANY(:o)", "o"),
                ("DELETE FROM order_status_history WHERE order_id = ANY(:o)", "o"),
                ("DELETE FROM order_items WHERE order_id = ANY(:o)", "o"),
                ("DELETE FROM outbox_events WHERE id IS NOT NULL", None),
                ("DELETE FROM orders WHERE id = ANY(:o)", "o"),
                ("DELETE FROM product_price_history WHERE product_id = ANY(:p)", "p"),
                ("DELETE FROM products WHERE id = ANY(:p)", "p"),
                ("DELETE FROM product_categories WHERE id = ANY(:cat)", "cat"),
                ("DELETE FROM coupons WHERE id = ANY(:cp)", "cp"),
                ("DELETE FROM user_consents WHERE user_id = ANY(:c) OR user_id = ANY(:t)", None),
                ("DELETE FROM notifications WHERE user_id = ANY(:c) OR user_id = ANY(:t)", None),
                ("DELETE FROM refresh_tokens WHERE user_id = ANY(:c) OR user_id = ANY(:t)", None),
                ("DELETE FROM client_addresses WHERE client_id = ANY(:c)", "c"),
                ("DELETE FROM clients WHERE id = ANY(:c)", "c"),
                ("DELETE FROM tutors WHERE id = ANY(:t)", "t"),
            ]
            params = {
                "o": self.order_ids or [0],
                "p": self.product_ids or [0],
                "cat": self.category_ids or [0],
                "cp": self.coupon_ids or [0],
                "c": self.client_ids or [0],
                "t": self.tutor_ids or [0],
            }
            for sql, _k in stmts:
                await s.execute(text(sql), params)
            await s.commit()


@pytest.fixture
async def factory(db):
    """Test verisi üreticisi.

    `db`'ye BAĞIMLIDIR ve temizlikten önce onu rollback eder: test içinde
    `_lock_order` gibi yollar `FOR UPDATE` kilidi alır; açık transaction
    kapatılmadan DELETE çalıştırmak kilit beklemesine (deadlock) düşer.
    """
    f = Factory()
    yield f
    await db.rollback()
    await f.cleanup()


@pytest.fixture
def fake_provider(monkeypatch):
    """Ödeme sağlayıcısı — tek sahte bileşen.

    Çağrıları kaydeder; başarısızlık ve kısmi iade senaryoları için
    davranışı testten ayarlanabilir.
    """
    from core import payments

    class Provider:
        def __init__(self) -> None:
            self.refunds: list[tuple[str | None, Decimal]] = []
            self.refund_ok = True
            # Reconciler'ın "pozitif kanıt" sorgusu. Varsayılan UNKNOWN, gerçek
            # sağlayıcıların varsayılanıyla aynı: emin olunamayan durumda asla
            # yanlış pozitif üretilmez.
            self.state = None
            self.state_queries: list[tuple[str | None, str | None]] = []

        async def refund(self, *, provider_ref: str | None, amount) -> bool:
            self.refunds.append((provider_ref, Decimal(str(amount))))
            return self.refund_ok

        async def refund_state(
            self, *, provider_ref: str | None, reference: str | None = None
        ):
            from core.payments.base import RefundState

            self.state_queries.append((provider_ref, reference))
            return self.state or RefundState.UNKNOWN

        async def charge(self, **kw):  # pragma: no cover - kullanılmıyor
            raise AssertionError("bu testte charge çağrılmamalı")

    stub = Provider()
    monkeypatch.setattr(payments, "get_payment_provider", lambda: stub)
    from services import order_service

    monkeypatch.setattr(order_service.payments, "get_payment_provider", lambda: stub)
    from services import escrow

    monkeypatch.setattr(escrow.payments, "get_payment_provider", lambda: stub)
    return stub
