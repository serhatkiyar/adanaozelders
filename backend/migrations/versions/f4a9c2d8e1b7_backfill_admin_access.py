"""backfill admin access data and restore legacy indexes

Revision ID: f4a9c2d8e1b7
Revises: 7121d6785a32
Create Date: 2026-07-18

Bu düzeltme idempotenttir: 7121d6785a32'nin seed içeren temiz sürümünde no-op,
daha önce uygulanmış eksik autogenerate sürümünde rol/izin/backfill'i tamamlar.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a9c2d8e1b7"
down_revision: Union[str, Sequence[str], None] = "7121d6785a32"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSIONS = [
    ("dashboard.view", "Dashboard görüntüleme", "Platform"),
    ("users.view", "Kullanıcı görüntüleme", "Platform"),
    ("users.manage", "Kullanıcı yönetimi", "Platform"),
    ("tutors.view", "Eğitmen görüntüleme", "Eğitim"),
    ("tutors.manage", "Eğitmen yönetimi", "Eğitim"),
    ("bookings.view", "Rezervasyon görüntüleme", "Eğitim"),
    ("bookings.manage", "Rezervasyon yönetimi", "Eğitim"),
    ("demands.view", "Öğrenci talebi görüntüleme", "Eğitim"),
    ("demands.manage", "Öğrenci talebi yönetimi", "Eğitim"),
    ("libraries.view", "Kütüphane görüntüleme", "Operasyon"),
    ("libraries.manage", "Kütüphane yönetimi", "Operasyon"),
    ("catalogs.view", "Deneme kataloğu görüntüleme", "Operasyon"),
    ("catalogs.manage", "Deneme kataloğu yönetimi", "Operasyon"),
    ("products.view", "Ürün görüntüleme", "Ticaret"),
    ("products.manage", "Ürün yönetimi", "Ticaret"),
    ("orders.view", "Sipariş görüntüleme", "Ticaret"),
    ("orders.manage", "Sipariş yönetimi", "Ticaret"),
    ("returns.view", "İade görüntüleme", "Ticaret"),
    ("returns.manage", "İade yönetimi", "Ticaret"),
    ("coupons.view", "Kupon görüntüleme", "Ticaret"),
    ("coupons.manage", "Kupon yönetimi", "Ticaret"),
    ("delivery.view", "Dağıtım görüntüleme", "Ticaret"),
    ("delivery.manage", "Dağıtım yönetimi", "Ticaret"),
    ("reports.view", "Şikâyet görüntüleme", "Güvenlik"),
    ("reports.manage", "Şikâyet yönetimi", "Güvenlik"),
    ("audit.view", "Denetim kayıtlarını görüntüleme", "Güvenlik"),
    ("admin_roles.view", "Admin yetkilerini görüntüleme", "Güvenlik"),
    ("admin_roles.manage", "Admin yetkilerini yönetme", "Güvenlik"),
]

ROLES = [
    ("SUPER_ADMIN", "Süper Admin", "Tüm yönetim yetkilerine sahiptir.", True),
    ("EDUCATION_MANAGER", "Eğitim Yöneticisi", "Eğitmen, rezervasyon ve öğrenci talebi operasyonları.", True),
    ("COMMERCE_MANAGER", "Ticaret Yöneticisi", "Mağaza, sipariş, iade ve dağıtım operasyonları.", True),
    ("MODERATOR", "Moderatör", "Şikâyet ve kullanıcı inceleme operasyonları.", True),
    ("OPERATIONS_MANAGER", "Operasyon Yöneticisi", "Kütüphane, katalog ve dağıtım operasyonları.", True),
]

ROLE_PERMISSIONS = {
    "EDUCATION_MANAGER": ["dashboard.view", "users.view", "tutors.view", "tutors.manage", "bookings.view", "bookings.manage", "demands.view", "demands.manage"],
    "COMMERCE_MANAGER": ["dashboard.view", "users.view", "products.view", "products.manage", "orders.view", "orders.manage", "returns.view", "returns.manage", "coupons.view", "coupons.manage", "delivery.view", "delivery.manage"],
    "MODERATOR": ["dashboard.view", "users.view", "reports.view", "reports.manage", "audit.view"],
    "OPERATIONS_MANAGER": ["dashboard.view", "libraries.view", "libraries.manage", "catalogs.view", "catalogs.manage", "delivery.view", "delivery.manage", "audit.view"],
}


def upgrade() -> None:
    bind = op.get_bind()
    for code, name, group in PERMISSIONS:
        bind.execute(
            sa.text(
                """INSERT INTO admin_permissions (code, name, "group")
                   SELECT CAST(:code AS VARCHAR), CAST(:name AS VARCHAR), CAST(:group AS VARCHAR)
                   WHERE NOT EXISTS (
                       SELECT 1 FROM admin_permissions
                       WHERE code = CAST(:code AS VARCHAR) AND deleted_at IS NULL
                   )"""
            ),
            {"code": code, "name": name, "group": group},
        )
    for code, name, description, is_system in ROLES:
        bind.execute(
            sa.text(
                """INSERT INTO admin_roles (code, name, description, is_system)
                   SELECT CAST(:code AS VARCHAR), CAST(:name AS VARCHAR), CAST(:description AS TEXT), CAST(:is_system AS BOOLEAN)
                   WHERE NOT EXISTS (
                       SELECT 1 FROM admin_roles
                       WHERE code = CAST(:code AS VARCHAR) AND deleted_at IS NULL
                   )"""
            ),
            {"code": code, "name": name, "description": description, "is_system": is_system},
        )

    bind.execute(sa.text("""
        INSERT INTO admin_role_permissions (admin_role_id, permission_id)
        SELECT r.id, p.id FROM admin_roles r CROSS JOIN admin_permissions p
        WHERE r.code = 'SUPER_ADMIN' AND r.deleted_at IS NULL AND p.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM admin_role_permissions rp
              WHERE rp.admin_role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
          )
    """))
    for role_code, permission_codes in ROLE_PERMISSIONS.items():
        for permission_code in permission_codes:
            bind.execute(
                sa.text("""
                    INSERT INTO admin_role_permissions (admin_role_id, permission_id)
                    SELECT r.id, p.id FROM admin_roles r CROSS JOIN admin_permissions p
                    WHERE r.code = CAST(:role_code AS VARCHAR) AND r.deleted_at IS NULL
                      AND p.code = CAST(:permission_code AS VARCHAR) AND p.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM admin_role_permissions rp
                          WHERE rp.admin_role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
                      )
                """),
                {"role_code": role_code, "permission_code": permission_code},
            )

    bind.execute(sa.text("""
        INSERT INTO admin_role_assignments (admin_id, admin_role_id, assigned_by_admin_id)
        SELECT a.id, r.id, a.id FROM admins a CROSS JOIN admin_roles r
        WHERE r.code = 'SUPER_ADMIN' AND r.deleted_at IS NULL AND a.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM admin_role_assignments ara
              WHERE ara.admin_id = a.id AND ara.deleted_at IS NULL
          )
    """))
    op.execute("CREATE INDEX IF NOT EXISTS ix_name_change_requests_status ON name_change_requests (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_name_change_requests_user ON name_change_requests (user_id, role_id)")


def downgrade() -> None:
    # Veri backfill'i kasıtlı olarak geri alınmaz; bir sonraki downgrade tabloları kaldırır.
    pass
