"""on basvuru ilan dosyasi

Eğitmen ön başvurusu artık "normal bir ilanda olması gereken" bilgileri de
toplar: profil fotoğrafı, tanıtım metni, ders biçimi, saatlik ücret, müsaitlik
ve eğitim notu. Hepsi NULLABLE — başvuru ad + telefon + verilen derslerle
tamamlanmış sayılır, gerisini doldurmak başvuru sahibinin tercihidir.

ZİNCİR NOTU (5 Eyl 2026): bu revizyon önce `a94d3c07be21`'in üstünde duruyordu
ve kısmi teslimat dalıyla KARDEŞ olmuştu; iki head bir merge revision'ı ile
birleştirilmişti. `tests/integration/test_ip16_migration_pg.py::
test_B1_ZINCIR_IP12_UZERINE_KURULU` merge revision'ı yasaklıyor — gerekçe
oradaki docstring'de: çatallı geçmiş `upgrade head`'i kırılgan yapıyor. Bu
yüzden ders taksonomisi dalı, main'e önce inen kısmi teslimat dalının
(`e8b3c1d95a47`) ÜSTÜNE alındı ve merge revision silindi. İki dal ayrı
alanlara dokunuyor (taksonomi ↔ teslimat paketleri), sıralama bağımlılık
üretmiyor. Yeni bir dal aynı duruma düşerse çözüm yine budur: merge revision
üretme, zinciri doğrusallaştır.

Revision ID: c7f1a2d84b93
Revises: e8b3c1d95a47
Create Date: 2026-09-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7f1a2d84b93'
down_revision: Union[str, Sequence[str], None] = 'e8b3c1d95a47'
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
