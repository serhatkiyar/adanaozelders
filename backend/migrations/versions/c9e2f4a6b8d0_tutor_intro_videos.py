"""egitmen tanitim videosu yukleme (tutor_intro_videos)

Revision ID: c9e2f4a6b8d0
Revises: b8d4f0e2c6a3
Create Date: 2026-09-28 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9e2f4a6b8d0'
down_revision: Union[str, Sequence[str], None] = 'b8d4f0e2c6a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_IN_FLIGHT = "status IN ('PENDING_UPLOAD','UPLOADED','PROCESSING','PENDING_REVIEW')"


def upgrade() -> None:
    op.create_table(
        'tutor_intro_videos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tutor_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), server_default='PENDING_UPLOAD', nullable=False),
        sa.Column('source_key', sa.String(length=255), nullable=False),
        sa.Column('declared_size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('declared_content_type', sa.String(length=100), nullable=True),
        sa.Column('upload_expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('output_key', sa.String(length=255), nullable=True),
        sa.Column('poster_key', sa.String(length=255), nullable=True),
        sa.Column('duration_seconds', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('output_size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('processing_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lock_token', sa.String(length=32), nullable=True),
        sa.Column('error_code', sa.String(length=40), nullable=True),
        sa.Column('error_message', sa.String(length=500), nullable=True),
        sa.Column('reviewed_by', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.Column('objects_deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_tutor_intro_videos_tutor_id'), 'tutor_intro_videos', ['tutor_id'], unique=False
    )
    op.create_index(
        'ix_tutor_intro_videos_status_created',
        'tutor_intro_videos',
        ['status', 'created_at'],
        unique=False,
    )
    # Eğitmen başına tek ACTIVE ve tek "yolda" video (kısmi unique indeksler).
    op.create_index(
        'uq_tutor_intro_videos_active',
        'tutor_intro_videos',
        ['tutor_id'],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.create_index(
        'uq_tutor_intro_videos_in_flight',
        'tutor_intro_videos',
        ['tutor_id'],
        unique=True,
        postgresql_where=sa.text(_IN_FLIGHT),
    )


def downgrade() -> None:
    op.drop_index(
        'uq_tutor_intro_videos_in_flight',
        table_name='tutor_intro_videos',
        postgresql_where=sa.text(_IN_FLIGHT),
    )
    op.drop_index(
        'uq_tutor_intro_videos_active',
        table_name='tutor_intro_videos',
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.drop_index('ix_tutor_intro_videos_status_created', table_name='tutor_intro_videos')
    op.drop_index(op.f('ix_tutor_intro_videos_tutor_id'), table_name='tutor_intro_videos')
    op.drop_table('tutor_intro_videos')
