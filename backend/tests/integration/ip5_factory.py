"""İP-5 KDV/fatura kabul testleri için gerçek veri fabrikası.

Sözleşme: ``docs/ip5-kdv-fatura-sozlesme.md``.

Tasarım kararları (İP-2a fabrikasından bilinçli farklar):

- **Sipariş GERÇEK ``POST /store/orders`` ucundan doğar.** İP-2a fabrikası
  siparişleri ham ``INSERT`` ile kuruyordu; orada doğruydu (test konusu iade
  matematiğiydi). Burada test konusunun ta kendisi *sipariş oluşturmanın vergi
  kırılımını üretip üretmediği*, yani ham INSERT tam olarak ölçülmesi gereken
  kodu atlardı — yalancı yeşil üretirdi.
- Ürünler üretim yolundaki gibi doğar: ``stock=0`` + ``INITIAL`` defter
  hareketi. Ham ``stock=n`` defter zincirini doğuştan kırar.
- Müşteri ``phone_verified`` gelir: sipariş ucu
  ``phone_service.require_phone_verified`` ile kapılıdır.
- Temizlik YALNIZ fabrikanın kaydettiği ID'lerle, FK sırasına göre; ürün ve
  defter satırları ``db_guard.purge_products`` ile. Global TRUNCATE yok.
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from models.client import Client, ClientAddress
from models.store import Coupon, Product
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, stock_ledger
from tests.integration.auth_headers import bearer_headers
from tests.integration.product_category import integration_product_category_id
from tests.integration.db_guard import purge_products


@pytest.fixture
async def fab5(pg):
    """İP-5 fabrikası — teardown testin sonucundan BAĞIMSIZ koşar.

    ``yield`` sonrası temizlik `finally` gerektirmez: pytest fixture'ı test
    hata verse de `yield`'den sonrasını çalıştırır. Fabrikanın kendi hatası
    sızarsa suite hijyen nöbetçisi (conftest `_hijyen_nobetcisi`) yakalar.
    """
    f = VergiFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@dataclasses.dataclass
class Musteri:
    client_id: int
    headers: dict
    address_id: int


@dataclasses.dataclass
class VergiSatiri:
    """Bir orana ait matrah/vergi çifti (``orders.tax_breakdown`` öğesi)."""

    rate: Decimal
    base: Decimal
    tax: Decimal


class VergiFabrikasi:
    """Test verisi üretir ve teardown'da tamamını ID bazlı geri alır."""

    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.coupon_ids: list[int] = []

    # ── Kullanıcılar ──────────────────────────────────────────────────────────

    async def musteri(self, *, in_zone: bool = True) -> Musteri:
        """Gerçek CLIENT + doğrulanmış telefon + teslimat adresi + gerçek JWT.

        Token `auth_headers.bearer_headers` ile üretilir: İP-3 §6'dan beri
        `auth_ver` claim'i BÜTÜN rollerde denetlenir ve değer DB'deki gerçek
        `auth_version`'dan okunur (sabit `1` yazmak, sürüm artıran bir senaryo
        eklendiği gün testi sessizce yanlış yeşile çevirirdi).

        Adres ZORUNLU: fiziksel kalemli sipariş `address_id` ister. Pin
        Adana merkezine konur ki `ship_in_zone` gerçek yoldan True çıksın.
        """
        ek = uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"ip5-{ek}@test.local",
                hashed_password="test-only",
                first_name="Vergi",
                last_name="Musteri",
                username=f"ip5{ek}",
                role_id=3,
                phone=f"+90555{ek[:7]}",
                phone_verified_at=now(),
            )
            s.add(c)
            await s.flush()
            cid = c.id
            adres = ClientAddress(
                client_id=cid,
                title="Ev",
                recipient_name="Vergi Musteri",
                phone=f"+90555{ek[:7]}",
                address_line="Test Mah. Test Sok. No:1",
                city="Adana",
                district="Seyhan" if in_zone else "Bilinmeyen",
                location_lat=Decimal("37.000000") if in_zone else Decimal("41.000000"),
                location_lng=Decimal("35.320000") if in_zone else Decimal("29.000000"),
                is_default=True,
            )
            s.add(adres)
            await s.flush()
            aid = adres.id
            await s.commit()
        self.client_ids.append(cid)
        return Musteri(
            client_id=cid,
            headers=await bearer_headers(cid, role="CLIENT", role_id=3),
            address_id=aid,
        )

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları + gerçek imzalı JWT."""
        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip5-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Vergi",
                last_name="Admin",
                username=f"va{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"IP5_{ek.upper()}",
                        name="IP5 Test Rolü",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
                )
                self.role_ids.append(rol.id)
            await s.commit()
            self.admin_ids.append(a.id)
            admin_id = a.id
        return admin_id, await bearer_headers(admin_id, role="ADMIN", role_id=1)

    # ── Katalog ───────────────────────────────────────────────────────────────

    async def urun(
        self,
        *,
        price: str = "100.00",
        tax_rate: str = "0",
        stock: int = 50,
        kind: str = "PHYSICAL",
    ) -> int:
        """Ürün + INITIAL açılış hareketi (üretim yolunun aynısı).

        ``tax_rate`` ORAN'dır (0.20 = %20), yüzde değil — model ve
        ``services/tax.py`` bu birimde çalışır.
        """
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"ip5-{uniq()}",
                title=f"IP5 Urun {uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal(price),
                tax_rate=Decimal(tax_rate),
                stock=0 if kind == "PHYSICAL" else None,
                status="ACTIVE",
                category_id=await integration_product_category_id(s),
            )
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        if kind == "PHYSICAL" and stock:
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

    async def urun_orani_degistir(self, product_id: int, tax_rate: str) -> None:
        """Ürünün KDV oranını sipariş verildikten SONRA değiştirir (M-6)."""
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET tax_rate = :r WHERE id = :i"),
                {"r": Decimal(tax_rate), "i": product_id},
            )
            await s.commit()

    async def kupon(
        self, *, discount_type: str = "FIXED", value: str = "50.00"
    ) -> tuple[int, str]:
        async with AsyncSessionLocal() as s:
            kod = f"IP5{uniq().upper()}"
            c = Coupon(
                code=kod,
                discount_type=discount_type,
                discount_value=Decimal(value),
                is_active=True,
                per_user_limit=None,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.coupon_ids.append(cid)
        return cid, kod

    # ── Sipariş (GERÇEK uç) ───────────────────────────────────────────────────

    async def siparis_ver(
        self,
        http,
        musteri: Musteri,
        *,
        items: list[tuple[int, int]],
        coupon_code: str | None = None,
        beklenen_durum: int = 201,
    ) -> dict:
        """GERÇEK ``POST /store/orders``. ``items`` = [(product_id, qty), ...].

        Yanıt gövdesini döner; sipariş id'si teardown'a kaydedilir. Beklenen
        durum kodunu doğrular ki "sipariş kurulmadı ama test devam etti" hâli
        sessizce yeşile dönmesin.
        """
        gövde = {
            "items": [{"product_id": p, "quantity": q} for p, q in items],
            "address_id": musteri.address_id,
        }
        if coupon_code:
            gövde["coupon_code"] = coupon_code
        r = await http.post("/api/v1/store/orders", json=gövde, headers=musteri.headers)
        assert r.status_code == beklenen_durum, (
            f"sipariş ucu {r.status_code} döndü (beklenen {beklenen_durum}): {r.text}"
        )
        data = r.json()
        if r.status_code == 201:
            self.order_ids.append(data["id"])
        return data

    def siparis_kaydet(self, order_id: int) -> None:
        """Fabrika dışında (ör. servis çağrısıyla) doğan siparişi teardown'a alır."""
        if order_id not in self.order_ids:
            self.order_ids.append(order_id)

    # ── Okuma yardımcıları (ham SQL — ORM kimlik haritasını atlar) ────────────

    async def siparis_vergisi(self, order_id: int) -> dict:
        """``orders`` tablosundaki vergi kırılımı — HAM okuma."""
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT subtotal, discount, shipping_fee, total, "
                        "net_total, tax_total, tax_breakdown, "
                        "shipping_tax_rate, shipping_tax_amount "
                        "FROM orders WHERE id = :i"
                    ),
                    {"i": order_id},
                )
            ).one()
        return {
            "subtotal": Decimal(str(row[0])),
            "discount": Decimal(str(row[1])),
            "shipping_fee": Decimal(str(row[2])),
            "total": Decimal(str(row[3])),
            "net_total": None if row[4] is None else Decimal(str(row[4])),
            "tax_total": None if row[5] is None else Decimal(str(row[5])),
            "tax_breakdown": row[6],
            "shipping_tax_rate": None if row[7] is None else Decimal(str(row[7])),
            "shipping_tax_amount": None if row[8] is None else Decimal(str(row[8])),
        }

    async def kalem_vergileri(self, order_id: int) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT id, product_id, unit_price, quantity, "
                        "tax_rate, tax_amount FROM order_items "
                        "WHERE order_id = :i ORDER BY id"
                    ),
                    {"i": order_id},
                )
            ).all()
        return [
            {
                "id": r[0],
                "product_id": r[1],
                "unit_price": Decimal(str(r[2])),
                "quantity": r[3],
                "tax_rate": Decimal(str(r[4])),
                "tax_amount": Decimal(str(r[5])),
            }
            for r in rows
        ]

    async def urun_orani(self, product_id: int) -> Decimal:
        async with AsyncSessionLocal() as s:
            return Decimal(
                str(
                    (
                        await s.execute(
                            text("SELECT tax_rate FROM products WHERE id = :i"),
                            {"i": product_id},
                        )
                    ).scalar_one()
                )
            )

    async def siparis_satiri(self, order_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT status, payment_status, refunded_amount, "
                        "refund_reserved, refunded_at FROM orders WHERE id = :i"
                    ),
                    {"i": order_id},
                )
            ).one()
        return {
            "status": row[0],
            "payment_status": row[1],
            "refunded_amount": Decimal(str(row[2])),
            "refund_reserved": Decimal(str(row[3])),
            "refunded_at": row[4],
        }

    async def hareketler(
        self, product_id: int, movement_type: str | None = None
    ) -> list[tuple]:
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

    async def stok(self, product_id: int) -> int | None:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT stock FROM products WHERE id = :i"),
                    {"i": product_id},
                )
            ).scalar_one()

    async def stogu_dusur(self, product_id: int, hedef: int) -> None:
        """Oversell penceresini kurmak için stoğu DEFTER ÜZERİNDEN düşürür.

        Ham ``UPDATE products SET stock`` kullanılmaz: kolonun tek yazıcısı
        defterdir ve ham yazım hem trigger sözleşmesini hem sonraki tavan
        hesaplarını (``restored_quantity_by_order_item``) bozardı.
        """
        mevcut = await self.stok(product_id)
        delta = int(hedef) - int(mevcut or 0)
        if delta == 0:
            return
        async with AsyncSessionLocal() as s:
            await stock_ledger.apply_movement(
                s,
                product_id,
                qty_delta=delta,
                bucket=stock_ledger.StockBucket.SALEABLE,
                movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
                reason_code="SAYIM_DUZELTME",
                ref_type="product",
                ref_id=product_id,
                idempotency_key=f"ip5-adj:{product_id}:{uniq()}",
                actor_type="ADMIN",
            )
            await s.commit()

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
                            "DELETE FROM order_return_items WHERE return_id = ANY(:r)"
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
                # MANUAL_REVIEW yönetici bildirimleri TÜM adminlere gider (seed
                # admin dahil); fabrikanın kendi admin id'leriyle silmek yetmez.
                await s.execute(
                    text(
                        "DELETE FROM notifications WHERE role_id = 1 AND EXISTS ("
                        "  SELECT 1 FROM unnest(CAST(:o AS int[])) AS oid "
                        "   WHERE message LIKE 'Sipariş #' || oid || ':%')"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM order_items WHERE order_id = ANY(:o)"),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM order_status_history WHERE order_id = ANY(:o)"),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM orders WHERE id = ANY(:o)"),
                    {"o": self.order_ids},
                )
            if self.coupon_ids:
                await s.execute(
                    text("DELETE FROM coupon_redemptions WHERE coupon_id = ANY(:c)"),
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
                    text("DELETE FROM client_addresses WHERE client_id = ANY(:c)"),
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
                        "DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"
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
