"""Altyapı servisi yoksa: SKIP mi, HATA mı?

Gerçek Postgres / Redis / MinIO isteyen testler, servisi kurmamış bir
geliştiriciyi bloklamasın diye SKIP eder. Ama **CI'da aynı SKIP zehirlidir**:
"servis konteyneri hiç eklenmemiş" ve "eklendi ama yanlış adrese bakıyor"
hâlleri, gerçekten koşan bir suite'ten ayırt edilemeyecek biçimde YEŞİL görünür.
Doğrulama zemini böylece sessizce boşalır.

Bu proje bu tuzağa zaten düştü: `tests/verify/test_verify_storage_access.py`
CI'da MinIO olmadığı için altı testin tamamını atlıyordu ve dosyanın kendi
docstring'i bunu "CI'da MinIO servisi yoktur" diye normal sayıyordu — yani
hassas dosyaların anonim okunamadığı iddiası CI'da HİÇ kanıtlanmadı.

Bu yüzden davranış ortama göre AÇIKÇA seçilir:

    CI_REQUIRE_SERVICES=1  → servis yoksa test KIRILIR
    (ayarsız)              → servis yoksa test atlanır (yerel geliştirme)

CI iş akışı (`.github/workflows/ci.yml`) bu değişkeni iş seviyesinde ayarlar.
"""
from __future__ import annotations

import os
from typing import NoReturn

import pytest

_ACIK = {"1", "true", "yes", "on"}


def servisler_zorunlu() -> bool:
    """Eksik altyapı hata sayılmalı mı?"""
    return os.getenv("CI_REQUIRE_SERVICES", "").strip().lower() in _ACIK


def servis_yok(servis: str, sebep: object) -> NoReturn:
    """Servise ulaşılamadı: ortamın kuralına göre atla ya da kır."""
    mesaj = f"{servis} erişilemiyor: {sebep.__class__.__name__}: {sebep}"
    if servisler_zorunlu():
        pytest.fail(
            f"CI_REQUIRE_SERVICES=1 — {mesaj}. Servis konteyneri eksik ya da "
            f"yanlış adrese bakıyor; atlanan test yeşil sayılmaz.",
            pytrace=False,
        )
    pytest.skip(mesaj)
