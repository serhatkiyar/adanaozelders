"""İzin kataloğu ↔ veritabanı eşitliği (gerçek Postgres).

Statik test (tests/test_admin_permission_catalog.py) router'ların istediği
izinlerin KODDA tanımlı olduğunu denetler; bu test onların DB'ye gerçekten
yazıldığını doğrular. İkisi birlikte, "izin kodda var ama migration yazılmadı"
boşluğunu kapatır — hakediş defterini erişilemez bırakan hata tam olarak
oradaydı.
"""
from __future__ import annotations

from sqlalchemy import text

from core.admin_permissions import PERMISSION_CODES


async def test_katalogdaki_tum_izinler_veritabaninda_var(db):
    rows = await db.execute(
        text("SELECT code FROM admin_permissions WHERE deleted_at IS NULL")
    )
    in_db = {r[0] for r in rows}
    missing = PERMISSION_CODES - in_db
    assert not missing, (
        f"katalogda olup DB'de olmayan izinler: {sorted(missing)} — "
        "eksik migration"
    )


async def test_super_admin_tum_izinlere_sahip(db):
    """SUPER_ADMIN tanımı gereği her yönetim yetkisine sahiptir.

    Yeni bir izin eklenip SUPER_ADMIN'e bağlanmazsa, süper admin o ekranı
    açamaz ve bunu kimse fark etmez (menü öğesi gizlenir).
    """
    rows = await db.execute(
        text(
            "SELECT p.code FROM admin_permissions p "
            "JOIN admin_role_permissions rp ON rp.permission_id = p.id "
            "AND rp.deleted_at IS NULL "
            "JOIN admin_roles r ON r.id = rp.admin_role_id AND r.deleted_at IS NULL "
            "WHERE r.code = 'SUPER_ADMIN' AND p.deleted_at IS NULL"
        )
    )
    granted = {r[0] for r in rows}
    missing = PERMISSION_CODES - granted
    assert not missing, f"SUPER_ADMIN'e bağlanmamış izinler: {sorted(missing)}"
