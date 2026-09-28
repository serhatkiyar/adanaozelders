"""tanitim videosu baglantisi da admin onayindan gecer (tutor_intro_videos.kind)

YouTube/Vimeo bağlantısı artık `tutor_intro_videos` satırı olarak (kind=LINK)
yüklenen videoyla aynı PENDING_REVIEW → ACTIVE yaşam döngüsünden geçer.
`tutors.intro_video_url` yayındaki bağlantının public okuma kopyası olarak
kalır. Mevcut yayındaki bağlantılar veri kaybı olmadan ACTIVE LINK satırına
taşınır (ACTIVE satırı OLMAYAN eğitmenler için — kısmi unique indeks güvenli).

Revision ID: d1a3b5c7e9f2
Revises: c9e2f4a6b8d0
Create Date: 2026-09-28 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1a3b5c7e9f2'
down_revision: Union[str, Sequence[str], None] = 'c9e2f4a6b8d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CK = 'ck_tutor_intro_videos_kind_payload'
_CK_SQL = (
    "(kind = 'UPLOAD' AND source_key IS NOT NULL AND declared_size_bytes IS NOT NULL"
    " AND upload_expires_at IS NOT NULL)"
    " OR (kind = 'LINK' AND link_url IS NOT NULL)"
)


def upgrade() -> None:
    op.add_column(
        'tutor_intro_videos',
        sa.Column('kind', sa.String(length=8), server_default='UPLOAD', nullable=False),
    )
    op.add_column(
        'tutor_intro_videos', sa.Column('link_url', sa.String(length=500), nullable=True)
    )
    op.alter_column('tutor_intro_videos', 'source_key', existing_type=sa.String(length=255), nullable=True)
    op.alter_column('tutor_intro_videos', 'declared_size_bytes', existing_type=sa.BigInteger(), nullable=True)
    op.alter_column(
        'tutor_intro_videos', 'upload_expires_at', existing_type=sa.DateTime(timezone=True), nullable=True
    )
    op.create_check_constraint(_CK, 'tutor_intro_videos', _CK_SQL)
    # Yayındaki bağlantılar → ACTIVE LINK satırı (onaylı sayılır; mevcut yayın korunur).
    op.execute(
        """
        INSERT INTO tutor_intro_videos (tutor_id, status, kind, link_url, objects_deleted_at)
        SELECT t.id, 'ACTIVE', 'LINK', t.intro_video_url, NULL
        FROM tutors t
        WHERE t.intro_video_url IS NOT NULL AND t.intro_video_url <> ''
          AND NOT EXISTS (
              SELECT 1 FROM tutor_intro_videos v
              WHERE v.tutor_id = t.id AND v.status = 'ACTIVE'
          )
        """
    )


def downgrade() -> None:
    # Bağlantı satırları eski şemada temsil edilemez; yayındaki bağlantı zaten
    # `tutors.intro_video_url`da durur. Onay bekleyen bağlantılar kaybolur.
    op.execute("DELETE FROM tutor_intro_videos WHERE kind = 'LINK'")
    op.drop_constraint(_CK, 'tutor_intro_videos', type_='check')
    op.alter_column(
        'tutor_intro_videos', 'upload_expires_at', existing_type=sa.DateTime(timezone=True), nullable=False
    )
    op.alter_column('tutor_intro_videos', 'declared_size_bytes', existing_type=sa.BigInteger(), nullable=False)
    op.alter_column('tutor_intro_videos', 'source_key', existing_type=sa.String(length=255), nullable=False)
    op.drop_column('tutor_intro_videos', 'link_url')
    op.drop_column('tutor_intro_videos', 'kind')
