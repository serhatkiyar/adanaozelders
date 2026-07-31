"""refresh_tokens.persistent — "beni hatırla" tercihi

Refresh token artık ``httpOnly`` çerezde taşınıyor. Çerezin kalıcı mı yoksa
oturumluk mu olduğu HTTP isteğinde görünmediğinden, rotasyon sırasında yeni
çerezin ömrünü doğru seçebilmek için tercihin sunucuda yaşaması gerekir.
Mevcut satırlar için varsayılan ``true``: bu bir güvenlik sınırı değil konfor
tercihidir ve mevcut oturumları tarayıcı kapanışında düşürmek istemeyiz.

Revision ID: 91fde114b0c4
Revises: 47d00b1014e3
Create Date: 2026-07-29 14:54:53.215165

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '91fde114b0c4'
down_revision: Union[str, Sequence[str], None] = '47d00b1014e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'refresh_tokens',
        sa.Column(
            'persistent', sa.Boolean(), server_default=sa.text('true'), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_column('refresh_tokens', 'persistent')
