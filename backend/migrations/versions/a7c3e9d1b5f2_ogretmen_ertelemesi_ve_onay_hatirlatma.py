"""ogretmen ertelemesi ve onay hatirlatma

Revision ID: a7c3e9d1b5f2
Revises: 6e45a5bd17b7
Create Date: 2026-09-24 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c3e9d1b5f2'
down_revision: Union[str, Sequence[str], None] = '6e45a5bd17b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bookings', sa.Column('tutor_rescheduled_from', sa.DateTime(timezone=True), nullable=True))
    op.add_column('bookings', sa.Column('confirm_reminded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('bookings', 'confirm_reminded_at')
    op.drop_column('bookings', 'tutor_rescheduled_from')
