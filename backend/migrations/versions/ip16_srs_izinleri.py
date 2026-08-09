"""İP-16: platform tekrar destesi izinleri (srs_platform.view / manage)

`core/admin_permissions.py` kataloğu tek doğruluk kaynağıdır; bu migration onu
DB ile eşitler (ip4_operasyon_izinleri deseni). Katalogda olup DB'de olmayan
izin HİÇBİR role bağlanamaz — SUPER_ADMIN dahil herkes 403 alır ve menü öğesi
gizlendiği için hata görünmez (266eeeac2a47 tuzağı).

Rol dağıtımı:

* ``srs_platform.view``   → SUPER_ADMIN + EDUCATION_MANAGER.
* ``srs_platform.manage`` → SUPER_ADMIN + EDUCATION_MANAGER. Platform deste
  küratörlüğü bir eğitim içeriği işidir (grup "Eğitim"); tehlikeli dış yan
  etkisi yoktur, bu yüzden operations.manage'daki "yalnız SUPER_ADMIN"
  daraltması burada gerekmez.

Bu izinler yalnız platform deste İÇERİĞİNİ kapsar; hiçbir admin izni kullanıcı
ilerlemesi (srs_progress / srs_review_logs) okutmaz (sözleşme §7.2 K-6, D-7).

Idempotent: var olan kodlar yeniden eklenmez.

Revision ID: ip16_srs_izinleri
Revises: ip16_araliklitekrar
Create Date: 2026-08-08

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ip16_srs_izinleri"
down_revision: Union[str, Sequence[str], None] = "ip16_araliklitekrar"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("srs_platform.view", "Platform tekrar destelerini görüntüleme", "Eğitim"),
    ("srs_platform.manage", "Platform tekrar destesi yönetimi", "Eğitim"),
]

ROLE_GRANTS = {
    "SUPER_ADMIN": ["srs_platform.view", "srs_platform.manage"],
    "EDUCATION_MANAGER": ["srs_platform.view", "srs_platform.manage"],
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
