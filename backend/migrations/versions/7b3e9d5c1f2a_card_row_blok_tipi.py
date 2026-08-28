"""CARD_ROW blok tipi (Amazon tarzı bindirmeli kart satırı)

Vitrin blok tipi allowlist'i genişler: hero'nun gradient fade'i üzerine binen,
tekil ya da 2x2 görselli beyaz kartlar. Check constraint yeniden kurulur
(autogenerate PG check değişikliklerini görmez — backend/CLAUDE.md uyarısı).

Revision ID: 7b3e9d5c1f2a
Revises: 41fcda81703e
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7b3e9d5c1f2a"
down_revision: Union[str, Sequence[str], None] = "41fcda81703e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ESKI = (
    "block_type IN ('HERO_CAROUSEL', 'IMAGE_CARD_GRID', 'CATEGORY_GRID', "
    "'PRODUCT_RAIL', 'BANNER', 'RICH_TEXT', 'RECENTLY_VIEWED')"
)
_YENI = (
    "block_type IN ('HERO_CAROUSEL', 'IMAGE_CARD_GRID', 'CATEGORY_GRID', "
    "'PRODUCT_RAIL', 'BANNER', 'RICH_TEXT', 'RECENTLY_VIEWED', 'CARD_ROW')"
)


def upgrade() -> None:
    op.drop_constraint(
        "ck_store_landing_page_block_type", "store_landing_page_blocks", type_="check"
    )
    op.create_check_constraint(
        "ck_store_landing_page_block_type", "store_landing_page_blocks", _YENI
    )


def downgrade() -> None:
    op.execute("DELETE FROM store_landing_page_blocks WHERE block_type = 'CARD_ROW'")
    op.drop_constraint(
        "ck_store_landing_page_block_type", "store_landing_page_blocks", type_="check"
    )
    op.create_check_constraint(
        "ck_store_landing_page_block_type", "store_landing_page_blocks", _ESKI
    )
