"""order delivered_at (iade penceresi dayanağı)

Revision ID: b1c2d3e4f5a6
Revises: fc1f0d64a44e
Create Date: 2026-07-11 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'fc1f0d64a44e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'orders',
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Mevcut teslim edilmiş siparişler için teslim anını durum geçmişinden
    # (en güncel DELIVERED geçişi) geriye doldur — "son iade tarihi" bu siparişlerde
    # de gösterilebilsin. Geçmişi olmayanlar NULL kalır (pencere uygulanmaz).
    op.execute(
        """
        UPDATE orders o
        SET delivered_at = h.ts
        FROM (
            SELECT order_id, MAX(created_at) AS ts
            FROM order_status_history
            WHERE new_status = 'DELIVERED'
            GROUP BY order_id
        ) h
        WHERE h.order_id = o.id AND o.delivered_at IS NULL
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('orders', 'delivered_at')
