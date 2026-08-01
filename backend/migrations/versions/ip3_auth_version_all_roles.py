"""auth_version kolonu tüm giriş hesabı tablolarına (İP-3 §6).

Şifre değişimi/sıfırlaması ve hesap kapatma oturum sürümünü artırır; access
token'daki ``auth_ver`` claim'i her istekte bu kolonla karşılaştırılır. Kolon
bugüne dek yalnız ``courier_accounts``'ta vardı (8590183c3cc1); diğer dört rol
tablosuna aynı tanımla eklenir. ``server_default=1`` mevcut satırları geçerli
sürümle doldurur — deploy sonrası eski access token'lar (claim'siz) düşer ama
refresh token'lar geçerli kaldığı için istemci sessiz yenilemeyle devam eder.

Revision ID: ip3_auth_version_all_roles
Revises: f29c_damage_idem_actor_scope
Create Date: 2026-08-01
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ip3_auth_version_all_roles"
down_revision = "f29c_damage_idem_actor_scope"
branch_labels = None
depends_on = None

_TABLES = ("admins", "tutors", "clients", "library_operators")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "auth_version",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_column(table, "auth_version")
