"""Stok hareket defteri — migration ve backfill (TEK KULLANIMLIK veritabanı).

## Neden kendi veritabanını yaratıyor

Bu testler `alembic downgrade` koşar ve downgrade `stock_movements` tablosunu
düşürür — yani **gerçek defter geçmişini yok eder**. Dev DB'de (`ceyhandb`)
koşmak bu yüzden kabul edilemez.

rev. 2'de çözüm "adında `test` geçmeyen DB'de SKIP" idi; pratikte bu, resmî
test raporunda **hiç koşmamak** demekti. rev. 3'te test kendi veritabanını
yaratıp siliyor: gerçek `upgrade → doğrulama → downgrade → tekrar upgrade`
sekansı her koşumda gerçekten çalışıyor.

Bakım (`postgres`) veritabanına bağlanılamıyorsa skip olur — bu bir altyapı
yokluğudur, tasarım kaynaklı skip değildir.

Commit 2'de yeşile döndü (2 test, SKIP yok).
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import settings

BACKEND = Path(__file__).resolve().parents[2]

#: Tek kullanımlık veritabanı adı. Sabit kodlu ve içinde `test` geçiyor —
#: kaza payı bırakmamak için parametre DEĞİL.
DISPOSABLE_DB = "adana_stok_migration_test"

#: Bu paketin revizyonu ve ondan hemen önceki head.
REVISION = "stok_hareket_defteri_sku"
PREVIOUS_HEAD = "2df064134f6c"


def _base_url(dbname: str) -> str:
    return (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{dbname}"
    )


@pytest.fixture
async def migration_db():
    """Tek kullanımlık veritabanını yaratır, session fabrikası verir, siler."""
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretimde migration testi koşulamaz")
    # İkinci kilit: ad gerçekten tek kullanımlık mı?
    assert "test" in DISPOSABLE_DB, "tek kullanımlık DB adı 'test' içermeli"
    assert DISPOSABLE_DB != settings.POSTGRES_DB, (
        "tek kullanımlık DB, dev/çalışma veritabanıyla aynı olamaz"
    )

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
    """Alembic'i TEK KULLANIMLIK veritabanına karşı koşar."""
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
    """Tek kullanımlık DB üzerinde küçük sorgu yardımcıları."""

    def __init__(self, Session):
        self._Session = Session

    async def scalar(self, sql: str, **params):
        async with self._Session() as s:
            return (await s.execute(text(sql), params)).scalar()

    async def one(self, sql: str, **params):
        async with self._Session() as s:
            return (await s.execute(text(sql), params)).one()

    async def exec(self, sql: str, **params):
        async with self._Session() as s:
            r = await s.execute(text(sql), params)
            await s.commit()
            return r

    async def insert_scalar(self, sql: str, **params):
        """Yazan sorgu + `RETURNING` — **commit eder**.

        `scalar()` commit etmez (okuma yardımcısıdır); yazma için onu kullanmak
        satırın session kapanınca geri alınmasına yol açar.
        """
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
                t=tablo, c=kolon,
            )
        )

    async def trigger_var(self, ad: str) -> bool:
        return bool(
            await self.scalar(
                "SELECT 1 FROM pg_trigger WHERE tgname = :a AND NOT tgisinternal", a=ad
            )
        )

    async def kisit_var(self, ad: str) -> bool:
        return bool(await self.scalar("SELECT 1 FROM pg_constraint WHERE conname = :a", a=ad))


async def _seed_urun(db: Db, *, stock: int | None, isbn: str | None = None) -> int:
    """Bu paketten ÖNCEKİ şemada ürün üretir (sku/barcode kolonları yok)."""
    return await db.insert_scalar(
        "INSERT INTO products (slug, title, kind, seller_type, price, stock, "
        "status, isbn) VALUES (:slug, 'Migration Testi', 'PHYSICAL', 'PLATFORM', "
        "100.00, :stock, 'ACTIVE', :isbn) RETURNING id",
        slug=f"migr-{uuid.uuid4().hex[:10]}",
        stock=stock,
        isbn=isbn,
    )


# ═══════════════════════ Tam sekans (a)–(g) ═══════════════════════
#
# Aşamalar ayrı testlere bölünmedi: her aşama öncekinin şema durumuna bağlı ve
# pytest sıralamasına güvenmek kırılgan olurdu.

async def test_upgrade_dogrulama_downgrade_tekrar_upgrade(migration_db):
    db = Db(migration_db)

    # ── (a) Bu paketten ÖNCEKİ head ──
    _alembic("upgrade", PREVIOUS_HEAD)
    assert not await db.tablo_var("stock_movements")
    assert not await db.kolon_var("products", "sku")

    # ── (b) Tohum: backfill'in girdisi ──
    stoklu = await _seed_urun(db, stock=7)
    sifirli = await _seed_urun(db, stock=0)
    takipsiz = await _seed_urun(db, stock=None)
    ayni_isbn = f"978{uuid.uuid4().int % 10**10:010d}"
    isbn_a = await _seed_urun(db, stock=1, isbn=ayni_isbn)
    isbn_b = await _seed_urun(db, stock=2, isbn=ayni_isbn)

    # ── (c) upgrade head: yapı + backfill ──
    res = _alembic("upgrade", "head")

    # head doğru mu?
    assert await db.scalar("SELECT version_num FROM alembic_version") is not None
    assert REVISION in (
        _alembic("current").stdout + _alembic("current").stderr
    ), "migration head bu paketin revizyonunda değil"

    # Kolonlar
    for kolon in ("sku", "barcode"):
        assert await db.kolon_var("products", kolon), kolon
    for kolon in ("qty_delta", "qty_after", "movement_type", "reason_code",
                  "ref_type", "ref_id", "ref_line_id", "idempotency_key",
                  "actor_type", "actor_id", "note", "request_id", "created_at"):
        assert await db.kolon_var("stock_movements", kolon), kolon
    assert not await db.kolon_var("stock_movements", "deleted_at")

    # Kısıtlar
    for kisit in (
        "ck_stock_movements_type", "ck_stock_movements_actor_t",
        "ck_stock_movements_actor_id", "ck_stock_movements_delta",
        "ck_stock_movements_after", "ck_stock_movements_ref",
        "ck_stock_movements_refline", "ck_stock_movements_adjust",
        "ck_stock_movements_note",
    ):
        assert await db.kisit_var(kisit), kisit

    # Trigger'lar: 2 defter + 2 ürün
    for trg in (
        "trg_stock_movements_no_update",
        "trg_stock_movements_no_delete",
        "trg_products_sku_autofill",
        "trg_products_identity_immutable",
    ):
        assert await db.trigger_var(trg), trg

    # SKU: NOT NULL + TAM unique (kısmi DEĞİL)
    assert await db.scalar(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = 'products' AND column_name = 'sku'"
    ) == "NO"
    tanim = await db.scalar(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_products_sku'"
    )
    assert tanim is not None and "WHERE" not in tanim.upper()

    # SKU backfill
    sku1 = await db.scalar("SELECT sku FROM products WHERE id = :i", i=stoklu)
    assert sku1 == f"FZK-{stoklu:06d}"

    # Açılış bakiyesi: takip edilen HER ürün (0 dâhil), takipsiz HARİÇ
    for pid, delta in ((stoklu, 7), (sifirli, 0), (isbn_a, 1), (isbn_b, 2)):
        row = await db.one(
            "SELECT qty_delta, qty_after, movement_type, reason_code, ref_type, "
            "actor_type, actor_id, idempotency_key, note, created_at "
            "FROM stock_movements WHERE product_id = :i", i=pid,
        )
        assert row.movement_type == "OPENING_BALANCE"
        assert row.qty_delta == delta
        assert row.qty_after == delta
        assert row.reason_code == "MIGRATION_OPENING"
        assert row.ref_type == "migration"
        assert row.actor_type == "SYSTEM"
        assert row.actor_id is None
        assert REVISION in row.idempotency_key
        assert REVISION in (row.note or "")
        assert row.created_at is not None
    assert await db.scalar(
        "SELECT count(*) FROM stock_movements WHERE product_id = :i", i=takipsiz
    ) == 0

    # qty_after == products.stock (sapma yok)
    assert await db.scalar(
        "SELECT count(*) FROM products p JOIN ("
        "  SELECT product_id, max(id) AS son FROM stock_movements GROUP BY product_id"
        ") x ON x.product_id = p.id JOIN stock_movements m ON m.id = x.son "
        "WHERE p.stock IS DISTINCT FROM m.qty_after"
    ) == 0

    # ── (g) Tekrarlanan ISBN migration'ı DURDURMADI, uyardı ──
    cikti = f"{res.stdout}\n{res.stderr}".lower()
    assert "isbn" in cikti, "tekrarlanan ISBN uyarısı sessiz kalmamalı"

    # ── (d) Trigger'lar canlı çalışıyor ──
    await db.exec(
        "INSERT INTO stock_movements (product_id, qty_delta, qty_after, "
        "movement_type, reason_code, actor_type, actor_id) VALUES "
        "(:i, 1, 8, 'ADMIN_ADJUSTMENT', 'TEDARIK', 'ADMIN', 1)", i=stoklu,
    )
    with pytest.raises(Exception) as exc:
        await db.exec("UPDATE stock_movements SET note = 'x' WHERE product_id = :i", i=stoklu)
    assert "append-only" in str(exc.value).lower()
    with pytest.raises(Exception) as exc:
        await db.exec("DELETE FROM stock_movements WHERE product_id = :i", i=stoklu)
    assert "append-only" in str(exc.value).lower()

    # Ürün kimliği trigger'ları
    with pytest.raises(Exception) as exc:
        await db.exec("UPDATE products SET sku = 'FZK-999999' WHERE id = :i", i=stoklu)
    assert "sku" in str(exc.value).lower()
    with pytest.raises(Exception) as exc:
        await db.exec("UPDATE products SET kind = 'DIGITAL' WHERE id = :i", i=stoklu)
    assert "kind" in str(exc.value).lower()

    # SKU otomatik doluyor ve verilen sahte değer eziliyor
    yeni = await db.insert_scalar(
        "INSERT INTO products (slug, title, kind, seller_type, price, stock, "
        "status, sku) VALUES (:s, 'Sahte', 'DIGITAL', 'PLATFORM', 10.00, NULL, "
        "'ACTIVE', 'FZK-000001') RETURNING id",
        s=f"migr-{uuid.uuid4().hex[:10]}",
    )
    assert await db.scalar("SELECT sku FROM products WHERE id = :i", i=yeni) == f"DIJ-{yeni:06d}"

    # ── (e) downgrade ──
    _alembic("downgrade", "-1")
    assert not await db.tablo_var("stock_movements")
    assert not await db.kolon_var("products", "sku")
    assert not await db.kolon_var("products", "barcode")
    for trg in (
        "trg_stock_movements_no_update", "trg_stock_movements_no_delete",
        "trg_products_sku_autofill", "trg_products_identity_immutable",
    ):
        assert not await db.trigger_var(trg), trg
    # Ürün verisi bozulmadı. (Yukarıdaki ham `stock_movements` INSERT'i
    # `products.stock`'a DOKUNMAZ — defteri ham SQL'le beslemek stoğu
    # değiştirmez; ikisini birlikte yazan tek yer `stock_ledger`.)
    assert await db.scalar("SELECT stock FROM products WHERE id = :i", i=stoklu) == 7
    assert await db.scalar(
        "SELECT count(*) FROM products WHERE id = ANY(:ids)",
        ids=[stoklu, sifirli, takipsiz, isbn_a, isbn_b],
    ) == 5

    # ── (f) tekrar upgrade: determinizm + idempotent açılış ──
    _alembic("upgrade", "head")
    assert await db.scalar("SELECT sku FROM products WHERE id = :i", i=stoklu) == sku1
    assert await db.scalar(
        "SELECT count(*) FROM stock_movements WHERE product_id = :i", i=stoklu
    ) == 1
    # Açılış bakiyesi, upgrade ANINDAKİ gerçek stoğu yansıtır.
    assert await db.scalar(
        "SELECT qty_after FROM stock_movements WHERE product_id = :i", i=stoklu
    ) == 7


async def test_bos_veritabaninda_upgrade_head_calisir(migration_db):
    """Sıfırdan kurulum: baseline + bu paket birlikte ayağa kalkıyor."""
    db = Db(migration_db)
    _alembic("upgrade", "head")
    assert await db.tablo_var("stock_movements")
    assert await db.kolon_var("products", "sku")
    assert await db.trigger_var("trg_products_sku_autofill")
    # Boş katalogda açılış satırı da yok (backfill'in doğal sonucu).
    assert await db.scalar("SELECT count(*) FROM stock_movements") == 0
