"""Stok hareket defteri — migration ve backfill testleri (Karar 1/3/6).

## Neden ayrı ve DAHA SIKI bir güvenlik kilidi var

Bu dosya `alembic downgrade` koşar. Downgrade `stock_movements` tablosunu
düşürür — yani **gerçek defter geçmişini yok eder**. `db_guard`'ın allowlist'i
geliştirme veritabanı `ceyhandb`'yi bilinçli olarak kabul ediyor (diğer
entegrasyon testleri yalnız kendi satırlarını siliyor), ama burada o yeterli
değil: adı `test` içermeyen bir veritabanında bu testler **koşmaz**, SKIP olur.

Koşturmak için tek kullanımlık bir veritabanı verin:

    createdb adana_migration_test
    $env:POSTGRES_DB='adana_migration_test'
    python -m pytest tests/integration/test_stock_migration_pg.py -q

Paketin ilk commit'i olduğu için implementasyon yok: koşum kırmızıdır.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal

BACKEND = Path(__file__).resolve().parents[2]

#: Bu paketin revizyonu. Downgrade hedefi ve açılış hareketinin kaynağı.
REVISION = "stok_hareket_defteri_sku"


def _guard() -> None:
    """Yalnız tek kullanımlık test veritabanında koş."""
    if settings.ENVIRONMENT == "production":
        pytest.fail("Üretim veritabanında migration testi koşulamaz")
    db = (settings.POSTGRES_DB or "").lower()
    if "test" not in db:
        pytest.skip(
            f"'{db}' tek kullanımlık bir test veritabanı değil; downgrade gerçek "
            "defteri silerdi. Dosya başlığındaki kuruluma bakın."
        )


def _alembic(*args: str) -> subprocess.CompletedProcess:
    res = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert res.returncode == 0, (
        f"alembic {' '.join(args)} başarısız:\n{res.stdout}\n{res.stderr}"
    )
    return res


async def _scalar(sql: str, **params):
    async with AsyncSessionLocal() as s:
        return (await s.execute(text(sql), params)).scalar()


async def _var_mi_tablo(ad: str) -> bool:
    return bool(await _scalar("SELECT to_regclass(:a) IS NOT NULL", a=ad))


async def _var_mi_kolon(tablo: str, kolon: str) -> bool:
    return bool(
        await _scalar(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c",
            t=tablo,
            c=kolon,
        )
    )


async def _var_mi_trigger(ad: str) -> bool:
    return bool(
        await _scalar("SELECT 1 FROM pg_trigger WHERE tgname = :a AND NOT tgisinternal", a=ad)
    )


async def _var_mi_kisit(ad: str) -> bool:
    return bool(await _scalar("SELECT 1 FROM pg_constraint WHERE conname = :a", a=ad))


async def _seed_urun(*, stock: int | None, isbn: str | None = None) -> int:
    """Migration'a HAZIR olmayan (sku'suz) bir ürün üretir — backfill'in girdisi."""
    slug = f"migr-{uuid.uuid4().hex[:10]}"
    async with AsyncSessionLocal() as s:
        pid = (
            await s.execute(
                text(
                    "INSERT INTO products (slug, title, kind, seller_type, price, "
                    "stock, status, isbn, sku) VALUES (:slug, :t, 'PHYSICAL', "
                    "'PLATFORM', 100.00, :stock, 'ACTIVE', :isbn, "
                    "'FZK-000000') RETURNING id"
                ),
                {"slug": slug, "t": "Migration Testi", "stock": stock, "isbn": isbn},
            )
        ).scalar_one()
        # SKU'yu doğru değere çekmek migration'ın işi; burada geçici bir değer
        # kondu (NOT NULL). Backfill'i ölçmek için downgrade sonrası silinecek.
        await s.commit()
        return pid


# ───────────────── (a) head durumu ─────────────────

async def test_head_durumunda_yapilar_var(pg):
    _guard()
    assert await _var_mi_tablo("stock_movements")
    assert await _var_mi_kolon("products", "sku")
    assert await _var_mi_kolon("products", "barcode")
    for kolon in ("qty_delta", "qty_after", "movement_type", "reason_code",
                  "ref_type", "ref_id", "ref_line_id", "idempotency_key",
                  "actor_type", "actor_id", "note", "request_id", "created_at"):
        assert await _var_mi_kolon("stock_movements", kolon), kolon
    assert not await _var_mi_kolon("stock_movements", "deleted_at")


async def test_head_durumunda_kisitlar_ve_triggerlar_var(pg):
    _guard()
    for kisit in (
        "ck_stock_movements_type",
        "ck_stock_movements_actor_t",
        "ck_stock_movements_actor_id",
        "ck_stock_movements_delta",
        "ck_stock_movements_after",
        "ck_stock_movements_ref",
        "ck_stock_movements_refline",
        "ck_stock_movements_adjust",
        "ck_stock_movements_note",
    ):
        assert await _var_mi_kisit(kisit), kisit
    assert await _var_mi_trigger("trg_stock_movements_no_update")
    assert await _var_mi_trigger("trg_stock_movements_no_delete")


async def test_sku_not_null_ve_unique(pg):
    _guard()
    nullable = await _scalar(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = 'products' AND column_name = 'sku'"
    )
    assert nullable == "NO"
    # Tam UNIQUE (kısmi DEĞİL): SKU id'nin fonksiyonu olduğu için silinmiş
    # satırla çakışması imkânsız; tam unique daha güçlü garanti verir.
    tanim = await _scalar(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_products_sku'"
    )
    assert tanim is not None
    assert "WHERE" not in tanim.upper()


# ───────────── (b)(c)(d) downgrade → upgrade döngüsü ─────────────

async def test_downgrade_upgrade_dongusu_backfill_ve_determinizm(pg):
    """Tek testte yürüyen tam döngü.

    Aşamalar ayrı testlere bölünmedi: her aşama öncekinin şema durumuna
    bağlı ve pytest sıralamasına güvenmek kırılgan olurdu.
    """
    _guard()

    # Backfill'in ölçülebilmesi için defterde İZİ OLMAYAN ürünler.
    stoklu = await _seed_urun(stock=7)
    sifir_stoklu = await _seed_urun(stock=0)
    takipsiz = await _seed_urun(stock=None)

    # ── (b) downgrade ──
    _alembic("downgrade", "-1")
    assert not await _var_mi_tablo("stock_movements")
    assert not await _var_mi_kolon("products", "sku")
    assert not await _var_mi_kolon("products", "barcode")
    assert not await _var_mi_trigger("trg_stock_movements_no_update")
    assert not await _var_mi_trigger("trg_stock_movements_no_delete")
    # Ürün verisi bozulmadı.
    assert await _scalar("SELECT stock FROM products WHERE id = :i", i=stoklu) == 7
    assert await _scalar("SELECT count(*) FROM products WHERE id = ANY(:ids)",
                         ids=[stoklu, sifir_stoklu, takipsiz]) == 3

    # ── (c) tekrar upgrade: backfill koşar ──
    _alembic("upgrade", "head")

    sku1 = await _scalar("SELECT sku FROM products WHERE id = :i", i=stoklu)
    assert sku1 == f"FZK-{stoklu:06d}"

    # Açılış bakiyesi: stok takip edilen HER ürün için bir satır (0 dâhil).
    for pid, beklenen_delta in ((stoklu, 7), (sifir_stoklu, 0)):
        satir = (
            await _scalar(
                "SELECT count(*) FROM stock_movements WHERE product_id = :i "
                "AND movement_type = 'OPENING_BALANCE'",
                i=pid,
            )
        )
        assert satir == 1, f"ürün {pid} açılış satırı almadı"
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT qty_delta, qty_after, reason_code, ref_type, "
                        "actor_type, actor_id, idempotency_key, note, created_at "
                        "FROM stock_movements WHERE product_id = :i"
                    ),
                    {"i": pid},
                )
            ).one()
        assert row.qty_delta == beklenen_delta
        assert row.qty_after == beklenen_delta
        assert row.reason_code == "MIGRATION_OPENING"
        assert row.ref_type == "migration"
        assert row.actor_type == "SYSTEM"
        assert row.actor_id is None
        # Kaynak açıkça kayıtlı (Karar 6).
        assert REVISION in row.idempotency_key
        assert REVISION in (row.note or "")
        assert row.created_at is not None

    # stock IS NULL ürün açılış satırı ALMAZ (bilinmeyen bakiyenin defteri olmaz).
    assert await _scalar(
        "SELECT count(*) FROM stock_movements WHERE product_id = :i", i=takipsiz
    ) == 0

    # Defter son bakiyesi ürün stoğuyla aynı.
    sapma = await _scalar(
        "SELECT count(*) FROM ("
        "  SELECT p.id FROM products p JOIN ("
        "    SELECT product_id, max(id) AS son FROM stock_movements GROUP BY product_id"
        "  ) x ON x.product_id = p.id"
        "  JOIN stock_movements m ON m.id = x.son"
        "  WHERE p.stock IS DISTINCT FROM m.qty_after"
        ") y"
    )
    assert sapma == 0

    # ── (d) determinizm: ikinci döngü aynı SKU'yu üretir ──
    _alembic("downgrade", "-1")
    _alembic("upgrade", "head")
    assert await _scalar("SELECT sku FROM products WHERE id = :i", i=stoklu) == sku1
    # Açılış satırı ikinci kez de tam olarak bir (anahtar idempotent).
    assert await _scalar(
        "SELECT count(*) FROM stock_movements WHERE product_id = :i", i=stoklu
    ) == 1


# ───────────── (e) tekrarlanan ISBN migration'ı DURDURMAZ ─────────────

async def test_tekrarlanan_isbn_migrationu_durdurmaz(pg):
    """Karar 1: SKU ISBN'den üretilmiyor → ISBN tekrarı bloklayıcı değil.

    ISBN tekilliği ayrı bir veri kalitesi/iş kuralı konusudur; migration
    yalnız uyarır ve ilerler.
    """
    _guard()
    ayni = f"978{uuid.uuid4().int % 10**10:010d}"
    a = await _seed_urun(stock=1, isbn=ayni)
    b = await _seed_urun(stock=2, isbn=ayni)

    _alembic("downgrade", "-1")
    res = _alembic("upgrade", "head")   # assert içinde: returncode 0 olmalı

    assert await _scalar("SELECT sku FROM products WHERE id = :i", i=a) == f"FZK-{a:06d}"
    assert await _scalar("SELECT sku FROM products WHERE id = :i", i=b) == f"FZK-{b:06d}"
    # Uyarı görünür olmalı (sessiz geçmemeli).
    cikti = f"{res.stdout}\n{res.stderr}".lower()
    assert "isbn" in cikti
