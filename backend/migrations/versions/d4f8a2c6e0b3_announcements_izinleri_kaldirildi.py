"""announcements.* izinleri kaldırıldı (CMS Faz 4)

İzin önce duyuru şeridini (İP-C2), sonra eski mağaza hero carousel'ini
yönetiyordu. İki yüzey de silindi: vitrin içeriği artık `content.*` ile
store_merchandising üzerinden yönetiliyor. Katalogda olmayan bir iznin DB'de
durması doğrulama paketini (katalog ↔ DB eşitliği) kırar; satırlar silinir.

Rol bağları da silinir — SUPER_ADMIN'in izin listesi kataloğun aynasıdır.

Revision ID: d4f8a2c6e0b3
Revises: 6686e9636638
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f8a2c6e0b3"
down_revision: Union[str, Sequence[str], None] = "6686e9636638"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REMOVED = ("announcements.view", "announcements.manage")


def upgrade() -> None:
    codes = ", ".join(f"'{c}'" for c in REMOVED)
    op.execute(
        f"""
        DELETE FROM admin_role_permissions
        WHERE permission_id IN (
            SELECT id FROM admin_permissions WHERE code IN ({codes})
        )
        """
    )
    op.execute(f"DELETE FROM admin_permissions WHERE code IN ({codes})")


def downgrade() -> None:
    # Geri dönüşte izinler `a4b6c8d0e2f4` mantığıyla yeniden eklenir; rol
    # bağları elle kurulmalıdır (hangi role verildiği artık kod tarafında
    # tanımsız olduğundan otomatik geri yükleme yanlış yetki doğurabilir).
    for code, name in (
        ("announcements.view", "Vitrin görsellerini görüntüleme"),
        ("announcements.manage", "Vitrin görsellerini yönetme"),
    ):
        op.execute(
            f"""
            INSERT INTO admin_permissions (code, name, "group")
            SELECT '{code}', '{name}', 'Platform'
            WHERE NOT EXISTS (
                SELECT 1 FROM admin_permissions
                WHERE code = '{code}' AND deleted_at IS NULL
            )
            """
        )
