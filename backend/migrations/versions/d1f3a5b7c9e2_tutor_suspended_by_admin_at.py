"""egitmen: admin yayindan kaldirma isareti (tutors.suspended_by_admin_at)

Admin'in yayından kaldırdığı ilan ile eğitmenin kendi "Pasife al"ı aynı
SUSPENDED durumunu yazıyordu; eğitmen `/tutors/me/activate` ile admin kararını
kendisi geri alabiliyordu. Kolon doluyken yalnız admin yeniden yayına alır.

Revision ID: d1f3a5b7c9e2
Revises: c9e2f4a6b8d0
Create Date: 2026-09-28 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1f3a5b7c9e2'
down_revision: Union[str, Sequence[str], None] = 'c9e2f4a6b8d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tutors',
        sa.Column('suspended_by_admin_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Mevcut admin kararları da korunur: bugün SUSPENDED olan ve son admin
    # ilan kararı `tutor.suspend` olan eğitmen işaretlenir (audit_logs).
    # Belirsiz durumda (admin kaldırdı → eğitmen açtı → eğitmen kapattı) da
    # işaretlenir; yanlış pozitifin bedeli admin'in ilanı yeniden açmasıdır.
    op.execute(
        """
        UPDATE tutors t
        SET suspended_by_admin_at = son.created_at
        FROM (
            SELECT DISTINCT ON (target_id) target_id, action, created_at
            FROM audit_logs
            WHERE target_type = 'tutor'
              AND action IN ('tutor.suspend', 'tutor.activate')
            ORDER BY target_id, created_at DESC, id DESC
        ) son
        WHERE son.target_id = t.id
          AND son.action = 'tutor.suspend'
          AND t.status = 'SUSPENDED'
        """
    )


def downgrade() -> None:
    op.drop_column('tutors', 'suspended_by_admin_at')
