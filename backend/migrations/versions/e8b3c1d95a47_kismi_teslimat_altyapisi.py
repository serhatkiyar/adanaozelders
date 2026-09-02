"""kismi teslimat altyapisi: paket cogullasir, kisitlar paket bazina iner

"Eldekini bugün gönder, kalanı temin edilince gönder" için bir siparişin aynı
anda birden çok paketi olabilmelidir. Bu revizyon o kapıyı açar ve açarken
korumayı ZAYIFLATMAZ.

## 1) `uq_order_packages_live` kalkıyor, yerine GERÇEK invariant geliyor

Eski index "bir siparişin tek canlı paketi olur" diyordu. Bunun koruduğu asıl
şey "aynı ürünü ikinci kez raftan alma"ydı — ama index adedi hiç saymıyordu,
yalnız ikinci paketi yasaklıyordu. Yerine gelen trigger asıl invariant'ı
dayatır:

    Σ (canlı + teslim edilmiş) expected_qty  ≤  order_items.quantity

`VOID` satırlar sayılmaz: bozulan paket fiziksel olarak geri açılmıştır, ürün
raftadır. `DELIVERED` satırlar SAYILIR — bu, uygulama katmanındaki
`_tuketilen_adetler`in V1'de fark edilmeyen kusurudur (tek paketliyken teslim
edilmiş siparişe yeni paket açılmadığı için görünmüyordu).

Trigger `order_package_items` üzerindedir (INSERT/UPDATE) ve satır bazlıdır;
`order_packages.status` değişimi tavanı yalnız GEVŞETEBİLİR (VOID) ya da
sabit tutar, sıkılaştıramaz — bu yüzden paket tablosunda trigger'a gerek yok.

## 2) Durak tekilliği paket bazına iniyor

`uq_delivery_stop_open` (sipariş başına tek açık durak) ikiye ayrılır:
paketi olan durak için paket bazında, paketi olmayan (F30 öncesi) durak için
sipariş bazında. Aynı ayrım `uq_delivery_stop_run_order` için de yapılır.
Legacy davranış birebir korunur.

## 3) Paket kökeni ve kendi teslimat sözü

`created_by` (ORDER|SPLIT) ve `origin_package_id` Trendyol'un `createdBy` /
`originPackageIds` desenidir: bir paketin nasıl doğduğu ve hangi paketten
koptuğu kaybolmaz. `promised_delivery_date` ikinci teslimatın kendi sözüdür;
NULL ise müşteriye "temin ediliyor" denir (tedarik tarihi bilinmeyebilir).

Kısmi index'ler ELLE yazıldı — autogenerate WHERE değişimini güvenilir
üretmiyor (backend/CLAUDE.md).

Revision ID: e8b3c1d95a47
Revises: d7e2f4a6c918
Create Date: 2026-09-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8b3c1d95a47'
down_revision: Union[str, Sequence[str], None] = 'd7e2f4a6c918'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: Tavana sayılmayan tek durum: bozulmuş paket (ürün rafa geri döndü).
_TAVAN_DISI = "'VOID'"

_TAVAN_FN = f"""
CREATE OR REPLACE FUNCTION order_package_items_ceiling() RETURNS trigger AS $$
DECLARE
    siparis_adet integer;
    talep_adet integer;
BEGIN
    SELECT quantity INTO siparis_adet
      FROM order_items WHERE id = NEW.order_item_id;
    IF siparis_adet IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(sum(i.expected_qty), 0) INTO talep_adet
      FROM order_package_items i
      JOIN order_packages p ON p.id = i.package_id
     WHERE i.order_item_id = NEW.order_item_id
       AND p.status NOT IN ({_TAVAN_DISI});

    IF talep_adet > siparis_adet THEN
        RAISE EXCEPTION
            'paket satiri tavani asiyor (order_item %: talep %, siparis %)',
            NEW.order_item_id, talep_adet, siparis_adet
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

_TAVAN_TRIGGER = """
CREATE CONSTRAINT TRIGGER order_package_items_ceiling_trg
AFTER INSERT OR UPDATE OF expected_qty, order_item_id, package_id
ON order_package_items
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION order_package_items_ceiling();
"""


def upgrade() -> None:
    """Upgrade schema."""
    # ── 1) Paket kökeni + kendi teslimat sözü ──
    op.add_column(
        'order_packages',
        sa.Column(
            'created_by',
            sa.String(length=10),
            nullable=False,
            server_default=sa.text("'ORDER'"),
        ),
    )
    op.add_column(
        'order_packages', sa.Column('origin_package_id', sa.Integer(), nullable=True)
    )
    op.add_column(
        'order_packages',
        sa.Column('promised_delivery_date', sa.Date(), nullable=True),
    )
    op.create_foreign_key(
        'fk_order_packages_origin',
        'order_packages',
        'order_packages',
        ['origin_package_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_check_constraint(
        'ck_order_packages_created_by',
        'order_packages',
        "created_by IN ('ORDER', 'SPLIT')",
    )

    # ── 2) Tek canlı paket kısıtı → gerçek adet tavanı ──
    op.drop_index('uq_order_packages_live', table_name='order_packages')
    op.execute(_TAVAN_FN)
    op.execute(_TAVAN_TRIGGER)

    # ── 3) Durak tekilliği paket bazına ──
    op.drop_index('uq_delivery_stop_open', table_name='delivery_stops')
    op.create_index(
        'uq_delivery_stop_open_pkg',
        'delivery_stops',
        ['package_id'],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING' AND package_id IS NOT NULL"),
    )
    op.create_index(
        'uq_delivery_stop_open',
        'delivery_stops',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING' AND package_id IS NULL"),
    )

    op.drop_constraint(
        'uq_delivery_stop_run_order', 'delivery_stops', type_='unique'
    )
    op.create_index(
        'uq_delivery_stop_run_pkg',
        'delivery_stops',
        ['run_id', 'package_id'],
        unique=True,
        postgresql_where=sa.text('package_id IS NOT NULL'),
    )
    op.create_index(
        'uq_delivery_stop_run_order',
        'delivery_stops',
        ['run_id', 'order_id'],
        unique=True,
        postgresql_where=sa.text('package_id IS NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_delivery_stop_run_order', table_name='delivery_stops')
    op.drop_index('uq_delivery_stop_run_pkg', table_name='delivery_stops')
    op.create_unique_constraint(
        'uq_delivery_stop_run_order', 'delivery_stops', ['run_id', 'order_id']
    )

    op.drop_index('uq_delivery_stop_open', table_name='delivery_stops')
    op.drop_index('uq_delivery_stop_open_pkg', table_name='delivery_stops')
    op.create_index(
        'uq_delivery_stop_open',
        'delivery_stops',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )

    op.execute(
        "DROP TRIGGER IF EXISTS order_package_items_ceiling_trg "
        "ON order_package_items"
    )
    op.execute("DROP FUNCTION IF EXISTS order_package_items_ceiling()")
    op.create_index(
        'uq_order_packages_live',
        'order_packages',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("status NOT IN ('DELIVERED', 'VOID')"),
    )

    op.drop_constraint(
        'ck_order_packages_created_by', 'order_packages', type_='check'
    )
    op.drop_constraint('fk_order_packages_origin', 'order_packages', type_='foreignkey')
    op.drop_column('order_packages', 'promised_delivery_date')
    op.drop_column('order_packages', 'origin_package_id')
    op.drop_column('order_packages', 'created_by')
