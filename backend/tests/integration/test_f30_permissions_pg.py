"""F30 izin dağıtımı — GERÇEK PostgreSQL (migration uygulanmış şema).

Denetim bulgusu 2: migration METNİNDE izin ve rol adlarının geçmesini aramak
yetersizdir. "packing.manage" ve "OPERATIONS_MANAGER" aynı dosyada geçtiği için
o test, OPERATIONS_MANAGER'a yanlışlıkla `packing.manage` verilmesini
**yakalayamazdı**.

Burada `alembic upgrade head` sonrası oluşan **gerçek** rol→izin dağılımı
veritabanından okunur (`tests/integration/conftest.py:359-412` test DB'sini
koşulsuz migrate eder).

Beklenen dağılım (sözleşme §6) — F29'un gerekçesiyle aynı: paketleme bir
TİCARET operasyonudur; operasyon yöneticisi depoda paketler ama paketi çözme /
geri dönüş onaylama yetkisi ticaret yöneticisinde ve süper adminde kalır.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal

PACKING = ("packing.view", "packing.pack", "packing.manage")

#: Migration'ın kurduğu sistem rolleri
#: (`7121d6785a32_admin_roles_and_permissions.py:50-56`).
SISTEM_ROLLERI = (
    "SUPER_ADMIN",
    "EDUCATION_MANAGER",
    "COMMERCE_MANAGER",
    "MODERATOR",
    "OPERATIONS_MANAGER",
)

BEKLENEN: dict[str, set[str]] = {
    "SUPER_ADMIN": set(PACKING),
    "COMMERCE_MANAGER": set(PACKING),
    "OPERATIONS_MANAGER": {"packing.view", "packing.pack"},
    "EDUCATION_MANAGER": set(),
    "MODERATOR": set(),
}


async def _dagitim() -> dict[str, set[str]]:
    """Sistem rolü → sahip olduğu paketleme izinleri (aktif satırlar)."""
    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                text(
                    """
                    SELECT r.code AS rol, p.code AS izin
                    FROM admin_roles r
                    JOIN admin_role_permissions rp
                      ON rp.admin_role_id = r.id AND rp.deleted_at IS NULL
                    JOIN admin_permissions p
                      ON p.id = rp.permission_id AND p.deleted_at IS NULL
                    WHERE r.deleted_at IS NULL
                      AND r.code = ANY(:roller)
                      AND p.code LIKE 'packing.%'
                    """
                ),
                {"roller": list(SISTEM_ROLLERI)},
            )
        ).all()
    out: dict[str, set[str]] = {rol: set() for rol in SISTEM_ROLLERI}
    for satir in satirlar:
        out[satir.rol].add(satir.izin)
    return out


@pytest.mark.asyncio
async def test_izinler_VERITABANINDA_var(pg):
    """Katalogdaki izin DB'de yoksa hiçbir role bağlanamaz → sessiz 403
    (`core/admin_permissions.py:3-13`)."""
    async with AsyncSessionLocal() as s:
        mevcut = set(
            (
                await s.execute(
                    text(
                        "SELECT code FROM admin_permissions "
                        "WHERE code = ANY(:k) AND deleted_at IS NULL"
                    ),
                    {"k": list(PACKING)},
                )
            ).scalars()
        )
    eksik = sorted(set(PACKING) - mevcut)
    assert not eksik, f"migration bu izinleri DB'ye yazmamış: {eksik}"


@pytest.mark.asyncio
@pytest.mark.parametrize("rol", sorted(BEKLENEN))
async def test_rol_dagitimi_GERCEK_verilerle(pg, rol):
    """Rol başına TAM eşitlik ölçülür — fazlası da eksiği de kırar.

    Özellikle: OPERATIONS_MANAGER'a `packing.manage` sızarsa bu test kırılır
    (görev ayrılığı kaybı), `packing.pack` unutulursa da kırılır (depo çalışamaz).
    """
    gercek = (await _dagitim())[rol]
    assert gercek == BEKLENEN[rol], (
        f"{rol} dağıtımı yanlış — beklenen {sorted(BEKLENEN[rol])}, "
        f"gerçek {sorted(gercek)}"
    )


@pytest.mark.asyncio
async def test_OPERATIONS_MANAGER_paketi_COZEMEZ(pg):
    """Denetçinin açıkça istediği tek iddia, ayrı bir düğüm olarak.

    `packing.manage` = void / unpack / return-in / repack. Paketleyen kişinin
    kendi hatasını izsiz kapatabilmesi görev ayrılığını yok ederdi.

    **Önce `packing.pack` verilmiş olmalı:** aksi hâlde bu iddia F30 hiç
    yazılmadan da doğrudur (hiçbir izin yokken "manage yok" trivially geçer) ve
    kırmızı matriste yalancı yeşil üretirdi.
    """
    dagitim = (await _dagitim())["OPERATIONS_MANAGER"]
    assert "packing.pack" in dagitim, (
        "OPERATIONS_MANAGER paketleme yetkisi almamış — depo çalışamaz"
    )
    assert "packing.manage" not in dagitim, (
        "OPERATIONS_MANAGER paketi çözebiliyor — görev ayrılığı kayboldu"
    )


@pytest.mark.asyncio
async def test_BASKA_SISTEM_ROLLERINDE_paketleme_izni_YOK(pg):
    """Eğitim yöneticisi ve moderatör depo operasyonuna dokunamaz."""
    dagitim = await _dagitim()
    for rol in ("EDUCATION_MANAGER", "MODERATOR"):
        assert not dagitim[rol], f"{rol} paketleme izni almış: {sorted(dagitim[rol])}"


@pytest.mark.asyncio
async def test_katalog_ile_DB_ayrismiyor(pg):
    """`PERMISSION_CATALOG` ile DB tek yönde bile ayrışmamalı: katalogda olup
    DB'de olmayan izin sessiz 403 üretir, DB'de olup katalogda olmayan izin
    yetki ekranında adsız görünür."""
    from core.admin_permissions import PERMISSION_CODES

    async with AsyncSessionLocal() as s:
        db_kodlari = set(
            (
                await s.execute(
                    text(
                        "SELECT code FROM admin_permissions "
                        "WHERE code LIKE 'packing.%' AND deleted_at IS NULL"
                    )
                )
            ).scalars()
        )
    katalog = {k for k in PERMISSION_CODES if k.startswith("packing.")}
    # Boş == boş tuzağı: F30 yazılmadan da geçerdi. Önce varlık, sonra eşitlik.
    assert katalog == set(PACKING), f"katalog eksik: {sorted(set(PACKING) - katalog)}"
    assert katalog == db_kodlari, (
        f"katalog {sorted(katalog)} ile DB {sorted(db_kodlari)} ayrışmış"
    )
