"""hakedis izinleri: payments.view/manage katalogda yoktu

Hakediş defteri (payouts router'ı) `payments.view` ve `payments.manage`
izinlerini istiyor ama bu iki izin `admin_permissions` kataloğuna hiç
eklenmemişti. Yetki "role bağlı izin satırı" üzerinden okunduğundan olmayan
bir izin hiçbir role bağlanamaz — SUPER_ADMIN dahil HERKES 403 alıyordu ve
menü öğesi de gizlendiği için hata görünmüyordu.

Katalog artık `core/admin_permissions.py`'de; bu migration onu DB ile
eşitler. Idempotent: var olan kodlar yeniden eklenmez.

Revision ID: 266eeeac2a47
Revises: 1327cbb29263
Create Date: 2026-07-29 09:22:51.283595

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '266eeeac2a47'
down_revision: Union[str, Sequence[str], None] = '1327cbb29263'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("payments.view", "Hakediş görüntüleme", "Ticaret"),
    ("payments.manage", "Hakediş ödemesi kaydetme", "Ticaret"),
]

# Hakediş ticaret operasyonudur; ödeme kaydını ticaret yöneticisi de girebilir.
ROLE_GRANTS = {
    "SUPER_ADMIN": ["payments.view", "payments.manage"],
    "COMMERCE_MANAGER": ["payments.view", "payments.manage"],
}


def upgrade() -> None:
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
        WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code IN ({codes}))
        """
    )
    op.execute(f"DELETE FROM admin_permissions WHERE code IN ({codes})")
