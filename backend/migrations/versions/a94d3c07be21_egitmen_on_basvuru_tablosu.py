"""egitmen on basvuru tablosu

Facebook gruplarında paylaşılan /egitmen-on-basvuru sayfasının lead kaydı
(`tutor_pre_applications`). Hesap açılmaz; iletişim bilgisi, KVKK onay
damgası, isteğe bağlı e-posta (lansman daveti için) ve isteğe bağlı
diploma/sertifika ekleri (`documents` JSONB, private/ anahtarları) tutulur.
Yeni izin YOK: liste `tutors.view`, durum geçişi `tutors.manage` ile
korunur (mevcut katalog).

Revision ID: a94d3c07be21
Revises: b1c4e7a90d52
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a94d3c07be21'
down_revision: Union[str, Sequence[str], None] = 'b1c4e7a90d52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('tutor_pre_applications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('full_name', sa.String(length=150), nullable=False),
    sa.Column('phone', sa.String(length=20), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('subjects', sa.String(length=600), nullable=False),
    sa.Column('district', sa.String(length=50), nullable=True),
    sa.Column('experience', sa.String(length=20), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('documents', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('kvkk_accepted_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=16), server_default=sa.text("'NEW'"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_tutor_pre_applications_phone', 'tutor_pre_applications', ['phone'], unique=False)
    op.create_index('ix_tutor_pre_applications_status', 'tutor_pre_applications', ['status'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_tutor_pre_applications_status', table_name='tutor_pre_applications')
    op.drop_index('ix_tutor_pre_applications_phone', table_name='tutor_pre_applications')
    op.drop_table('tutor_pre_applications')
