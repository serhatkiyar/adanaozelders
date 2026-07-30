"""ozellik bayraklari + odeme kolu kapilari (PK-1)

`feature_flags` tablosu + `settings.view`/`settings.manage` izinleri.

Bayrak SATIRI SEED EDİLMEZ. Gerekçe: hangi bayrakların var olduğu ve
varsayılanları `core/flags.py::FLAG_SPECS`'te tutulur (tek doğruluk kaynağı,
`core/admin_permissions.py` ile aynı disiplin). Satırı olmayan bayrak katalog
varsayılanıyla çalışır (`flags.is_enabled`); admin bir bayrağı değiştirdiğinde
satır upsert edilir. Varsayılanı iki yerde (kod + migration) tutmak, ileride
kodda değişen bir varsayılanın DB'de eski değerle kalmasına yol açardı.

Tehlikeli yön güvende: para açan bayrakların katalog varsayılanı `False`
(`tutor_marketplace_payments_live`, `library_marketplace_payments_live`,
`manual_payout_enabled`). Yalnız `store_payments_live` varsayılan olarak
açıktır — o kol başkası adına para toplamaz (platformun kendi kitabı).

NOT: autogenerate ayrıca `tutors.iban`, `libraries.iban` ve
`payout_records.iban_snapshot` için VARCHAR(34)→EncryptedString(255) tip
değişikliği üretti. Bu, bu paketle İLGİSİZ ve **önceden var olan** bir şema
sapmasıdır (baseline migration kolonları 34 karakter açmış, modeller şifreli
tip kullanıyor). Buraya karıştırılmadı; ayrı bir migration'da ele alınıyor.

Revision ID: 195ffdb6fb1b
Revises: 91fde114b0c4
Create Date: 2026-07-30 10:36:59.926495

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "195ffdb6fb1b"
down_revision: Union[str, Sequence[str], None] = "91fde114b0c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_PERMISSIONS = [
    ("settings.view", "Platform ayarlarını görüntüleme", "Platform"),
    ("settings.manage", "Platform ayarlarını değiştirme", "Platform"),
]

# Ödeme kolu açmak/kapatmak işletmenin en kritik kararıdır (hukuki risk taşır) —
# bilinçli olarak YALNIZ SUPER_ADMIN'e verilir. Ticaret yöneticisi ürün/sipariş
# yönetir, pazaryeri ödemesini açmaz.
ROLE_GRANTS = {
    "SUPER_ADMIN": ["settings.view", "settings.manage"],
}


def upgrade() -> None:
    op.create_table(
        "feature_flags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column(
            "enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("updated_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_admin_id"], ["admins.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feature_flags_key", "feature_flags", ["key"], unique=True)

    for code, name, group in NEW_PERMISSIONS:
        op.execute(
            f"""
            INSERT INTO admin_permissions (code, name, "group")
            SELECT '{code}', '{name}', '{group}'
            WHERE NOT EXISTS (
                SELECT 1 FROM admin_permissions
                WHERE code = '{code}' AND deleted_at IS NULL
            )
            """
        )
    for role_code, codes in ROLE_GRANTS.items():
        quoted = ", ".join(f"'{c}'" for c in codes)
        op.execute(
            f"""
            INSERT INTO admin_role_permissions (admin_role_id, permission_id)
            SELECT r.id, p.id
            FROM admin_roles r
            CROSS JOIN admin_permissions p
            WHERE r.code = '{role_code}'
              AND r.deleted_at IS NULL
              AND p.code IN ({quoted})
              AND p.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM admin_role_permissions rp
                  WHERE rp.admin_role_id = r.id
                    AND rp.permission_id = p.id
                    AND rp.deleted_at IS NULL
              )
            """
        )


def downgrade() -> None:
    codes = ", ".join(f"'{c}'" for c, _n, _g in NEW_PERMISSIONS)
    op.execute(
        f"""
        DELETE FROM admin_role_permissions
        WHERE permission_id IN (
            SELECT id FROM admin_permissions WHERE code IN ({codes})
        )
        """
    )
    op.execute(f"DELETE FROM admin_permissions WHERE code IN ({codes})")
    op.drop_index("ix_feature_flags_key", table_name="feature_flags")
    op.drop_table("feature_flags")
