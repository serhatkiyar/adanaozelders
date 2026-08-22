"""duyuru şeridi izinleri (announcements.view / announcements.manage)

`core/admin_permissions.py` kataloğu tek doğruluk kaynağıdır; bu migration onu
DB ile eşitler.

Neden migration şart: yetki "role bağlı izin satırı" üzerinden okunur.
Katalogda olup DB'de olmayan bir izin HİÇBİR role bağlanamaz — SUPER_ADMIN
dahil herkes 403 alır ve menü öğesi de gizlendiği için hata GÖRÜNMEZ
(`266eeeac2a47`'nin anlattığı hakediş defteri tuzağı).

Rol dağıtımı: yalnız SUPER_ADMIN. Duyuru şeridi storefront'un TEPESİNDEKİ tek
şerittir — `settings.*` gibi platform-genelinde etkili ve görünürlüğü yüksek
bir yüzey; ticaret/eğitim/operasyon yöneticilerine bilinçli olarak verilmedi.

Idempotent: var olan kodlar yeniden eklenmez.

Revision ID: a4b6c8d0e2f4
Revises: 6c7455403451
Create Date: 2026-08-22

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4b6c8d0e2f4"
down_revision: Union[str, Sequence[str], None] = "6c7455403451"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("announcements.view", "Duyuru şeridi görüntüleme", "Platform"),
    ("announcements.manage", "Duyuru şeridi yönetimi", "Platform"),
]

ROLE_GRANTS = {
    "SUPER_ADMIN": ["announcements.view", "announcements.manage"],
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
