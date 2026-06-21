"""library: Google Haritalar yer kimliği (google_place_id)

"Haritada Görüntüle" butonunun işletmenin gerçek Google profil sayfasını açabilmesi
için place_id saklanır (veri setinden gelir; elle eklenenlerde boş olabilir).

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-06-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "l2m3n4o5p6q7"
down_revision: Union[str, Sequence[str], None] = "k1l2m3n4o5p6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "libraries",
        sa.Column("google_place_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("libraries", "google_place_id")
