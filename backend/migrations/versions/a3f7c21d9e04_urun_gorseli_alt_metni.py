"""urun gorseli alt metni

Galeri görselleri bugün ekran okuyucuya ürün başlığıyla tanıtılıyor; bir üründe
sekiz görsel varsa sekizi de aynı adı taşıyor ve klavye/ekran okuyucu kullanıcısı
aralarında ayrım yapamıyor. Kolon NULL doğar: doldurulana kadar vitrin bugünkü
davranışına (ürün başlığına düşme) devam eder, hiçbir ekran bozulmaz.

Revision ID: a3f7c21d9e04
Revises: c424a7682128
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f7c21d9e04'
down_revision: Union[str, Sequence[str], None] = 'c424a7682128'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'product_images', sa.Column('alt_text', sa.String(length=200), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('product_images', 'alt_text')
