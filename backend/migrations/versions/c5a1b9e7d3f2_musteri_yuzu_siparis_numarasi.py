"""musteri yuzu kalici siparis numarasi (orders.order_no)

Müşteriye bugüne kadar ham `#{order.id}` gösteriliyordu; sıralı olduğu için
sipariş hacmini dışarıya sızdırıyordu. `tracking_no` de yerine geçemez —
`ELDEN-R{run}-S{stop}` biçimindedir ve her başarısız teslimat denemesinde
`None`'lanıp yeniden atanır (delivery_service: cancel_run/fail_stop/remove_stop,
order_service.postpone_delivery), yani kalıcı bir referans değildir.

Biçim `4827-1930-5612` (Amazon'un gruplanmış sipariş numarası deseni); üretim
`core.order_no.generate_order_no`.

Backfill deseni: kolon **volatile DEFAULT ile** eklenir. PostgreSQL, default
ifadesi volatile olduğunda tabloyu yeniden yazar ve ifadeyi SATIR BAŞINA
değerlendirir — mevcut her sipariş kendi numarasını alır. Ardından default
düşürülür (model tarafında `server_default` yok, `alembic check` eşitliği).

Neden ayrı UPDATE değil: `UPDATE` + aynı transaction'da `SET NOT NULL`,
Postgres'te "cannot ALTER TABLE ... pending trigger events" ile düşüyor
(ölçüldü). Volatile default yolu bu sırayı tamamen ortadan kaldırır.

Backfill geri alınamaz veri yazımıdır: `downgrade` kolonu düşürür, numaralar
kaybolur.

Revision ID: c5a1b9e7d3f2
Revises: a94d3c07be21
Create Date: 2026-09-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5a1b9e7d3f2'
down_revision: Union[str, Sequence[str], None] = 'a94d3c07be21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# `core.order_no.generate_order_no`'nun SQL karşılığı: 3 x 4 hane, satır başına
# yeniden değerlendirilir (Postgres `random()` set-returning bağlamda satır
# bazlıdır — tüm tabloya tek numara yazılmaz).
_RANDOM_NO = (
    "lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || "
    "lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || "
    "lpad((floor(random() * 10000))::int::text, 4, '0')"
)

# Unique index'ten ÖNCE çakışanları temizle: rastgele üretimde aynı numaranın
# iki kez düşmesi mümkündür ve index'i tek seferde kurmak migration'ı patlatır.
_DEDUPE = f"""
    UPDATE orders SET order_no = {_RANDOM_NO}
    WHERE id IN (
        SELECT id FROM (
            SELECT id, row_number() OVER (
                PARTITION BY order_no ORDER BY id
            ) AS sira FROM orders
        ) t WHERE t.sira > 1
    )
"""


def upgrade() -> None:
    """Upgrade schema."""
    # Volatile default → tablo yeniden yazılır, her satır KENDİ numarasını alır.
    op.execute(
        "ALTER TABLE orders ADD COLUMN order_no varchar(14) "
        f"NOT NULL DEFAULT ({_RANDOM_NO})"
    )
    # Numara uygulamada üretilir; kolonda kalıcı default bırakılmaz.
    op.execute("ALTER TABLE orders ALTER COLUMN order_no DROP DEFAULT")

    # Pratikte ilk turda biter; tavan sonsuz döngüye karşıdır.
    bind = op.get_bind()
    for _ in range(10):
        if bind.execute(sa.text(_DEDUPE)).rowcount == 0:
            break

    op.create_index(
        op.f('ix_orders_order_no'), 'orders', ['order_no'], unique=True
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_orders_order_no'), table_name='orders')
    op.drop_column('orders', 'order_no')
