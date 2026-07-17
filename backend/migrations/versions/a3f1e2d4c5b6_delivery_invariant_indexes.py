"""delivery invariant indexes: tek açık durak + gün/araç başına tek planlı tur

Sipariş başına tek PENDING durak ve gün+araç başına tek PLANNED tur artık DB
otoritesinde (servisteki check-then-insert kontrolleri yarışta yetersizdi).
Index'lerden önce mevcut ihlaller onarılır: yinelenen planlı turlar iptal edilir,
iptal/iade edilmiş siparişlerin ve yinelenen açık durakların PENDING'leri
CANCELLED'a kapatılır (yeni DeliveryStopStatus.CANCELLED — kurye performans
metriği FAILED'dan ayrışır).

Revision ID: a3f1e2d4c5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-07-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f1e2d4c5b6'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1) Aynı gün+araç için birden çok PLANNED tur varsa en yenisi kalır,
    #    eskileri iptal edilir (durakları da 3. adımda kapanır).
    op.execute(
        """
        UPDATE delivery_runs r
        SET status = 'CANCELLED'
        WHERE r.status = 'PLANNED' AND r.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM delivery_runs r2
            WHERE r2.run_date = r.run_date AND r2.vehicle = r.vehicle
              AND r2.status = 'PLANNED' AND r2.deleted_at IS NULL
              AND r2.id > r.id
        )
        """
    )
    # 2) İptal/iade edilmiş siparişlerin bekleyen durakları kapanır (order_fsm
    #    artık geçişte otomatik kapatıyor; bu, eski verinin onarımı).
    op.execute(
        """
        UPDATE delivery_stops ds
        SET status = 'CANCELLED',
            courier_note = COALESCE(courier_note, 'Sipariş iptal/iade edildi (onarım)')
        FROM orders o
        WHERE ds.order_id = o.id AND ds.status = 'PENDING'
          AND o.status IN ('CANCELLED', 'REFUNDED')
        """
    )
    # 3) İptal edilen (1. adım dahil) / tamamlanmış turlarda PENDING kalamaz.
    op.execute(
        """
        UPDATE delivery_stops ds
        SET status = 'CANCELLED',
            courier_note = COALESCE(courier_note, 'Tur kapandı (onarım)')
        FROM delivery_runs r
        WHERE ds.run_id = r.id AND ds.status = 'PENDING'
          AND r.status IN ('CANCELLED', 'DONE')
        """
    )
    # 4) Hâlâ sipariş başına birden çok açık durak varsa en yenisi kalır.
    op.execute(
        """
        UPDATE delivery_stops ds
        SET status = 'CANCELLED',
            courier_note = COALESCE(courier_note, 'Yinelenen açık durak (onarım)')
        WHERE ds.status = 'PENDING' AND EXISTS (
            SELECT 1 FROM delivery_stops d2
            WHERE d2.order_id = ds.order_id AND d2.status = 'PENDING'
              AND d2.id > ds.id
        )
        """
    )
    op.create_index(
        'uq_delivery_stop_open',
        'delivery_stops',
        ['order_id'],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        'uq_delivery_run_planned',
        'delivery_runs',
        ['run_date', 'vehicle'],
        unique=True,
        postgresql_where=sa.text("status = 'PLANNED' AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    """Downgrade schema (veri onarımları geri alınmaz)."""
    op.drop_index('uq_delivery_run_planned', table_name='delivery_runs')
    op.drop_index('uq_delivery_stop_open', table_name='delivery_stops')
