"""ders taksonomisi tablolari + seviye referans verisi

Platformun kanonik ders sözlüğü. Bugüne kadar taksonomi yalnız frontend'te,
iki ayrışmış TypeScript sabitinde yaşıyordu; `tutor_subjects.subject`
doğrulanmamış serbest metindi ve arama tam-eşleşme yaptığı için iki liste
sessizce ayrışmıştı.

DİKKAT — bu dosya autogenerate çıktısından ELLE SÜZÜLMÜŞTÜR. Geliştirme
veritabanı main'de olmayan bir dalın (kısmi teslimat) şemasını taşıdığı için
autogenerate `orders.order_no`, `order_packages.*` ve `delivery_stops.package_id`
üzerinde DÜŞÜRME işlemleri de üretti. Onlar bu paketin işi değil ve buraya
alınmadı: uygulanmaları başka bir dalın canlı verisini yok ederdi.

Seviye merdivenleri ve basamakları MIGRATION'a seed edilir (betiğe değil):
kod `level.code` dizelerine (`lise`, `b1`) bağlanır, tablo boşsa seviye filtresi
hata vermez — sessizce hiç sonuç döndürür. Ders kataloğunun kendisi ise iş
verisidir ve `scripts/dersler_yukle.py` ile gelir.

Revision ID: b27db6c5d4b6
Revises: c7f1a2d84b93
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b27db6c5d4b6'
down_revision: Union[str, Sequence[str], None] = 'c7f1a2d84b93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


#: (kod, ad, sıra)
MERDIVENLER = [
    ("OKUL", "Okul kademesi", 1),
    ("CEFR", "Avrupa dil seviyesi", 2),
    ("SANAT", "Yetkinlik", 3),
    ("KONSERVATUVAR", "Konservatuvar kademesi", 4),
]

#: (merdiven, kod, ad, sıra)
BASAMAKLAR = [
    ("OKUL", "okul-oncesi", "Okul öncesi", 1),
    ("OKUL", "ilkokul", "İlkokul", 2),
    ("OKUL", "ortaokul", "Ortaokul", 3),
    ("OKUL", "lise", "Lise", 4),
    ("OKUL", "on-lisans", "Ön lisans", 5),
    ("OKUL", "lisans", "Lisans", 6),
    ("OKUL", "yuksek-lisans", "Yüksek lisans", 7),
    ("OKUL", "doktora", "Doktora", 8),
    ("OKUL", "yetiskin", "Yetişkin", 9),
    ("CEFR", "a1", "A1", 1),
    ("CEFR", "a2", "A2", 2),
    ("CEFR", "b1", "B1", 3),
    ("CEFR", "b2", "B2", 4),
    ("CEFR", "c1", "C1", 5),
    ("CEFR", "c2", "C2", 6),
    ("SANAT", "baslangic", "Başlangıç", 1),
    ("SANAT", "orta", "Orta", 2),
    ("SANAT", "ileri", "İleri", 3),
    ("SANAT", "uzman", "Uzman", 4),
    ("KONSERVATUVAR", "guzel-sanatlar-lisesi", "Güzel sanatlar lisesi", 1),
    ("KONSERVATUVAR", "konservatuvar-on-lisans", "Konservatuvar ön lisans", 2),
    ("KONSERVATUVAR", "konservatuvar-lisans", "Konservatuvar lisans", 3),
    ("KONSERVATUVAR", "konservatuvar-yuksek-lisans", "Konservatuvar yüksek lisans", 4),
    ("KONSERVATUVAR", "konservatuvar-doktora", "Konservatuvar doktora", 5),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'level_scales',
        sa.Column('code', sa.String(length=24), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.PrimaryKeyConstraint('code'),
    )
    op.create_table(
        'subjects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=160), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('group_code', sa.String(length=24), nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['subjects.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_subjects_active_group', 'subjects', ['is_active', 'group_code'], unique=False)
    op.create_index('ix_subjects_parent', 'subjects', ['parent_id'], unique=False)
    op.create_index(
        'uq_subjects_slug_active', 'subjects', ['slug'], unique=True,
        postgresql_where=sa.text('deleted_at IS NULL'),
    )
    op.create_table(
        'levels',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('scale_code', sa.String(length=24), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.ForeignKeyConstraint(['scale_code'], ['level_scales.code'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_levels_scale_code', 'levels', ['scale_code', 'code'], unique=True)
    op.create_table(
        'subject_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('alias', sa.String(length=160), nullable=False),
        # `tr_normalize()` baseline migration'da tanımlıdır; arama sorgusu da
        # aynı fonksiyonu kullanır. Normalizasyonu uygulamaya bırakmak iki
        # tarafın ayrışması demekti — hata vermeyen, sessiz boş sonuç arızası.
        sa.Column(
            'normalized', sa.String(length=160),
            sa.Computed('tr_normalize(alias)', persisted=True), nullable=False,
        ),
        sa.Column('source', sa.String(length=16), server_default=sa.text("'IMPORT'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_subject_aliases_subject', 'subject_aliases', ['subject_id'], unique=False)
    # GLOBAL benzersizlik: bir metin iki derse birden bağlanamaz. Belirsiz
    # eşanlamlı arama sonucunu hata vermeden bozar.
    op.create_index('uq_subject_aliases_normalized', 'subject_aliases', ['normalized'], unique=True)
    op.create_table(
        'subject_level_scales',
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('scale_code', sa.String(length=24), nullable=False),
        sa.ForeignKeyConstraint(['scale_code'], ['level_scales.code'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('subject_id', 'scale_code'),
    )

    # ── Referans veri ────────────────────────────────────────────────────
    op.bulk_insert(
        sa.table(
            'level_scales',
            sa.column('code', sa.String),
            sa.column('name', sa.String),
            sa.column('sort_order', sa.Integer),
        ),
        [{"code": k, "name": a, "sort_order": s} for k, a, s in MERDIVENLER],
    )
    op.bulk_insert(
        sa.table(
            'levels',
            sa.column('scale_code', sa.String),
            sa.column('code', sa.String),
            sa.column('name', sa.String),
            sa.column('sort_order', sa.Integer),
        ),
        [
            {"scale_code": m, "code": k, "name": a, "sort_order": s}
            for m, k, a, s in BASAMAKLAR
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('subject_level_scales')
    op.drop_index('uq_subject_aliases_normalized', table_name='subject_aliases')
    op.drop_index('ix_subject_aliases_subject', table_name='subject_aliases')
    op.drop_table('subject_aliases')
    op.drop_index('uq_levels_scale_code', table_name='levels')
    op.drop_table('levels')
    op.drop_index('uq_subjects_slug_active', table_name='subjects')
    op.drop_index('ix_subjects_parent', table_name='subjects')
    op.drop_index('ix_subjects_active_group', table_name='subjects')
    op.drop_table('subjects')
    op.drop_table('level_scales')
