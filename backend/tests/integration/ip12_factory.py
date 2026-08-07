"""İP-12 fabrikası — mağaza panel yüzeyi (ürün listesi / arama / filtreler).

Neden ayrı bir fabrika: İP-5'in `VergiFabrikasi`'sı **para** yolunu kurar
(sipariş, kupon, adres, KDV). Bu paketin ihtiyacı bambaşka — **kitap künyesi**
taşıyan katalog satırları (yazar / yayınevi / ISBN / stok / durum) ve onları
listeleyen admin. Vergi fabrikasına künye alanı eklemek, iki paketin fixture'ını
birbirine bağlar ve İP-5'in sözleşmesini bu paketin ihtiyacına göre kaydırırdı.

Teardown testin sonucundan BAĞIMSIZ koşar ve yalnız fabrikanın kendi kaydettiği
ID'lerle çalışır: global TRUNCATE yok, `deleted_at` ile gizleme yok. Ürünler
`db_guard.purge_products` ile FİZİKSEL silinir (defter satırları append-only
trigger'ıyla korunduğu için doğrudan DELETE reddedilir).
"""
from __future__ import annotations

import dataclasses
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from models.store import Product
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, stock_ledger
from tests.integration.auth_headers import bearer_headers
from tests.integration.db_guard import purge_products


@pytest.fixture
async def fab12(pg):
    f = PanelFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def uniq() -> str:
    return uuid.uuid4().hex[:10]


@dataclasses.dataclass
class Kitap:
    """Bir katalog satırının testin ihtiyaç duyduğu kimlikleri.

    `sku` DB'den OKUNUR, test tarafından üretilmez: değeri BEFORE INSERT
    trigger'ı (`products_sku_autofill`) yazar ve verilen değer ezilir. Testin
    kendi uydurduğu bir SKU ile arama yapmak, üretimde var olmayan bir kimliği
    doğrulamak olurdu.
    """

    id: int
    sku: str
    slug: str
    title: str
    isbn: str | None
    author: str | None
    publisher: str | None
    stock: int | None


class PanelFabrikasi:
    def __init__(self) -> None:
        self.product_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    # ── Yönetici ─────────────────────────────────────────────────────────────

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları + gerçek imzalı JWT.

        Dependency override YOK: uçların izin kararı üretimdeki yoldan
        (`require_admin_permission`) çözülür.
        """
        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"ip12-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Panel",
                last_name="Admin",
                username=f"pa{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"IP12_{ek.upper()}",
                        name="IP12 Test Rolü",
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

    # ── Katalog ──────────────────────────────────────────────────────────────

    async def kitap(
        self,
        *,
        title: str | None = None,
        author: str | None = None,
        publisher: str | None = None,
        isbn: str | None = None,
        barcode: str | None = None,
        stock: int = 10,
        price: str = "100.00",
        status: str = "ACTIVE",
        kind: str = "PHYSICAL",
    ) -> Kitap:
        """Kitap künyeli ürün + INITIAL açılış hareketi (üretim yolunun aynısı).

        Stok doğrudan `products.stock`'a yazılmaz: defter üzerinden işlenir,
        çünkü üretimde stok defterin türevidir. Doğrudan yazmak, stok
        filtrelerini defterle tutarsız bir durum üzerinde test etmek olurdu.
        """
        ek = uniq()
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"ip12-{ek}",
                title=title or f"IP12 Kitap {ek}",
                kind=kind,
                seller_type="PLATFORM",
                price=Decimal(price),
                stock=0 if kind == "PHYSICAL" else None,
                status=status,
                author=author,
                publisher=publisher,
                isbn=isbn,
                barcode=barcode,
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

        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text("SELECT sku, slug, title, stock FROM products WHERE id = :i"),
                    {"i": pid},
                )
            ).first()
        return Kitap(
            id=pid,
            sku=row[0],
            slug=row[1],
            title=row[2],
            isbn=isbn,
            author=author,
            publisher=publisher,
            stock=row[3],
        )

    # ── Temizlik ─────────────────────────────────────────────────────────────

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.product_ids:
                await purge_products(s, self.product_ids)
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments "
                        "WHERE admin_role_id = ANY(:r)"
                    ),
                    {"r": self.role_ids},
                )
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
                # Aktör kolonu `actor_id` + `actor_role` çiftidir (birleşik
                # kullanıcı tablosu olmadığı için rol ayrıca taşınır) ve
                # `actor_role` INTEGER'dır (role_id: 1=ADMIN) -- metin değil.
                # Rolü daraltmazsak aynı id'li bir TUTOR/CLIENT kaydını
                # silerdik. Bu paketin testleri yalnız GET çağırdığı için
                # bugün audit üretmiyor; temizlik savunmacıdır.
                await s.execute(
                    text(
                        "DELETE FROM audit_logs "
                        "WHERE actor_role = 1 AND actor_id = ANY(:a)"
                    ),
                    {"a": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            await s.commit()
