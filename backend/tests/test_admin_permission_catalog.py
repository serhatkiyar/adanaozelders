"""Router'ların istediği her admin izni katalogda tanımlı olmalı.

Neden: izin kataloğu yalnız migration'larda seed ediliyordu. Yeni bir yönetim
ucu `require_admin_permission("payments.view")` yazıp izni kataloğa eklemezse
uç HİÇBİR admin için çalışmaz (SUPER_ADMIN dahil — yetki role bağlı izin
satırından okunur, olmayan izin kimseye bağlanamaz) ve menü öğesi de gizlendiği
için hata fark edilmez. Hakediş defteri tam olarak böyle erişilemez kalmıştı.

Bu test, kaynak koddaki izin kullanımlarını kataloğa karşı denetler; DB ile
katalog eşitliğini doğrulama paketi (gerçek Postgres) kontrol eder.
"""
from __future__ import annotations

import pathlib
import re

from core.admin_permissions import PERMISSION_CATALOG, PERMISSION_CODES

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ROUTERS = BACKEND / "api" / "routers"

_USAGE = re.compile(r"require_(?:admin_permission|roles_or_admin_permission)\(\s*\"([a-z_]+\.[a-z_]+)\"")


def _used_permission_codes() -> dict[str, list[str]]:
    """İzin kodu → onu kullanan dosyalar."""
    found: dict[str, list[str]] = {}
    for path in sorted(ROUTERS.glob("*.py")):
        for code in _USAGE.findall(path.read_text(encoding="utf-8")):
            found.setdefault(code, []).append(path.name)
    return found


def test_used_permissions_exist_in_catalog() -> None:
    used = _used_permission_codes()
    assert used, "hiç izin kullanımı bulunamadı — regex bozulmuş olabilir"

    missing = {code: files for code, files in used.items() if code not in PERMISSION_CODES}
    assert not missing, (
        "Bu izinler router'larda isteniyor ama katalogda YOK — uç hiçbir admin "
        "için çalışmaz. core/admin_permissions.py'ye ekleyin ve DB'ye yazan bir "
        f"migration üretin: {missing}"
    )


def test_catalog_has_no_duplicates() -> None:
    codes = [code for code, _n, _g in PERMISSION_CATALOG]
    assert len(codes) == len(set(codes)), "katalogda tekrar eden izin kodu var"


#: İzin kodunun eylem kısmı için İZİNLİ sözlük. Serbest bırakılmaz: yazım
#: hatası (`inventory.aply`) sessiz 403 üretir, o yüzden liste dar tutulur.
#:
#: `view`/`manage` çifti uzun süre yetti; F29 ile üçüncü ve dördüncü eylem
#: eklendi çünkü iki eylem **görev ayrılığını ifade edemiyor**: envanteri
#: SAYAN kişinin, farkı tek başına UYGULAYABİLMESİ gerekmez. Bunu tek bir
#: `inventory.manage` altında toplamak, ayrımı yalnız arayüzde bırakırdı.
#:
#: `pack` (F30) aynı gerekçenin devamıdır: paketi TOPLAYAN kişinin, o paketi
#: tek başına çözebilmesi (`packing.manage` — void/unpack/return-in/repack)
#: görev ayrılığını yok ederdi. Sözlük yine dar tutulur; yeni bir eylem ancak
#: böyle bir ayrım gerçekten gerekince eklenir.
_ALLOWED_ACTIONS = ("view", "manage", "count", "apply", "pack")


def test_catalog_entries_are_well_formed() -> None:
    kalip = re.compile(rf"[a-z_]+\.({'|'.join(_ALLOWED_ACTIONS)})")
    for code, name, group in PERMISSION_CATALOG:
        assert kalip.fullmatch(code), f"beklenmeyen kod: {code}"
        assert name and group, f"eksik ad/grup: {code}"
