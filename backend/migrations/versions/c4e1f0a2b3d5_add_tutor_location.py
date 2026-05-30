"""Add tutor base location (lat/lng/text)

Revision ID: c4e1f0a2b3d5
Revises: b7f3a9c2d1e0
Create Date: 2026-05-30 06:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e1f0a2b3d5'
down_revision: Union[str, Sequence[str], None] = 'b7f3a9c2d1e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tutors', sa.Column('location_text', sa.String(length=300), nullable=True))
    op.add_column('tutors', sa.Column('location_lat', sa.Numeric(9, 6), nullable=True))
    op.add_column('tutors', sa.Column('location_lng', sa.Numeric(9, 6), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tutors', 'location_lng')
    op.drop_column('tutors', 'location_lat')
    op.drop_column('tutors', 'location_text')
