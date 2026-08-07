"""ip4: operasyon kurtarma izinleri (operations.view / operations.manage)

İP-4 "Hata Çözme" yüzeyi iki yeni izin istiyor. `core/admin_permissions.py`
kataloğu tek doğruluk kaynağıdır; bu migration onu DB ile eşitler.

Neden migration şart: yetki "role bağlı izin satırı" üzerinden okunur. Katalogda
olup DB'de olmayan bir izin HİÇBİR role bağlanamaz — SUPER_ADMIN dahil herkes
403 alır ve menü öğesi de gizlendiği için hata GÖRÜNMEZ (`266eeeac2a47`'in
anlattığı hakediş defteri tuzağı).

Rol dağıtımı (görev ayrılığı):

* ``operations.view``   → SUPER_ADMIN + COMMERCE_MANAGER. Sıkışmış para
  kuyruğunun konusu sipariş/iade olduğu için ticaret yöneticisi GÖRMELİDİR.
* ``operations.manage`` → yalnız SUPER_ADMIN. Retry, müşteriye giden bir SMS ya
  da e-postayı yeniden tetikler; GERİ ALINAMAZ dış yan etkidir ve kuyruğu gören
  kişiye otomatik verilmez.

Idempotent: var olan kodlar yeniden eklenmez.

Revision ID: ip4_operasyon_izinleri
Revises: ip2a_iade_para_guvenligi
Create Date: 2026-08-07

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ip4_operasyon_izinleri"
down_revision: Union[str, Sequence[str], None] = "ip2a_iade_para_guvenligi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("operations.view", "Sıkışmış para ve ölü iş kuyruğunu görüntüleme", "Platform"),
    ("operations.manage", "Ölü işi yeniden kuyruğa alma", "Platform"),
]

ROLE_GRANTS = {
    "SUPER_ADMIN": ["operations.view", "operations.manage"],
    "COMMERCE_MANAGER": ["operations.view"],
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
