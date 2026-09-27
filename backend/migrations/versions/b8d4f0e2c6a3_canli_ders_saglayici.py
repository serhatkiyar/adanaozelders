"""canli ders saglayici (zoom | agora paralel atama)

Revision ID: b8d4f0e2c6a3
Revises: b3d8f1a2c4e6
Create Date: 2026-09-25 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d4f0e2c6a3'
down_revision: Union[str, Sequence[str], None] = 'b3d8f1a2c4e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable, varsayılansız: eski dersler NULL kalır (okuma varsayılana düşer),
    # tablo yeniden yazılmaz.
    op.add_column('bookings', sa.Column('canli_ders_saglayici', sa.String(length=10), nullable=True))
    op.create_check_constraint(
        'ck_bookings_canli_ders_saglayici',
        'bookings',
        "canli_ders_saglayici IS NULL OR canli_ders_saglayici IN ('zoom', 'agora')",
    )
    op.create_index(
        'ix_bookings_canli_ders_saglayici_start',
        'bookings',
        ['canli_ders_saglayici', 'start_at'],
        unique=False,
        postgresql_where=sa.text('canli_ders_saglayici IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index(
        'ix_bookings_canli_ders_saglayici_start',
        table_name='bookings',
        postgresql_where=sa.text('canli_ders_saglayici IS NOT NULL'),
    )
    op.drop_constraint('ck_bookings_canli_ders_saglayici', 'bookings', type_='check')
    op.drop_column('bookings', 'canli_ders_saglayici')
