"""Tedarikçi senkronu testleri için gerçek veri fabrikası.

`inventory_factory.Fabrika` deseni: her satır gerçek tabloya yazılır, teardown
hepsini FİZİKSEL olarak geri alır (hijyen nöbetçisi suite öncesi/sonrası
sayıları karşılaştırıyor — `tests/integration/conftest.py::_hijyen_nobetcisi`).

İki incelik:

* Ürün stoğu **asla** constructor'da verilmez; gerçek yoldaki gibi `stock=0`
  doğar ve bakiye `INITIAL` hareketiyle deftere yazılır. Aksi halde fabrika
  defteri sessizce yalancı yapar (`inventory_factory` aynı tuzağı yaşadı).
* `supplier_products.product_id` FK'si `SET NULL`'dır; `db_guard.purge_products`
  ürünü fiziksel silince bağ satırı yetim kalır ama SİLİNMEZ — bu yüzden
  teardown önce tedarikçi satırlarını, sonra ürünleri temizler.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Product
from services import stock_ledger
from tests.integration.db_guard import purge_products
from tests.integration.product_category import integration_product_category_id


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


#: Geçerli EAN-13'ler (checksum'ları doğrulanmış) — testler barkod eşleştirmesi
#: yaptığı için UYDURMA kod kullanılamaz: bozuk barkod otomatik bağı zaten
#: engeller ve test yanlış nedenle yeşil/kırmızı olur.
GECERLI_BARKODLAR = [
    "8691217932103",
    "8695894110038",
    "9786052856475",
    "8690000999699",
    "0369176042048",
]
BOZUK_BARKOD = "8694051010124"


class Fabrika:
    def __init__(self) -> None:
        self.product_ids: list[int] = []
        #: Fabrikanın AÇTIĞI satırlar (teardown siler).
        self.supplier_ids: list[int] = []
        #: Migration seed'i — teardown tohum hâline DÖNDÜRÜR, silmez.
        self.seed_ids: list[int] = []
        self.supplier_product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.group_ids: list[int] = []

    # ── Tedarikçi ──

    async def tedarikci(
        self,
        *,
        is_enabled: bool = True,
        token: str | None = "eyJhbGciOiJIUzI1NiJ9.test-token.imza",
        stock_interval_seconds: int = 60,
        price_interval_seconds: int = 21600,
        provider: str = "yildirim",
    ) -> int:
        """Migration'ın SEED satırını test ayarlarıyla kullanır.

        Neden yeni satır AÇMIYORUZ: `uq_suppliers_provider_active` sağlayıcı
        başına tek aktif satıra izin veriyor (bilinçli — iki Yıldırım kaydı
        olsaydı hangi token'ın kullanılacağı belirsiz kalırdı).

        İlk sürüm seed'i soft-delete edip yenisini açıyordu ve teardown
        "silinmiş yildirim satırlarını geri aç" diyordu. İki test koştuğunda
        geri açma İKİ satırı birden aktif yapıp unique index'i ihlal etti:
        bütün teardown'lar patladı ve hijyen nöbetçisi 10 satırlık sızıntı
        bildirdi. Doğru çözüm seed'i YERİNDE kullanmak; teardown onu tohum
        hâline döndürür, silmez (o satır migration'ın ürünüdür).
        """
        from models.supplier import Supplier

        async with AsyncSessionLocal() as s:
            mevcut = (
                await s.execute(
                    text(
                        "SELECT id FROM suppliers "
                        "WHERE provider = :p AND deleted_at IS NULL LIMIT 1"
                    ),
                    {"p": provider},
                )
            ).scalar()
            if mevcut is None:
                sup = Supplier(
                    provider=provider,
                    name=f"Test Tedarikçi {uniq()}",
                    is_enabled=is_enabled,
                    base_url="https://ornek.test/api/vitrin",
                    api_token=token,
                    stock_interval_seconds=stock_interval_seconds,
                    price_interval_seconds=price_interval_seconds,
                )
                s.add(sup)
                await s.flush()
                sid = sup.id
                self.supplier_ids.append(sid)
            else:
                sid = int(mevcut)
                sup = await s.get(Supplier, sid)
                sup.name = f"Test Tedarikçi {uniq()}"
                sup.is_enabled = is_enabled
                sup.base_url = "https://ornek.test/api/vitrin"
                sup.api_token = token
                sup.stock_interval_seconds = stock_interval_seconds
                sup.price_interval_seconds = price_interval_seconds
                sup.next_stock_sync_at = None
                sup.next_price_sync_at = None
                sup.last_stock_sync_ok_at = None
                sup.last_price_sync_ok_at = None
                sup.last_error = None
                sup.last_error_at = None
                sup.last_sync_stats = None
                sup.consecutive_failures = 0
                sup.cooldown_until = None
                sup.token_expires_at = None
                sup.token_refreshed_at = None
                if sid not in self.seed_ids:
                    self.seed_ids.append(sid)
            await s.commit()
        return sid

    # ── Ürün ──

    async def urun(
        self,
        *,
        stock: int | None = 0,
        kind: str = "PHYSICAL",
        status: str = "ACTIVE",
        barcode: str | None = None,
        isbn: str | None = None,
        price: str = "100.00",
        supplier_backed: bool = False,
        title: str | None = None,
        variant_group_id: int | None = None,
        option1_value: str | None = None,
    ) -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"tedarikci-test-{uniq()}",
                title=title or f"Tedarikçi Testi {uniq()}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal(price),
                tax_rate=Decimal("0.20"),
                stock=None if stock is None else 0,
                status=status,
                barcode=barcode,
                isbn=isbn,
                variant_group_id=variant_group_id,
                option1_value=option1_value,
                category_id=await integration_product_category_id(s),
            )
            s.add(p)
            await s.flush()
            pid = p.id
            if supplier_backed:
                await s.execute(
                    text("UPDATE products SET supplier_backed = true WHERE id = :i"),
                    {"i": pid},
                )
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
                    idempotency_key=f"test-initial:{pid}",
                )
                await s.commit()
        return pid

    async def varyant_grubu(self, *, option1_name: str = "Renk") -> int:
        from models.store import VariantGroup

        async with AsyncSessionLocal() as s:
            g = VariantGroup(title=f"Grup {uniq()}", option1_name=option1_name)
            s.add(g)
            await s.flush()
            gid = g.id
            await s.commit()
        self.group_ids.append(gid)
        return gid

    # ── Tedarikçi ürünü ──

    async def tedarikci_urunu(
        self,
        supplier_id: int,
        *,
        external_id: int | None = None,
        barcode: str | None = None,
        stock_qty: str = "0",
        product_id: int | None = None,
        link_source: str | None = None,
        is_favorite: bool = True,
        unit_name: str = "Adet",
        cost_net: str | None = None,
        cost_gross: str | None = None,
        vat_rate: str = "0.20",
        flags: list[str] | None = None,
    ) -> int:
        from core.suppliers.barcode import validate_barcode
        from models.supplier import SupplierProduct

        async with AsyncSessionLocal() as s:
            sp = SupplierProduct(
                supplier_id=supplier_id,
                external_id=external_id if external_id is not None else _sayac(),
                external_code=f"TEST {uniq()}",
                name=f"Tedarikçi Ürünü {uniq()}",
                brand="TEST MARKA",
                category_path="KIRTASİYE > TEST",
                barcode=barcode,
                barcode_valid=bool(barcode and validate_barcode(barcode).valid),
                unit_name=unit_name,
                unit_multiplier=Decimal("1"),
                stock_qty=Decimal(stock_qty),
                stockless=Decimal(stock_qty) == 0,
                list_price=Decimal("120.00"),
                vat_rate=Decimal(vat_rate),
                cost_net=Decimal(cost_net) if cost_net else None,
                cost_gross=Decimal(cost_gross) if cost_gross else None,
                currency_ok=True,
                campaign=False,
                quarantine_flags=flags or [],
                product_id=product_id,
                link_source=link_source or ("MANUAL" if product_id else None),
                linked_at=now() if product_id else None,
                is_favorite=is_favorite,
                last_seen_at=now(),
                stock_synced_at=now(),
            )
            s.add(sp)
            await s.flush()
            spid = sp.id
            await s.commit()
        self.supplier_product_ids.append(spid)
        return spid

    # ── Aktörler ──

    async def admin(self, *, izinler: list[str] | None = None) -> int:
        """Admin satırı; `izinler` verilirse kendi rolüyle birlikte."""
        from models.admin import Admin
        from schemas.admin_access import AdminRoleCreate
        from services import admin_access_service

        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"tedarikci-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Tedarikci",
                last_name="Admin",
                username=f"ta{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            aid = a.id
            if izinler is not None:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"TS_{ek[:8].upper()}",
                        name="Tedarikci Testi",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=aid, role_id=rol.id, assigned_by_admin_id=aid
                )
                self.role_ids.append(rol.id)
            await s.commit()
        self.admin_ids.append(aid)
        return aid

    async def admin_token(self, *, izinler: list[str]) -> str:
        """Üretimdekiyle aynı sözleşmeye sahip access token (`auth_ver` dahil)."""
        from tests.integration.auth_headers import bearer_token

        aid = await self.admin(izinler=izinler)
        return await bearer_token(aid, role="ADMIN", role_id=1)

    async def musteri(self) -> int:
        from models.client import Client

        ek = uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"tedarikci-{ek}@test.local",
                hashed_password="test-only",
                first_name="Tedarikci",
                last_name="Musteri",
                username=f"tm{ek}",
                role_id=3,
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        return cid

    # ── Okuyucular ──

    async def stok(self, product_id: int) -> int | None:
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT stock FROM products WHERE id = :i"), {"i": product_id}
                )
            ).scalar_one()

    async def hareketler(self, product_id: int) -> list[tuple[str, int]]:
        async with AsyncSessionLocal() as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT movement_type, qty_delta FROM stock_movements "
                        "WHERE product_id = :i ORDER BY id"
                    ),
                    {"i": product_id},
                )
            ).all()
        return [(r[0], r[1]) for r in rows]

    async def tedarikci_satiri(self, sp_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text("SELECT * FROM supplier_products WHERE id = :i"), {"i": sp_id}
                )
            ).mappings().first()
        return dict(row) if row else {}

    async def tedarikci_durumu(self, supplier_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text("SELECT * FROM suppliers WHERE id = :i"), {"i": supplier_id}
                )
            ).mappings().first()
        return dict(row) if row else {}

    # ── Teardown ──

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
            tum_tedarikciler = self.supplier_ids + self.seed_ids
            if tum_tedarikciler:
                await s.execute(
                    text("DELETE FROM supplier_products WHERE supplier_id = ANY(:i)"),
                    {"i": tum_tedarikciler},
                )
            if self.supplier_product_ids:
                await s.execute(
                    text("DELETE FROM supplier_products WHERE id = ANY(:i)"),
                    {"i": self.supplier_product_ids},
                )
            if self.product_ids:
                await s.execute(
                    text("DELETE FROM stock_notifications WHERE product_id = ANY(:i)"),
                    {"i": self.product_ids},
                )
            # Audit izleri: hedefi silinen satırlar yetim kalır ve `audit_logs`
            # sessizce şişer (F29'da 619 satır birikti).
            for hedef in ("supplier", "supplier_product"):
                await s.execute(
                    text("DELETE FROM audit_logs WHERE target_type = :t"), {"t": hedef}
                )
            if self.supplier_ids:
                await s.execute(
                    text("DELETE FROM suppliers WHERE id = ANY(:i)"),
                    {"i": self.supplier_ids},
                )
            if self.seed_ids:
                # Seed satırı SİLİNMEZ (migration'ın ürünü) — tohum hâline
                # döndürülür. Hijyen nöbetçisi `suppliers` sayısını izliyor;
                # silmek de eklemek de sayacı kaydırırdı.
                await s.execute(
                    text(
                        "UPDATE suppliers SET is_enabled = false, api_token = NULL, "
                        "name = :ad, base_url = :url, "
                        "stock_interval_seconds = 60, price_interval_seconds = 21600, "
                        "next_stock_sync_at = NULL, next_price_sync_at = NULL, "
                        "last_stock_sync_ok_at = NULL, last_price_sync_ok_at = NULL, "
                        "last_error = NULL, last_error_at = NULL, "
                        "last_sync_stats = NULL, consecutive_failures = 0, "
                        "cooldown_until = NULL, token_expires_at = NULL, "
                        "token_updated_at = NULL, token_refreshed_at = NULL, "
                        "deleted_at = NULL "
                        "WHERE id = ANY(:i)"
                    ),
                    {
                        "i": self.seed_ids,
                        "ad": "Yıldırım Dağıtım",
                        "url": "https://b2b.yildirimdagitim.com/api/vitrin",
                    },
                )
            await s.commit()

        if self.product_ids:
            async with AsyncSessionLocal() as s:
                await purge_products(s, self.product_ids)
        async with AsyncSessionLocal() as s:
            if self.group_ids:
                await s.execute(
                    text("DELETE FROM variant_groups WHERE id = ANY(:i)"),
                    {"i": self.group_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions "
                        "WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"), {"i": self.admin_ids}
                )
            if self.client_ids:
                await s.execute(
                    text("DELETE FROM clients WHERE id = ANY(:i)"),
                    {"i": self.client_ids},
                )
            await s.commit()


_SAYAC = {"n": 700000}


def _sayac() -> int:
    _SAYAC["n"] += 1
    return _SAYAC["n"]
