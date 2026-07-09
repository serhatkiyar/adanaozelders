"""order track_token + order_status_history

Revision ID: f1a2b3c4d5e6
Revises: 34847550d537
Create Date: 2026-07-09 21:40:00.000000

Oturumsuz kargo takibi için ``orders.track_token`` (tahmin edilemez, tekil) +
sipariş durum geçiş denetim kaydı ``order_status_history``. Mevcut siparişler
için token md5(random)+id ile backfill edilir (32 hex; uuid4().hex uzunluğu).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '34847550d537'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # orders.track_token: nullable ekle → mevcut satırları backfill → NOT NULL + unique index.
    op.add_column('orders', sa.Column('track_token', sa.String(length=32), nullable=True))
    op.execute(
        "UPDATE orders SET track_token = md5(random()::text || clock_timestamp()::text || id::text) "
        "WHERE track_token IS NULL"
    )
    op.alter_column('orders', 'track_token', nullable=False)
    op.create_index(op.f('ix_orders_track_token'), 'orders', ['track_token'], unique=True)

    op.create_table(
        'order_status_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('old_status', sa.String(length=12), nullable=True),
        sa.Column('new_status', sa.String(length=12), nullable=False),
        sa.Column('changed_by', sa.String(length=60), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_order_status_history_order_id'), 'order_status_history', ['order_id'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_order_status_history_order_id'), table_name='order_status_history')
    op.drop_table('order_status_history')
    op.drop_index(op.f('ix_orders_track_token'), table_name='orders')
    op.drop_column('orders', 'track_token')
