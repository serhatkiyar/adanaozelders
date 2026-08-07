"""İP-5 · T-1 — TB-21: test ortamında ödeme sağlayıcısı GERÇEK olamaz.

Borç kaydı (`docs/teknik-borc.md` TB-21): kök `conftest.py` CI için
`POSTGRES_*`/`JWT_SECRET_KEY`/`AUTO_CREATE_DB` varsayılanlarını `setdefault`
ile koyuyor ama **`PAYMENT_PROVIDER`'ı koymuyor**. Geliştirici `.env`'inde
`PAYMENT_PROVIDER=iyzico` yazdığı için ayar teste sızıyor ve bazı yollar
(fixture'dan sağlayıcı almayanlar) **gerçek iyzico sandbox'ına ağ isteği
atıyor**. Ölçülmüş kanıt: `test_ip1b_silme_guard_pg.py::test_D4_...` →
`402: email hatalı format ile gönderilmiştir`.

Zararın üç yüzü var; en sinsisi üçüncüsü: sandbox isteği **başarılı** olsaydı
test yeşil kalır ve fake sağlayıcı yolunun hiç sınanmadığı fark edilmezdi.

## Bu dosya neden alt süreç kullanıyor

Suite'i koşan ortam (`scripts/ip5_test_env.ps1`) `PAYMENT_PROVIDER=fake`
verdiği için, bu süreç içinde `settings.PAYMENT_PROVIDER`'a bakmak
**yalancı yeşil** olurdu: değeri koyan conftest değil, koşum betiğidir.
Sözleşme ancak conftest'in kendi başına yaptığı iş ölçülerek sınanabilir —
bu yüzden ayrı bir Python süreci, ayrı bir çalışma dizini ve `.env`'i
`iyzico` yazan bir kurulum kullanılır.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

import pytest

pytestmark = pytest.mark.asyncio

_BACKEND = pathlib.Path(__file__).resolve().parents[2]

#: Nöbetçinin ret mesajındaki benzersiz işaret. Test ADLARINDA geçmez, bu
#: yüzden çıktıda görülmesi gerçekten nöbetçinin konuştuğu anlamına gelir
#: (kaynak metnini/test adını yakalayan yalancı yeşil kapalı).
_ISARET = "TB-21"


def _temiz_env() -> dict:
    """Koşum betiğinin koyduğu `PAYMENT_PROVIDER`'ı KALDIRIR.

    Değişkeni bırakmak testin ölçmek istediği şeyi (conftest'in kendi
    `setdefault`'unu) görünmez kılardı.
    """
    env = {**os.environ}
    env.pop("PAYMENT_PROVIDER", None)
    env["PYTHONPATH"] = str(_BACKEND)
    env["PYTHONIOENCODING"] = "utf-8"
    return env


# ── T-1a · Kök conftest ayarı .env'e RAĞMEN fake'e sabitliyor ───────────────


async def test_t1a_kok_conftest_saglayiciyi_fake_yapiyor(tmp_path):
    """Geçici çalışma dizinine `PAYMENT_PROVIDER=iyzico` yazan bir `.env` konur.

    `Settings` `env_file=".env"` ile GÖRELİ okur, yani dosyayı çalışma
    dizininden alır. Pydantic önceliği `os.environ` > `.env` olduğundan, kök
    conftest'in `setdefault`'u varsa sonuç `fake`; yoksa `.env` kazanır ve
    `iyzico` çıkar.
    """
    (tmp_path / ".env").write_text(
        "PAYMENT_PROVIDER=iyzico\n"
        "POSTGRES_USER=x\nPOSTGRES_PASSWORD=x\nPOSTGRES_DB=x\n"
        "JWT_SECRET_KEY=x\n",
        encoding="utf-8",
    )
    betik = (
        "import conftest\n"  # kök conftest: import edilmesi setdefault'ları uygular
        "from core.config import Settings\n"
        "print('PROVIDER=' + Settings().PAYMENT_PROVIDER)\n"
    )
    r = subprocess.run(
        [sys.executable, "-c", betik],
        cwd=str(tmp_path),
        env=_temiz_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    assert r.returncode == 0, f"{r.stdout}\n{r.stderr}"
    assert "PROVIDER=fake" in r.stdout, (
        "kök conftest PAYMENT_PROVIDER'ı fake'e sabitlemiyor — .env sızıyor: "
        f"{r.stdout}"
    )


# ── T-1b · Nöbetçi: gerçek sağlayıcıyla entegrasyon suite'i BAŞLAMAZ ────────


async def test_t1b_gercek_saglayiciyla_suite_reddediliyor(tmp_path):
    """`PAYMENT_PROVIDER=iyzico` açıkça verilirse suite koşmayı REDDETMELİ.

    `setdefault` yalnız değişken YOKKEN korur; açıkça verilmiş bir gerçek
    sağlayıcıyı ezmez (ezmesi de yanlış olurdu — env, ayarın son sözüdür).
    Bu yüzden ikinci bir savunma gerekir: suite başlarken gerçek sağlayıcı
    seçilmişse koşu durur. Ağa çıkan bir testin sessizce GEÇMESİ, düşmesinden
    daha tehlikelidir.
    """
    env = _temiz_env()
    env["PAYMENT_PROVIDER"] = "iyzico"
    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/integration/test_ip5_tax_writer_pg.py",
            "-q",
            "--no-header",
        ],
        cwd=str(_BACKEND),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )
    ciktı = r.stdout + r.stderr

    # Sıfırdan farklı çıkış kodu TEK BAŞINA kanıt DEĞİLDİR: hedef dosyadaki
    # herhangi bir testin kendi sebebiyle düşmesi de aynı kodu üretir (bu tuzağa
    # bir kez düşüldü — nöbetçi yokken de yeşil görünüyordu). Asıl kanıt iki
    # şeydir: nöbetçinin BENZERSİZ işareti ve hiçbir testin koşamamış olması.
    assert r.returncode != 0, f"gerçek sağlayıcıyla suite yeşil koştu:\n{ciktı}"
    assert _ISARET in ciktı, (
        f"nöbetçi tetiklenmedi (işaret {_ISARET!r} çıktıda yok):\n{ciktı}"
    )
    assert " passed" not in ciktı, (
        f"nöbetçi koşuyu durdurmadı, testler yine de koştu:\n{ciktı}"
    )


# ── T-1c · Bu koşumun kendi hijyeni ────────────────────────────────────────


async def test_t1c_bu_kosum_sahte_saglayiciyla(pg):
    """Nöbetçinin bu koşumda gerçekten etkin olduğunu doğrular.

    `pg` fixture'ı session kapsamlı DB fixture'ını (ve dolayısıyla nöbetçiyi)
    zincirler; buraya gelinebiliyorsa sağlayıcı gerçek değildir.
    """
    from core.config import settings

    assert settings.PAYMENT_PROVIDER.strip().lower() != "iyzico"
