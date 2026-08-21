"""tedarikçi senkronu: suppliers + supplier_products + iki kolon

Sözleşme: `docs/tedarikci-senkron-sozlesme.md` §4.

Autogenerate'in KAÇIRDIKLARI burada elle yazıldı (bkz. `backend/CLAUDE.md`):

* mevcut tabloya eklenen CHECK'ler (`ck_order_items_supplier_qty`) —
  autogenerate `add_column` görür, kısıtı görmez;
* kısmi (partial) index'lerin `postgresql_where` ifadeleri gözden geçirildi;
* Yıldırım seed satırı.

**Seed KAPALI ve TOKENSIZ doğar.** Gerekçe: migration bir yapılandırma anı
değildir. Açık doğsaydı, migration'ın koştuğu her ortam (CI, geliştirici
makinesi, staging) tedarikçi tablosunda "etkin" bir satır bulur ve arka plan
döngüsü token arar. Satırın var olması yalnız panelde düzenlenecek bir kayıt
hazır bulunsun diyedir.

Revision ID: c7d2e4a9b1f3
Revises: b95b705ab859
Create Date: 2026-08-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c7d2e4a9b1f3"
down_revision: Union[str, Sequence[str], None] = "b95b705ab859"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ══════════ suppliers ══════════
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "is_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("base_url", sa.String(length=255), nullable=False),
        # Şifreli token: Fernet çıktısı 1000 karakteri aşabilir → TEXT.
        sa.Column("api_token", sa.Text(), nullable=True),
        sa.Column("token_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "stock_interval_seconds",
            sa.Integer(),
            server_default=sa.text("60"),
            nullable=False,
        ),
        sa.Column(
            "price_interval_seconds",
            sa.Integer(),
            server_default=sa.text("21600"),
            nullable=False,
        ),
        sa.Column("next_stock_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_price_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_stock_sync_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_price_sync_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_sync_stats", postgresql.JSONB(), nullable=True),
        sa.Column(
            "consecutive_failures",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("provider IN ('yildirim')", name="ck_suppliers_provider"),
        sa.CheckConstraint(
            "stock_interval_seconds >= 30", name="ck_suppliers_stock_interval"
        ),
        sa.CheckConstraint(
            "price_interval_seconds >= 3600", name="ck_suppliers_price_interval"
        ),
        sa.CheckConstraint(
            "consecutive_failures >= 0", name="ck_suppliers_failure_count"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_suppliers_provider_active",
        "suppliers",
        ["provider"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ══════════ supplier_products ══════════
    op.create_table(
        "supplier_products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.Integer(), nullable=False),
        sa.Column("external_code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=250), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("category_path", sa.String(length=300), nullable=True),
        sa.Column("barcode", sa.String(length=32), nullable=True),
        sa.Column(
            "barcode_valid",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("unit_name", sa.String(length=40), nullable=True),
        sa.Column("unit_multiplier", sa.Numeric(precision=10, scale=3), nullable=True),
        sa.Column("min_order", sa.Numeric(precision=10, scale=3), nullable=True),
        # NUMERIC: kesirli stok ölçüldü (12.5). INTEGER olsaydı sessizce 12.
        sa.Column(
            "stock_qty",
            sa.Numeric(precision=12, scale=3),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "stockless", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("stock_status", sa.String(length=40), nullable=True),
        sa.Column("list_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("vat_rate", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("cost_net", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("cost_gross", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("cost_breakdown_name", sa.String(length=80), nullable=True),
        sa.Column(
            "currency_ok", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "campaign", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "quarantine_flags",
            postgresql.ARRAY(sa.String(length=40)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        sa.Column("image_url", sa.String(length=300), nullable=True),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("link_source", sa.String(length=10), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("linked_by_admin_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_favorite", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("unfavorited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stock_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "link_source IS NULL OR link_source IN ('AUTO', 'MANUAL')",
            name="ck_supplier_products_link_source",
        ),
        sa.CheckConstraint(
            "(product_id IS NULL) = (link_source IS NULL)",
            name="ck_supplier_products_link_pairing",
        ),
        sa.CheckConstraint("stock_qty >= 0", name="ck_supplier_products_stock_sign"),
        sa.ForeignKeyConstraint(
            ["supplier_id"], ["suppliers.id"], ondelete="CASCADE"
        ),
        # SET NULL: test izolasyonu ürünleri FİZİKSEL siliyor (db_guard).
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["linked_by_admin_id"], ["admins.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_supplier_products_external",
        "supplier_products",
        ["supplier_id", "external_id"],
        unique=True,
    )
    op.create_index(
        "ix_supplier_products_code",
        "supplier_products",
        ["supplier_id", "external_code"],
    )
    op.create_index(
        "ix_supplier_products_barcode",
        "supplier_products",
        ["barcode"],
        postgresql_where=sa.text("barcode IS NOT NULL"),
    )
    op.create_index(
        "uq_supplier_products_link",
        "supplier_products",
        ["supplier_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )
    op.create_index(
        "ix_supplier_products_available",
        "supplier_products",
        ["product_id"],
        postgresql_where=sa.text(
            "product_id IS NOT NULL AND is_favorite AND stock_qty >= 1"
        ),
    )

    # ══════════ products.supplier_backed ══════════
    op.add_column(
        "products",
        sa.Column(
            "supplier_backed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_products_supplier_backed",
        "products",
        ["supplier_backed"],
        postgresql_where=sa.text("supplier_backed AND deleted_at IS NULL"),
    )

    # ══════════ order_items.supplier_quantity ══════════
    op.add_column(
        "order_items",
        sa.Column(
            "supplier_quantity",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    # Autogenerate mevcut tabloya eklenen CHECK'i GÖRMEZ — elle.
    op.create_check_constraint(
        "ck_order_items_supplier_qty",
        "order_items",
        "supplier_quantity >= 0 AND supplier_quantity <= quantity",
    )

    # ══════════ Yıldırım seed satırı (KAPALI, TOKENSIZ) ══════════
    op.execute(
        """
        INSERT INTO suppliers (provider, name, is_enabled, base_url)
        SELECT 'yildirim', 'Yıldırım Dağıtım', false,
               'https://b2b.yildirimdagitim.com/api/vitrin'
        WHERE NOT EXISTS (
            SELECT 1 FROM suppliers
            WHERE provider = 'yildirim' AND deleted_at IS NULL
        )
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_order_items_supplier_qty", "order_items", type_="check"
    )
    op.drop_column("order_items", "supplier_quantity")
    op.drop_index("ix_products_supplier_backed", table_name="products")
    op.drop_column("products", "supplier_backed")
    op.drop_index("ix_supplier_products_available", table_name="supplier_products")
    op.drop_index("uq_supplier_products_link", table_name="supplier_products")
    op.drop_index("ix_supplier_products_barcode", table_name="supplier_products")
    op.drop_index("ix_supplier_products_code", table_name="supplier_products")
    op.drop_index("uq_supplier_products_external", table_name="supplier_products")
    op.drop_table("supplier_products")
    op.drop_index("uq_suppliers_provider_active", table_name="suppliers")
    op.drop_table("suppliers")
