"""booking payment_channel (takvim randevusu)

Revision ID: b3d8f1a2c4e6
Revises: a7c3e9d1b5f2
Create Date: 2026-09-26 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d8f1a2c4e6'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9d1b5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL = henüz kabul edilmedi. Backfill yok: bu kolondan önce hiçbir ders
    # pazaryeri kolu kapalıyken kabul edilemiyordu.
    op.add_column('bookings', sa.Column('payment_channel', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('bookings', 'payment_channel')
