"""ad/kullanıcı adı değişiklik sayaçları + onay kuyruğu (name_change_requests)

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "j0k1l2m3n4o5"
down_revision: Union[str, Sequence[str], None] = "i9j0k1l2m3n4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# NameMixin'i kullanan kullanıcı tabloları.
_USER_TABLES = ("admins", "tutors", "clients", "library_operators")


def upgrade() -> None:
    for table in _USER_TABLES:
        op.add_column(
            table,
            sa.Column(
                "name_change_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "username_change_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    op.create_table(
        "name_change_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("new_first_name", sa.String(length=75), nullable=True),
        sa.Column("new_last_name", sa.String(length=75), nullable=True),
        sa.Column("new_username", sa.String(length=50), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=10),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column("review_note", sa.String(length=500), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_name_change_requests_user",
        "name_change_requests",
        ["user_id", "role_id"],
    )
    op.create_index(
        "ix_name_change_requests_status",
        "name_change_requests",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_name_change_requests_status", "name_change_requests")
    op.drop_index("ix_name_change_requests_user", "name_change_requests")
    op.drop_table("name_change_requests")
    for table in _USER_TABLES:
        op.drop_column(table, "username_change_count")
        op.drop_column(table, "name_change_count")
