"""delivery_stops.package_id — durak hangi paketi tasiyor

Bugüne kadar durak yalnız SİPARİŞE bağlıydı ve "hangi paket" sorusu sipariş
üzerinden yeniden aranıyordu (`packing_events.live_package`, `handover_scan`'in
durak sorgusu). Bir siparişin tek paketi olduğu sürece bu doğruydu.

Kısmi teslimat ("eldekini bugün gönder, kalanı temin edilince") bir siparişin
aynı anda birden çok paketi olması demektir; o noktada sipariş üzerinden
eşleşme YANLIŞ durağı bulur. Bu revizyon bağı açık hâle getirir.

Bu revizyon DAVRANIŞ DEĞİŞTİRMEZ: kolon eklenir ve mevcut duraklar için
doldurulur, kısıtlar (`uq_delivery_stop_open`, `uq_order_packages_live`) aynen
kalır — yani bugün hâlâ bir siparişin tek canlı paketi ve tek açık durağı olur.
Kısıtların gevşetilmesi ayrı bir revizyondur.

Backfill: durağın siparişinin VOID olmayan en güncel paketi. Paketi hiç olmamış
(F30 öncesi) duraklar NULL kalır — bu bir eksiklik değil, o siparişlerin
gerçeğidir.

Revision ID: d7e2f4a6c918
Revises: c5a1b9e7d3f2
Create Date: 2026-09-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7e2f4a6c918'
down_revision: Union[str, Sequence[str], None] = 'c5a1b9e7d3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BACKFILL = """
    UPDATE delivery_stops s
    SET package_id = (
        SELECT p.id FROM order_packages p
        WHERE p.order_id = s.order_id AND p.status <> 'VOID'
        ORDER BY p.id DESC LIMIT 1
    )
    WHERE s.package_id IS NULL
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'delivery_stops', sa.Column('package_id', sa.Integer(), nullable=True)
    )
    op.create_index(
        op.f('ix_delivery_stops_package_id'), 'delivery_stops', ['package_id']
    )
    op.create_foreign_key(
        'fk_delivery_stops_package_id',
        'delivery_stops',
        'order_packages',
        ['package_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.execute(_BACKFILL)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'fk_delivery_stops_package_id', 'delivery_stops', type_='foreignkey'
    )
    op.drop_index(op.f('ix_delivery_stops_package_id'), table_name='delivery_stops')
    op.drop_column('delivery_stops', 'package_id')
