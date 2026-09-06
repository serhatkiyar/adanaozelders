"""Admin izin etiketi: "Öğrenci talebi" -> "Ders talebi".

Ç-5 (6 Eyl 2026) — "öğrenci" bir ROL ADI olmaktan çıktı. Talebi açan hesap
sahibi öğrenci olmak zorunda değil (veli de olabilir; `core/flags.py`
`FLAG_MINOR_BOOKINGS_LIVE` 18 yaş altını Veli modeli yazılana kadar zaten
kapatıyor). Talebin konusu DERStir.

Bu YALNIZ görünen etiketi değiştirir. İzin ANAHTARLARI (`demands.view`,
`demands.manage`) DEĞİŞMEZ — yetki kontrolü onlara bakar ve rol atamaları
onlara bağlıdır. Anahtar değişseydi mevcut adminlerin yetkisi sessizce
düşerdi.

Eski migration'lara DOKUNULMADI: onlar tarihtir ve damgalanmış veritabanları
için sabit kalmalıdır. Etiket burada, ileriye doğru düzeltilir.
"""

from alembic import op

revision = "b3d7e91a4c26"
down_revision = "e7c2a91b5d3f"
branch_labels = None
depends_on = None

_ESKI_YENI = [
    ("demands.view", "Öğrenci talebi görüntüleme", "Ders talebi görüntüleme"),
    ("demands.manage", "Öğrenci talebi yönetimi", "Ders talebi yönetimi"),
]


def upgrade() -> None:
    for kod, eski, yeni in _ESKI_YENI:
        # `name = :eski` koşulu bilinçli: etiketi elle değiştirmiş bir kurulumu
        # ezmeyelim. Koşulsuz UPDATE, operatörün kendi yazdığı adı sessizce
        # geri alırdı.
        op.execute(
            "UPDATE admin_permissions SET name = '%s' "
            "WHERE code = '%s' AND name = '%s'" % (yeni, kod, eski)
        )


def downgrade() -> None:
    for kod, eski, yeni in _ESKI_YENI:
        op.execute(
            "UPDATE admin_permissions SET name = '%s' "
            "WHERE code = '%s' AND name = '%s'" % (eski, kod, yeni)
        )
