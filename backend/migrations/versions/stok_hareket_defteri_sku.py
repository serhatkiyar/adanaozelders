"""stok hareket defteri + sku/barcode

Revision ID: stok_hareket_defteri_sku
Revises: 2df064134f6c
Create Date: 2026-07-30

`products.stock` alanını açıklanabilir, denetlenebilir ve eşzamanlı işlemlerde
güvenilir hâle getirir. Ayrıntılı gerekçe: docs/stok-hareket-defteri-plani.md

## Sıra kritiktir

1. `sku`/`barcode` kolonları (nullable) → 2. SKU backfill (UPDATE) →
3. `NOT NULL` + unique index'ler → 4. **sonra** trigger'lar.

Trigger'lar backfill'den ÖNCE kurulsaydı `products_identity_immutable`
backfill'in kendi UPDATE'ini reddederdi.

## Tekrarlanan ISBN migration'ı DURDURMAZ

SKU ISBN'den üretilmiyor (`(kind, id)`'nin fonksiyonu), dolayısıyla tekrarlanan
ISBN bu migration için bloklayıcı değil. Yalnız **uyarı** basılır; ISBN
tekilliği ayrı bir veri kalitesi + iş kuralı konusudur ve zorlayıcı bir kısıt
(unique index) burada eklenmez — hangi durumda aynı ISBN'in meşru olduğu
(farklı ciltleme, set içi kitap, yeniden basım) bir iş kararıdır.

## Downgrade

Önce trigger'lar, sonra tablo/index/kolonlar düşürülür. Tabloyu düşürmek defter
geçmişini **yok eder**; bu yüzden downgrade son seçenektir (rollback stratejisi
ileri düzeltmeyi tercih eder).
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "stok_hareket_defteri_sku"
down_revision: Union[str, Sequence[str], None] = "2df064134f6c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: SKU formülü tek yerde: backfill ve trigger AYNI ifadeyi kullanır, ayrışamaz.
_SKU_EXPR = (
    "(CASE {t}.kind WHEN 'PHYSICAL' THEN 'FZK-' ELSE 'DIJ-' END) "
    "|| lpad({t}.id::text, 6, '0')"
)


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Kolonlar (önce nullable) ──
    op.add_column("products", sa.Column("sku", sa.String(length=20), nullable=True))
    op.add_column("products", sa.Column("barcode", sa.String(length=32), nullable=True))

    # ── 2. SKU backfill — deterministik, sequence'sız, soft-delete'liler DÂHİL ──
    # Silinmiş satırlar da doldurulur: NOT NULL için gerekli ve geçmişin
    # okunabilirliği için doğru.
    conn.execute(sa.text(f"UPDATE products SET sku = {_SKU_EXPR.format(t='products')}"))

    # ── 3. Tekrarlanan aktif ISBN: UYAR, DURDURMA ──
    tekrar = conn.execute(
        sa.text(
            "SELECT count(*) FROM (SELECT isbn FROM products "
            "WHERE isbn IS NOT NULL AND deleted_at IS NULL "
            "GROUP BY isbn HAVING count(*) > 1) x"
        )
    ).scalar_one()
    if tekrar:
        ornekler = conn.execute(
            sa.text(
                "SELECT isbn, count(*) AS n FROM products "
                "WHERE isbn IS NOT NULL AND deleted_at IS NULL "
                "GROUP BY isbn HAVING count(*) > 1 ORDER BY n DESC LIMIT 10"
            )
        ).all()
        print(
            f"[stok-defteri] UYARI: {tekrar} adet tekrarlanan aktif ISBN grubu var. "
            "SKU ISBN'den uretilmedigi icin migration DURDURULMADI; ISBN tekilligi "
            "ayri bir veri kalitesi/is kurali konusudur. "
            f"Ornekler: {[(r.isbn, r.n) for r in ornekler]}"
        )

    # ── 4. NOT NULL + tekillik ──
    op.alter_column("products", "sku", nullable=False)
    # TAM unique (kısmi DEĞİL): SKU `id`'nin fonksiyonu → silinmiş satırla
    # çakışması imkânsız; tam unique daha güçlü garanti verir.
    op.create_index("uq_products_sku", "products", ["sku"], unique=True)
    op.create_index(
        "uq_products_barcode_active",
        "products",
        ["barcode"],
        unique=True,
        postgresql_where=sa.text("barcode IS NOT NULL AND deleted_at IS NULL"),
    )

    # ── 5. Defter tablosu ──
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("qty_delta", sa.Integer(), nullable=False),
        sa.Column("qty_after", sa.Integer(), nullable=False),
        sa.Column("movement_type", sa.String(length=20), nullable=False),
        sa.Column("reason_code", sa.String(length=30), nullable=False),
        sa.Column("ref_type", sa.String(length=20), nullable=True),
        sa.Column("ref_id", sa.Integer(), nullable=True),
        sa.Column("ref_line_id", sa.Integer(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=160), nullable=True),
        sa.Column("actor_type", sa.String(length=10), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "movement_type IN ('OPENING_BALANCE','INITIAL','SALE','SALE_CANCEL',"
            "'RETURN','ADMIN_ADJUSTMENT')",
            name="ck_stock_movements_type",
        ),
        sa.CheckConstraint(
            "actor_type IN ('SYSTEM','ADMIN')", name="ck_stock_movements_actor_t"
        ),
        sa.CheckConstraint(
            "actor_type <> 'ADMIN' OR actor_id IS NOT NULL",
            name="ck_stock_movements_actor_id",
        ),
        sa.CheckConstraint(
            "qty_delta <> 0 OR movement_type = 'OPENING_BALANCE'",
            name="ck_stock_movements_delta",
        ),
        sa.CheckConstraint("qty_after >= 0", name="ck_stock_movements_after"),
        sa.CheckConstraint(
            "movement_type NOT IN ('SALE','SALE_CANCEL','RETURN') "
            "OR (ref_type IS NOT NULL AND ref_id IS NOT NULL)",
            name="ck_stock_movements_ref",
        ),
        sa.CheckConstraint(
            "movement_type <> 'RETURN' OR ref_line_id IS NOT NULL",
            name="ck_stock_movements_refline",
        ),
        sa.CheckConstraint(
            "movement_type <> 'ADMIN_ADJUSTMENT' OR reason_code IN "
            "('SAYIM_FARKI','HASAR','KAYIP','HATALI_GIRIS','TEDARIK','DIGER')",
            name="ck_stock_movements_adjust",
        ),
        sa.CheckConstraint(
            "reason_code <> 'DIGER' OR (note IS NOT NULL AND length(btrim(note)) > 0)",
            name="ck_stock_movements_note",
        ),
    )
    op.create_index(
        "ix_stock_movements_product_id", "stock_movements", ["product_id"]
    )
    op.create_index(
        "ix_stock_movements_product",
        "stock_movements",
        ["product_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    # UNIQUE DEĞİL: bir sipariş çok ürün, bir iade çok satır taşır.
    op.create_index("ix_stock_movements_ref", "stock_movements", ["ref_type", "ref_id"])
    op.create_index(
        "uq_stock_movements_idem", "stock_movements", ["idempotency_key"], unique=True
    )

    # ── 6. Açılış bakiyesi (BACKFILL) ──
    # `stock IS NOT NULL` olan HER ürün (soft-delete'liler dâhil, stoğu 0 olanlar
    # dâhil) bir satır alır: zincirin tabanı her takip edilen ürün için var olmalı.
    # `stock IS NULL` = "takip edilmiyor" → satır YAZILMAZ.
    # `created_at = now()`: defterin bilgisi bugün başlar, geçmiş tarih UYDURULMAZ.
    # `idempotency_key` revizyonu taşır: downgrade + upgrade döngüsünde aynı
    # anahtar yeniden üretilir ve unique index çift satırı reddeder.
    # `ON CONFLICT DO NOTHING` bilinçli olarak KULLANILMADI (bu paketin genel
    # kuralı) — zaten gerekmiyor: tablo bu migration'da oluşturuluyor, yani bu
    # INSERT anında kesinlikle boş.
    conn.execute(
        sa.text(
            "INSERT INTO stock_movements (product_id, qty_delta, qty_after, "
            "movement_type, reason_code, ref_type, ref_id, idempotency_key, "
            "actor_type, actor_id, note, created_at) "
            "SELECT p.id, p.stock, p.stock, 'OPENING_BALANCE', 'MIGRATION_OPENING', "
            "'migration', NULL, :pre || p.id::text, 'SYSTEM', NULL, :note, now() "
            "FROM products p WHERE p.stock IS NOT NULL"
        ),
        {
            "pre": f"migration:{revision}:product:",
            "note": (
                f"Alembic {revision} — stok defteri devreye alınmadan önceki "
                "mevcut bakiye (açılış)"
            ),
        },
    )

    # ── 7. Trigger'lar (backfill'den SONRA) ──
    # 7a. Defter append-only: UPDATE ve DELETE reddedilir.
    #     TRUNCATE bilinçli olarak engellenmiyor: ORM'den erişilemez, tablo
    #     sahibi gerektirir ve bir kaçış kapısı olarak kalması, uygulamanın
    #     yanlışlıkla açabileceği bir arka kapı (ör. `current_setting` bypass'ı)
    #     eklemekten daha güvenli.
    op.execute(
        """
        CREATE FUNCTION stock_movements_immutable() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'stock_movements append-only tablodur: % reddedildi', TG_OP;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements "
        "FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable()"
    )
    op.execute(
        "CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements "
        "FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable()"
    )

    # 7b. SKU'yu INSERT anında üret. `BEFORE INSERT ROW` çalıştığında kolon
    #     default'ları uygulanmıştır → `NEW.id` doludur. Verilen değer EZİLİR:
    #     SKU taklit edilemez ve her yazıcı (ORM, migration, seed, ham SQL)
    #     doğru değeri otomatik alır (NOT NULL her yerde tutar).
    op.execute(
        f"""
        CREATE FUNCTION products_sku_autofill() RETURNS trigger AS $$
        BEGIN
          NEW.sku := {_SKU_EXPR.format(t='NEW')};
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_products_sku_autofill BEFORE INSERT ON products "
        "FOR EACH ROW EXECUTE FUNCTION products_sku_autofill()"
    )

    # 7c. `sku` ve `kind` değiştirilemez. SKU immutable olmak zorunda; öneği
    #     `kind`'e bağlı olduğu için `kind` de sabit kalmalı, aksi hâlde SKU
    #     sessizce yalan söyler.
    op.execute(
        """
        CREATE FUNCTION products_identity_immutable() RETURNS trigger AS $$
        BEGIN
          IF NEW.sku IS DISTINCT FROM OLD.sku THEN
            RAISE EXCEPTION 'products.sku degistirilemez (urun kimligi): % -> %',
              OLD.sku, NEW.sku;
          END IF;
          IF NEW.kind IS DISTINCT FROM OLD.kind THEN
            RAISE EXCEPTION 'products.kind degistirilemez (SKU onegi buna bagli): % -> %',
              OLD.kind, NEW.kind;
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_products_identity_immutable BEFORE UPDATE ON products "
        "FOR EACH ROW EXECUTE FUNCTION products_identity_immutable()"
    )


def downgrade() -> None:
    # ÖNCE trigger'lar: tablo/kolon düşürmeden önce kalkmaları gerekir.
    op.execute("DROP TRIGGER IF EXISTS trg_products_identity_immutable ON products")
    op.execute("DROP FUNCTION IF EXISTS products_identity_immutable()")
    op.execute("DROP TRIGGER IF EXISTS trg_products_sku_autofill ON products")
    op.execute("DROP FUNCTION IF EXISTS products_sku_autofill()")
    op.execute("DROP TRIGGER IF EXISTS trg_stock_movements_no_delete ON stock_movements")
    op.execute("DROP TRIGGER IF EXISTS trg_stock_movements_no_update ON stock_movements")
    op.execute("DROP FUNCTION IF EXISTS stock_movements_immutable()")

    op.drop_index("uq_stock_movements_idem", table_name="stock_movements")
    op.drop_index("ix_stock_movements_ref", table_name="stock_movements")
    op.drop_index("ix_stock_movements_product", table_name="stock_movements")
    op.drop_index("ix_stock_movements_product_id", table_name="stock_movements")
    op.drop_table("stock_movements")

    op.drop_index("uq_products_barcode_active", table_name="products")
    op.drop_index("uq_products_sku", table_name="products")
    op.drop_column("products", "barcode")
    op.drop_column("products", "sku")
