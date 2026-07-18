"""admin roles and permissions

Revision ID: 7121d6785a32
Revises: 783b63fa54b6
Create Date: 2026-07-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7121d6785a32"
down_revision: Union[str, Sequence[str], None] = "783b63fa54b6"
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
    op.create_table(
        "admin_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("group", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_admin_permissions_code_active", "admin_permissions", ["code"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table(
        "admin_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_admin_roles_code_active", "admin_roles", ["code"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table(
        "admin_role_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_role_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["admin_role_id"], ["admin_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["admin_permissions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_role_permissions_role", "admin_role_permissions", ["admin_role_id"])
    op.create_index("uq_admin_role_permissions_active", "admin_role_permissions", ["admin_role_id", "permission_id"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table(
        "admin_role_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("admin_role_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["admin_id"], ["admins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["admin_role_id"], ["admin_roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_by_admin_id"], ["admins.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_role_assignments_role", "admin_role_assignments", ["admin_role_id"])
    op.create_index("uq_admin_role_assignments_admin_active", "admin_role_assignments", ["admin_id"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))

    permission_table = sa.table("admin_permissions", sa.column("code"), sa.column("name"), sa.column("group"))
    role_table = sa.table("admin_roles", sa.column("code"), sa.column("name"), sa.column("description"), sa.column("is_system"))
    op.bulk_insert(permission_table, [{"code": code, "name": name, "group": group} for code, name, group in PERMISSIONS])
    op.bulk_insert(role_table, [{"code": code, "name": name, "description": description, "is_system": is_system} for code, name, description, is_system in ROLES])
    op.execute("""
        INSERT INTO admin_role_permissions (admin_role_id, permission_id)
        SELECT r.id, p.id FROM admin_roles r CROSS JOIN admin_permissions p
        WHERE r.code = 'SUPER_ADMIN'
    """)
    for role_code, permission_codes in ROLE_PERMISSIONS.items():
        quoted = ", ".join("'" + code.replace("'", "''") + "'" for code in permission_codes)
        op.execute(f"""
            INSERT INTO admin_role_permissions (admin_role_id, permission_id)
            SELECT r.id, p.id FROM admin_roles r CROSS JOIN admin_permissions p
            WHERE r.code = '{role_code}' AND p.code IN ({quoted})
        """)
    op.execute("""
        INSERT INTO admin_role_assignments (admin_id, admin_role_id, assigned_by_admin_id)
        SELECT a.id, r.id, a.id FROM admins a CROSS JOIN admin_roles r
        WHERE r.code = 'SUPER_ADMIN' AND a.deleted_at IS NULL
    """)


def downgrade() -> None:
    op.drop_index("uq_admin_role_assignments_admin_active", table_name="admin_role_assignments", postgresql_where=sa.text("deleted_at IS NULL"))
    op.drop_index("ix_admin_role_assignments_role", table_name="admin_role_assignments")
    op.drop_table("admin_role_assignments")
    op.drop_index("uq_admin_role_permissions_active", table_name="admin_role_permissions", postgresql_where=sa.text("deleted_at IS NULL"))
    op.drop_index("ix_admin_role_permissions_role", table_name="admin_role_permissions")
    op.drop_table("admin_role_permissions")
    op.drop_index("uq_admin_roles_code_active", table_name="admin_roles", postgresql_where=sa.text("deleted_at IS NULL"))
    op.drop_table("admin_roles")
    op.drop_index("uq_admin_permissions_code_active", table_name="admin_permissions", postgresql_where=sa.text("deleted_at IS NULL"))
    op.drop_table("admin_permissions")
