"""Tedarikçi senkronu şeması — migration (TEK KULLANIMLIK veritabanı).

`test_stock_migration_pg.py` deseni: kendi veritabanını yaratır, `upgrade` →
doğrulama → `downgrade` → tekrar `upgrade` sekansını gerçekten koşar, sonra
veritabanını siler. Dev DB'de koşmak kabul edilemez — downgrade tabloları düşürür.

## Neden CHECK'ler ayrı ayrı ölçülüyor

Alembic autogenerate **mevcut tabloya eklenen CHECK'i görmez** (kök
`backend/CLAUDE.md`; `b95b705ab859` bu yüzden elle yazıldı). Yani modelde
tanımlı bir kısıt migration'da unutulabilir ve hata SESSİZDİR: uygulama
çalışır, kural yalnız Python tarafında durur, ham SQL / CSV / seed onu deler.
Burada kısıt gerçekten **ihlal edilmeye çalışılır**.
"""
from __future__ import annotations

import datetime
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import settings

BACKEND = Path(__file__).resolve().parents[2]

DISPOSABLE_DB = "adana_tedarikci_migration_test"

#: Bu paketin revizyonu ve ondan hemen önceki head.
REVISION = "c7d2e4a9b1f3"
PREVIOUS_HEAD = "b95b705ab859"


def _base_url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


@pytest.fixture
async def migration_db():
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretimde migration testi koşulamaz")
    assert "test" in DISPOSABLE_DB
    assert DISPOSABLE_DB != settings.POSTGRES_DB

    bakim = create_async_engine(_base_url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with bakim.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await bakim.dispose()
        pytest.skip(f"Bakım veritabanına ulaşılamıyor ({exc.__class__.__name__})")

    async with bakim.connect() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}"'))
        await conn.execute(text(f'CREATE DATABASE "{DISPOSABLE_DB}"'))

    engine = create_async_engine(_base_url(DISPOSABLE_DB))
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield Session
    finally:
        await engine.dispose()
        async with bakim.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{DISPOSABLE_DB}"'))
        await bakim.dispose()


def _alembic(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "POSTGRES_DB": DISPOSABLE_DB, "AUTO_CREATE_DB": "false"}
    res = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    assert res.returncode == 0, (
        f"alembic {' '.join(args)} başarısız:\n{res.stdout}\n{res.stderr}"
    )
    return res


class Db:
    def __init__(self, Session):
        self._Session = Session

    async def scalar(self, sql: str, **params):
        async with self._Session() as s:
            return (await s.execute(text(sql), params)).scalar()

    async def exec(self, sql: str, **params):
        async with self._Session() as s:
            r = await s.execute(text(sql), params)
            await s.commit()
            return r

    async def insert_scalar(self, sql: str, **params):
        async with self._Session() as s:
            v = (await s.execute(text(sql), params)).scalar()
            await s.commit()
            return v

    async def tablo_var(self, ad: str) -> bool:
        return bool(await self.scalar("SELECT to_regclass(:a) IS NOT NULL", a=ad))

    async def kolon_var(self, tablo: str, kolon: str) -> bool:
        return bool(
            await self.scalar(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = :c",
                t=tablo,
                c=kolon,
            )
        )

    async def kisit_var(self, ad: str) -> bool:
        return bool(
            await self.scalar("SELECT 1 FROM pg_constraint WHERE conname = :a", a=ad)
        )

    async def index_var(self, ad: str) -> bool:
        return bool(
            await self.scalar("SELECT 1 FROM pg_indexes WHERE indexname = :a", a=ad)
        )

    async def kolon_tipi(self, tablo: str, kolon: str) -> str | None:
        return await self.scalar(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c",
            t=tablo,
            c=kolon,
        )


async def _tedarikci(db: Db, **kw) -> int:
    alanlar = {
        "provider": "yildirim",
        "name": "Test",
        "is_enabled": False,
        "base_url": "https://ornek.test/api/vitrin",
        "stock_interval_seconds": 60,
        "price_interval_seconds": 21600,
    }
    alanlar.update(kw)
    kolonlar = ", ".join(alanlar)
    degerler = ", ".join(f":{k}" for k in alanlar)
    return await db.insert_scalar(
        f"INSERT INTO suppliers ({kolonlar}) VALUES ({degerler}) RETURNING id",
        **alanlar,
    )


async def _urun(db: Db, *, slug: str | None = None) -> int:
    return await db.insert_scalar(
        "INSERT INTO products (slug, title, kind, seller_type, price, stock, "
        "tax_rate, status) VALUES (:slug, 'Migration Testi', 'PHYSICAL', "
        "'PLATFORM', 100.00, 0, 0.20, 'ACTIVE') RETURNING id",
        slug=slug or f"migr-{uuid.uuid4().hex[:10]}",
    )


async def test_upgrade_dogrulama_downgrade_tekrar_upgrade(migration_db):
    db = Db(migration_db)

    # ── (a) Bu paketten ÖNCEKİ head ──
    _alembic("upgrade", PREVIOUS_HEAD)
    assert not await db.tablo_var("suppliers")
    assert not await db.tablo_var("supplier_products")
    assert not await db.kolon_var("products", "supplier_backed")
    assert not await db.kolon_var("order_items", "supplier_quantity")

    # ── (b) Bu revizyona yükselt ──
    _alembic("upgrade", REVISION)
    assert await db.scalar("SELECT version_num FROM alembic_version") == REVISION

    # ── (c) Yapı ──
    assert await db.tablo_var("suppliers")
    assert await db.tablo_var("supplier_products")
    assert await db.kolon_var("products", "supplier_backed")
    assert await db.kolon_var("order_items", "supplier_quantity")

    # D-4: kesirli stok taşınabilmeli. `integer` olsaydı 12,5 sessizce 12 olurdu.
    assert await db.kolon_tipi("supplier_products", "stock_qty") == "numeric"

    # ── (d) Mevcut satırlar bozulmadan varsayılan alır ──
    pid = await _urun(db)
    assert (
        await db.scalar("SELECT supplier_backed FROM products WHERE id = :i", i=pid)
        is False
    ), "yeni kolon mevcut ürünleri sessizce tedarikçiye bağlamamalı"

    # ── (e) Yıldırım seed satırı: KAPALI ve TOKENSIZ ──
    seed = await db.scalar(
        "SELECT is_enabled, api_token IS NULL FROM suppliers "
        "WHERE provider = 'yildirim' AND deleted_at IS NULL LIMIT 1"
    )
    assert seed is False, "seed satırı yok veya AÇIK doğmuş"
    assert await db.scalar(
        "SELECT api_token IS NULL FROM suppliers "
        "WHERE provider = 'yildirim' AND deleted_at IS NULL LIMIT 1"
    ), "seed satırı token taşımamalı"

    # ── (f) Kısıtlar gerçekten var ──
    for ad in (
        "ck_suppliers_provider",
        "ck_suppliers_stock_interval",
        "ck_suppliers_price_interval",
        "ck_supplier_products_link_pairing",
        "ck_order_items_supplier_qty",
    ):
        assert await db.kisit_var(ad), f"{ad} kısıtı migration'da yok"

    for ad in (
        "uq_suppliers_provider_active",
        "uq_supplier_products_external",
        "uq_supplier_products_link",
        "ix_supplier_products_available",
    ):
        assert await db.index_var(ad), f"{ad} index'i migration'da yok"

    # ── (g) Kısıtlar İŞLİYOR mu? (varlık ≠ etki) ──
    with pytest.raises((IntegrityError, DBAPIError)):
        await _tedarikci(db, provider="baskasi", name="Yabanci")

    with pytest.raises((IntegrityError, DBAPIError)):
        await _tedarikci(db, stock_interval_seconds=10, name="Cok Sik")

    with pytest.raises((IntegrityError, DBAPIError)):
        await _tedarikci(db, price_interval_seconds=60, name="Cok Sik Fiyat")

    # Seed satırı zaten 'yildirim'; ikinci aktif satır açılamaz.
    with pytest.raises((IntegrityError, DBAPIError)):
        await _tedarikci(db, name="Ikinci Yildirim")

    # ── (h) Bağ eşleşmesi: product_id ile link_source birlikte dolar ──
    sup_id = await db.scalar(
        "SELECT id FROM suppliers WHERE provider = 'yildirim' "
        "AND deleted_at IS NULL LIMIT 1"
    )
    pid2 = await _urun(db)

    async def _sp(**kw) -> int:
        alanlar = {
            "supplier_id": sup_id,
            "external_id": int(uuid.uuid4().int % 10**8),
            "external_code": f"KOD {uuid.uuid4().hex[:6]}",
            "name": "Tedarikci Urunu",
            "stock_qty": 0,
            # asyncpg TIMESTAMPTZ için gerçek `datetime` ister; dizgi vermek
            # DataError üretir (testin ilk koşumunda yaşandı).
            "last_seen_at": datetime.datetime.now(datetime.timezone.utc),
        }
        alanlar.update(kw)
        kolonlar = ", ".join(alanlar)
        degerler = ", ".join(f":{k}" for k in alanlar)
        return await db.insert_scalar(
            f"INSERT INTO supplier_products ({kolonlar}) VALUES ({degerler}) "
            "RETURNING id",
            **alanlar,
        )

    with pytest.raises((IntegrityError, DBAPIError)):
        await _sp(product_id=pid2)  # link_source yok
    with pytest.raises((IntegrityError, DBAPIError)):
        await _sp(link_source="AUTO")  # product_id yok
    with pytest.raises((IntegrityError, DBAPIError)):
        await _sp(product_id=pid2, link_source="UYDURMA")

    bagli = await _sp(product_id=pid2, link_source="AUTO")
    assert bagli

    # Aynı ürün ikinci kez bağlanamaz.
    with pytest.raises((IntegrityError, DBAPIError)):
        await _sp(product_id=pid2, link_source="MANUAL")

    # ── (i) Kesirli stok gerçekten saklanıyor ──
    kesirli = await _sp(stock_qty=12.5)
    assert await db.scalar(
        "SELECT stock_qty FROM supplier_products WHERE id = :i", i=kesirli
    ) == 12.5

    # ── (j) Ürün fiziksel silinince bağ satırı YAŞAR, product_id NULL olur ──
    # `RESTRICT` olsaydı `db_guard.purge_products` her tedarikçi testinde patlardı.
    await db.exec("DELETE FROM products WHERE id = :i", i=pid2)
    assert (
        await db.scalar(
            "SELECT product_id FROM supplier_products WHERE id = :i", i=bagli
        )
        is None
    )

    # ── (k) supplier_quantity tavanı: quantity'yi aşamaz ──
    cid = await db.insert_scalar(
        "INSERT INTO clients (email, hashed_password, first_name, last_name, "
        "username, role_id) VALUES (:e, 'x', 'A', 'B', :u, 3) RETURNING id",
        e=f"m-{uuid.uuid4().hex[:8]}@test.local",
        u=f"m{uuid.uuid4().hex[:8]}",
    )
    oid = await db.insert_scalar(
        "INSERT INTO orders (client_id, subtotal, total, status, payment_status, "
        "track_token, has_physical) VALUES (:c, 100, 100, 'PAID', 'PAID', :t, true) "
        "RETURNING id",
        c=cid,
        t=uuid.uuid4().hex,
    )

    async def _kalem(qty: int, sq: int) -> int:
        return await db.insert_scalar(
            "INSERT INTO order_items (order_id, title, unit_price, quantity, kind, "
            "seller_type, supplier_quantity) VALUES (:o, 'K', 10, :q, 'PHYSICAL', "
            "'PLATFORM', :s) RETURNING id",
            o=oid,
            q=qty,
            s=sq,
        )

    assert await _kalem(3, 3)
    assert await _kalem(3, 0)
    with pytest.raises((IntegrityError, DBAPIError)):
        await _kalem(3, 4)
    with pytest.raises((IntegrityError, DBAPIError)):
        await _kalem(3, -1)

    # ── (l) Downgrade temiz ──
    _alembic("downgrade", PREVIOUS_HEAD)
    assert not await db.tablo_var("suppliers")
    assert not await db.tablo_var("supplier_products")
    assert not await db.kolon_var("products", "supplier_backed")
    assert not await db.kolon_var("order_items", "supplier_quantity")

    # ── (m) Tekrar upgrade (idempotent zincir) ──
    _alembic("upgrade", REVISION)
    assert await db.tablo_var("suppliers")


async def test_izinler_katalogla_ve_dbde_esit(migration_db):
    """`suppliers.*` izinleri hem katalogda hem DB'de olmalı.

    Katalogda olup DB'de olmayan izin HİÇBİR role bağlanamaz — SUPER_ADMIN
    dahil herkes 403 alır ve menü öğesi gizli olduğu için hata GÖRÜNMEZ
    (`core/admin_permissions.py` docstring'indeki hakediş defteri tuzağı)."""
    db = Db(migration_db)
    _alembic("upgrade", "head")

    async with migration_db() as s:
        kodlar = {
            r[0]
            for r in (
                await s.execute(
                    text(
                        "SELECT code FROM admin_permissions "
                        "WHERE code LIKE 'suppliers.%'"
                    )
                )
            ).all()
        }
    assert kodlar == {"suppliers.view", "suppliers.manage"}

    from core.admin_permissions import PERMISSION_CODES

    assert kodlar <= PERMISSION_CODES, (
        "DB'de olup katalogda olmayan izin var — katalog tek doğruluk kaynağı"
    )

    # SUPER_ADMIN'e gerçekten bağlanmış mı?
    bagli = await db.scalar(
        "SELECT count(*) FROM admin_role_permissions arp "
        "JOIN admin_roles r ON r.id = arp.admin_role_id "
        "JOIN admin_permissions p ON p.id = arp.permission_id "
        "WHERE r.code = 'SUPER_ADMIN' AND p.code LIKE 'suppliers.%'"
    )
    assert bagli == 2, "SUPER_ADMIN iki tedarikçi iznini de almalı"
