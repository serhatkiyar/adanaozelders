"""on basvuru ilan dosyasi

Eğitmen ön başvurusu artık "normal bir ilanda olması gereken" bilgileri de
toplar: profil fotoğrafı, tanıtım metni, ders biçimi, saatlik ücret, müsaitlik
ve eğitim notu. Hepsi NULLABLE — başvuru ad + telefon + verilen derslerle
tamamlanmış sayılır, gerisini doldurmak başvuru sahibinin tercihidir.

Revision ID: c7f1a2d84b93
Revises: a94d3c07be21
Create Date: 2026-09-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7f1a2d84b93'
down_revision: Union[str, Sequence[str], None] = 'a94d3c07be21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tutor_pre_applications', sa.Column('photo_url', sa.String(length=500), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('headline', sa.String(length=255), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('bio', sa.Text(), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('intro_video_url', sa.String(length=500), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('teaching_mode', sa.String(length=20), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('hourly_rate', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('availability_note', sa.String(length=300), nullable=True))
    op.add_column('tutor_pre_applications', sa.Column('education_note', sa.String(length=300), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tutor_pre_applications', 'education_note')
    op.drop_column('tutor_pre_applications', 'availability_note')
    op.drop_column('tutor_pre_applications', 'hourly_rate')
    op.drop_column('tutor_pre_applications', 'teaching_mode')
    op.drop_column('tutor_pre_applications', 'intro_video_url')
    op.drop_column('tutor_pre_applications', 'bio')
    op.drop_column('tutor_pre_applications', 'headline')
    op.drop_column('tutor_pre_applications', 'photo_url')
