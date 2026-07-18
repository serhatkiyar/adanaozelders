"""KURYE rolü (role_id=5) + courier_accounts + kurye başına tek ACTIVE tur.

- role_type PG enum'una 'COURIER' elle eklenir (autogenerate enum ALTER üretmez).
- courier_accounts: kurye giriş hesabı (LibraryOperator deseni) — Courier
  profiline FK, auth_version (oturum sürümü), soft-delete'li partial unique'ler.
- uq_delivery_run_active_courier: kurye aynı anda tek ACTIVE tur sürebilir.

Not: PG enum değeri güvenle GERİ ALINAMAZ (yalnız tip yeniden yaratmayla —
riskli); downgrade tabloları/index'leri kaldırır, enum değeri kalır.

Revision ID: 8590183c3cc1
Revises: e0f1a2b3c4d5
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "8590183c3cc1"
down_revision = "e0f1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enum'a yeni değer — IF NOT EXISTS idempotent (tekrar koşulabilir).
    op.execute("ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'COURIER'")

    op.create_table(
        "courier_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "role_id",
            sa.SmallInteger(),
            sa.ForeignKey("roles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "courier_id",
            sa.Integer(),
            sa.ForeignKey("couriers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        # NameMixin
        sa.Column("first_name", sa.String(length=75), nullable=False),
        sa.Column("last_name", sa.String(length=75), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("avatar_url", sa.String(length=255), nullable=True),
        sa.Column("name_change_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("username_change_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        # EmailVerification / LastSeen / Timestamp / SoftDelete mixin kolonları
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    for name, col in (
        ("uq_courier_accounts_email_active", "email"),
        ("uq_courier_accounts_username_active", "username"),
        ("uq_courier_accounts_courier_active", "courier_id"),
    ):
        op.create_index(
            name,
            "courier_accounts",
            [col],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        )

    # Kurye aynı anda tek ACTIVE tur sürebilir (servis kontrolünün DB otoritesi).
    op.create_index(
        "uq_delivery_run_active_courier",
        "delivery_runs",
        ["courier_id"],
        unique=True,
        postgresql_where=sa.text(
            "courier_id IS NOT NULL AND status = 'ACTIVE' AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_delivery_run_active_courier", table_name="delivery_runs")
    for name in (
        "uq_courier_accounts_courier_active",
        "uq_courier_accounts_username_active",
        "uq_courier_accounts_email_active",
    ):
        op.drop_index(name, table_name="courier_accounts")
    op.drop_table("courier_accounts")
    # 'COURIER' enum değeri bilinçli olarak bırakılır (güvenli kaldırma yolu yok).
