"""tutor_subjects kanonik ders bagi + egitmen seviye tablosu

Eğitmenin bildirdiği branş bugüne kadar doğrulanmamış serbest metindi.
`subject_id` kanonik derse bağ kurar; metin kolonu KALIR (geriye uyum ve
taksonomide karşılığı olmayan gerçek branşları kaybetmemek için) ve
eşleşmeyen kayıtta `subject_id` NULL olur.

`tutor_subject_levels` eğitmenin o derste verdiği seviyeleri tutar.
`tutor_subjects`'e yabancı anahtar YOKTUR: `_replace_subjects` her profil
kaydında branş satırlarını silip yeniden yazıyor, bileşik FK bu satırları da
düşürürdü. Bütünlük servis katmanında sağlanır.

DİKKAT — autogenerate çıktısından ELLE SÜZÜLMÜŞTÜR. Geliştirme veritabanı
main'de olmayan bir dalın (kısmi teslimat) şemasını taşıdığı için üretilen
dosya `delivery_stops.package_id`, `order_packages.*` ve `orders.order_no`
üzerinde DÜŞÜRME işlemleri de içeriyordu; onlar bu paketin işi değil ve
uygulanmaları başka bir dalın verisini yok ederdi.

Revision ID: c424a7682128
Revises: e4a91c37f2d8
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c424a7682128'
down_revision: Union[str, Sequence[str], None] = 'e4a91c37f2d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'tutor_subjects',
        sa.Column('subject_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_tutor_subjects_subject_id', 'tutor_subjects', 'subjects',
        ['subject_id'], ['id'], ondelete='RESTRICT',
    )
    op.create_index(
        'ix_tutor_subjects_subject_id', 'tutor_subjects', ['subject_id'], unique=False
    )
    # Aynı eğitmenin iki farklı serbest metni ("Fen", "Fen Bilgisi") aynı
    # kanonik derse bağlanıp listede çift görünmesin.
    op.create_index(
        'uq_tutor_subjects_canonical', 'tutor_subjects', ['tutor_id', 'subject_id'],
        unique=True, postgresql_where=sa.text('subject_id IS NOT NULL'),
    )

    op.create_table(
        'tutor_subject_levels',
        sa.Column('tutor_id', sa.Integer(), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('level_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['level_id'], ['levels.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['tutor_id'], ['tutors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tutor_id', 'subject_id', 'level_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('tutor_subject_levels')
    op.drop_index('uq_tutor_subjects_canonical', table_name='tutor_subjects')
    op.drop_index('ix_tutor_subjects_subject_id', table_name='tutor_subjects')
    op.drop_constraint('fk_tutor_subjects_subject_id', 'tutor_subjects', type_='foreignkey')
    op.drop_column('tutor_subjects', 'subject_id')
