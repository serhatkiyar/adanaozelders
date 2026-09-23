"""degerlendirme alt kriter, anonimlik, edited_at ve ogrenci-ogretmen tekilligi

Revision ID: d7a3c1e5b902
Revises: 61d2fe8e4109
Create Date: 2026-09-23 12:00:00.000000

Değerlendirme artık (client_id, tutor_id) çiftine aittir. Çift başına birden
fazla aktif kayıt varsa EN YENİSİ kalır (created_at DESC, id DESC); eskileri
soft-delete edilir ve gizlenmemiş olanlar öğretmenin puan toplamından düşülür
(gizlenmişler moderasyonda zaten düşülmüştü).

Downgrade kolonları ve index'i kaldırır; soft-delete edilen çift kayıtları
geri AÇMAZ. Bu veri temizliği GERİ ALINAMAZ: production'da çalıştırmadan önce
veritabanı yedeği alınmalıdır (en azından `reviews` ve `tutors` tabloları).
Downgrade sonrası yeni kolonlardaki veri (alt kriterler, anonimlik tercihi,
edited_at) da kaybolur.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7a3c1e5b902'
down_revision: Union[str, Sequence[str], None] = '61d2fe8e4109'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ALT_KRITERLER = ("clarity", "motivation", "preparation")


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        CREATE TEMP TABLE _fazla_yorum ON COMMIT DROP AS
        SELECT id, tutor_id, rating, hidden_at
        FROM (
            SELECT id, tutor_id, rating, hidden_at,
                   row_number() OVER (
                       PARTITION BY client_id, tutor_id
                       ORDER BY created_at DESC, id DESC
                   ) AS sira
            FROM reviews
            WHERE deleted_at IS NULL
        ) t
        WHERE sira > 1
        """
    )
    op.execute(
        """
        UPDATE tutors t
        SET rating_count = t.rating_count - f.adet,
            rating_sum = t.rating_sum - f.toplam
        FROM (
            SELECT tutor_id, count(*) AS adet, sum(rating) AS toplam
            FROM _fazla_yorum
            WHERE hidden_at IS NULL
            GROUP BY tutor_id
        ) f
        WHERE t.id = f.tutor_id
        """
    )
    op.execute(
        "UPDATE reviews SET deleted_at = now() "
        "WHERE id IN (SELECT id FROM _fazla_yorum)"
    )

    for ad in _ALT_KRITERLER:
        op.add_column(
            'reviews', sa.Column(f'{ad}_rating', sa.SmallInteger(), nullable=True)
        )
        op.create_check_constraint(
            f'ck_reviews_{ad}_range',
            'reviews',
            f'{ad}_rating IS NULL OR {ad}_rating BETWEEN 1 AND 5',
        )
    op.add_column(
        'reviews',
        sa.Column(
            'is_anonymous', sa.Boolean(), server_default=sa.text('false'), nullable=False
        ),
    )
    op.add_column(
        'reviews', sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        'uq_reviews_client_tutor_active',
        'reviews',
        ['client_id', 'tutor_id'],
        unique=True,
        postgresql_where=sa.text('deleted_at IS NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'uq_reviews_client_tutor_active',
        table_name='reviews',
        postgresql_where=sa.text('deleted_at IS NULL'),
    )
    op.drop_column('reviews', 'edited_at')
    op.drop_column('reviews', 'is_anonymous')
    for ad in reversed(_ALT_KRITERLER):
        op.drop_constraint(f'ck_reviews_{ad}_range', 'reviews', type_='check')
        op.drop_column('reviews', f'{ad}_rating')
