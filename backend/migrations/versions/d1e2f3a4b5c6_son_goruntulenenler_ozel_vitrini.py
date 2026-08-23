"""son goruntulenenler ozel vitrini

Revision ID: d1e2f3a4b5c6
Revises: ccec9dff6e3c
Create Date: 2026-08-23 16:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "ccec9dff6e3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_store_home_sections_type",
        "store_home_sections",
        type_="check",
    )
    op.create_check_constraint(
        "ck_store_home_sections_type",
        "store_home_sections",
        "section_type IN ('PRODUCT_RAIL', 'IMAGE_GRID', 'RECENTLY_VIEWED')",
    )
    op.create_check_constraint(
        "ck_store_home_sections_recent_no_images",
        "store_home_sections",
        "section_type <> 'RECENTLY_VIEWED' OR jsonb_array_length(image_tiles) = 0",
    )
    op.create_index(
        "uq_store_home_sections_recently_viewed",
        "store_home_sections",
        ["section_type"],
        unique=True,
        postgresql_where=sa.text(
            "section_type = 'RECENTLY_VIEWED' AND deleted_at IS NULL"
        ),
    )
    op.execute(
        """
        INSERT INTO store_home_sections (
            title,
            description,
            section_type,
            link_url,
            link_label,
            image_tiles,
            is_active,
            sort_order
        )
        SELECT
            'Son görüntülediklerin',
            '',
            'RECENTLY_VIEWED',
            NULL,
            'Tümünü gör',
            '[]'::jsonb,
            true,
            COALESCE(MAX(sort_order), -10) + 10
        FROM store_home_sections
        WHERE deleted_at IS NULL
        HAVING NOT EXISTS (
            SELECT 1
            FROM store_home_sections
            WHERE section_type = 'RECENTLY_VIEWED'
              AND deleted_at IS NULL
        )
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM store_home_sections WHERE section_type = 'RECENTLY_VIEWED'"
    )
    op.drop_index(
        "uq_store_home_sections_recently_viewed",
        table_name="store_home_sections",
        postgresql_where=sa.text(
            "section_type = 'RECENTLY_VIEWED' AND deleted_at IS NULL"
        ),
    )
    op.drop_constraint(
        "ck_store_home_sections_recent_no_images",
        "store_home_sections",
        type_="check",
    )
    op.drop_constraint(
        "ck_store_home_sections_type",
        "store_home_sections",
        type_="check",
    )
    op.create_check_constraint(
        "ck_store_home_sections_type",
        "store_home_sections",
        "section_type IN ('PRODUCT_RAIL', 'IMAGE_GRID')",
    )
