"""Mağaza vitrin görselleri tablosu ve izin adlarının güncellenmesi.

Revision ID: b5c7d9e1f3a5
Revises: a4b6c8d0e2f4
Create Date: 2026-08-23

Eski ``duyuru_seridi`` tablosu veri kaybına yol açmamak için bu revizyonda
silinmez. Yeni storefront yalnız ``store_hero_slides`` kaynağını kullanır.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "b5c7d9e1f3a5"
down_revision = "a4b6c8d0e2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "store_hero_slides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=False),
        sa.Column("mobile_image_url", sa.Text(), nullable=True),
        sa.Column("alt_text", sa.String(length=180), server_default=sa.text("''"), nullable=False),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("sort_order >= 0", name="ck_store_hero_slides_sort_nonnegative"),
        sa.CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_store_hero_slides_end_after_start",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_store_hero_slides_active_sort",
        "store_hero_slides",
        ["is_active", "sort_order", "deleted_at"],
        unique=False,
    )

    # İzin kodları dış sözleşmedir; yalnız kullanıcıya görünen adlar değişir.
    op.execute(
        "UPDATE admin_permissions SET name = 'Vitrin görsellerini görüntüleme' "
        "WHERE code = 'announcements.view' AND deleted_at IS NULL"
    )
    op.execute(
        "UPDATE admin_permissions SET name = 'Vitrin görsellerini yönetme' "
        "WHERE code = 'announcements.manage' AND deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE admin_permissions SET name = 'Duyuru şeridi görüntüleme' "
        "WHERE code = 'announcements.view' AND deleted_at IS NULL"
    )
    op.execute(
        "UPDATE admin_permissions SET name = 'Duyuru şeridi yönetimi' "
        "WHERE code = 'announcements.manage' AND deleted_at IS NULL"
    )
    op.drop_index("ix_store_hero_slides_active_sort", table_name="store_hero_slides")
    op.drop_table("store_hero_slides")
