"""outbox_events tablosu + orders dağıtım kuyruğu kısmi index'i (P1 seti)

Transactional outbox: SMS/e-posta yan etkileri durum değişikliğiyle aynı
transaction'da olay olarak yazılır; main.py worker'ı gönderir (retry+backoff,
tavanında dead-letter). Kısmi index: eligible/outsourced/kapasite sayımı
sorguları açık fiziksel siparişlerle sınırlı — tablo büyüse de kuyruk hızlı.

Revision ID: d5e6f7a8b9c0
Revises: a3f1e2d4c5b6
Create Date: 2026-07-13 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'a3f1e2d4c5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'outbox_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=60), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status', sa.String(length=10), server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_outbox_pending_due',
        'outbox_events',
        ['next_attempt_at'],
        unique=False,
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        'ix_orders_fulfillment_queue',
        'orders',
        ['promised_delivery_date'],
        unique=False,
        postgresql_where=sa.text(
            "status = 'PAID' AND payment_status = 'PAID' "
            "AND has_physical AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_orders_fulfillment_queue', table_name='orders')
    op.drop_index('ix_outbox_pending_due', table_name='outbox_events')
    op.drop_table('outbox_events')
