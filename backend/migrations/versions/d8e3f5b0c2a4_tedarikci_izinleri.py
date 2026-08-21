"""tedarikçi senkronu izinleri (suppliers.view / suppliers.manage)

`core/admin_permissions.py` kataloğu tek doğruluk kaynağıdır; bu migration onu
DB ile eşitler.

Neden migration şart: yetki "role bağlı izin satırı" üzerinden okunur.
Katalogda olup DB'de olmayan bir izin HİÇBİR role bağlanamaz — SUPER_ADMIN
dahil herkes 403 alır ve menü öğesi de gizlendiği için hata GÖRÜNMEZ
(`266eeeac2a47`'nin anlattığı hakediş defteri tuzağı).

Rol dağıtımı (görev ayrılığı):

* ``suppliers.view``   → SUPER_ADMIN + COMMERCE_MANAGER.
* ``suppliers.manage`` → SUPER_ADMIN + COMMERCE_MANAGER. Bu izin bir SIRRI
  (API token'ı) ve "vitrin neyi otomatik satar" kararını taşır; mağaza
  operasyonunu ticaret yöneticisi yürüttüğü için ona da verilir, ama
  `products.manage` sahibi olan herkese OTOMATİK gitmez — ayrımın anlamı budur.

Idempotent: var olan kodlar yeniden eklenmez.

Revision ID: d8e3f5b0c2a4
Revises: c7d2e4a9b1f3
Create Date: 2026-08-22

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8e3f5b0c2a4"
down_revision: Union[str, Sequence[str], None] = "c7d2e4a9b1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("suppliers.view", "Tedarikçi senkronu görüntüleme", "Ticaret"),
    ("suppliers.manage", "Tedarikçi ayarı ve eşleştirme yönetimi", "Ticaret"),
]

ROLE_GRANTS = {
    "SUPER_ADMIN": ["suppliers.view", "suppliers.manage"],
    "COMMERCE_MANAGER": ["suppliers.view", "suppliers.manage"],
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
        WHERE permission_id IN (
            SELECT id FROM admin_permissions WHERE code IN ({codes})
        )
        """
    )
    op.execute(f"DELETE FROM admin_permissions WHERE code IN ({codes})")
