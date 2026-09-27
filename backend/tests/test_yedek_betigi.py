"""scripts/backup-postgres.sh — MinIO aynalaması DB yedeğini durduramaz.

R2 geçişinden (27 Eyl 2026) sonra üretimde MinIO çalışmaz. Aynalama adımı
`set -e` altında düşerse betik restic'e gelmeden durur ve veritabanı yedeği
uzağa gitmez. Sözleşme:

* varsayılan (BACKUP_MINIO_ENABLED tanımsız/false): `mc` hiç çağrılmaz;
* true + aynalama başarısız: dump ve restic yine çalışır, betik 2 ile çıkar.

Betik gerçekten çalıştırılır; `docker`, `mc`, `restic` PATH'te sahte
komutlarla değiştirilir (sunucuya/depoya dokunulmaz).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BETIK = Path(__file__).resolve().parents[2] / "scripts" / "backup-postgres.sh"


def _bash() -> str | None:
    if sys.platform == "win32":
        git_bash = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
        return str(git_bash) if git_bash.exists() else None
    return shutil.which("bash")


BASH = _bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="bash bulunamadı")


def _sahte(dizin: Path, ad: str, govde: str) -> None:
    yol = dizin / ad
    yol.write_text("#!/usr/bin/env bash\n" + govde + "\n", encoding="utf-8", newline="\n")
    yol.chmod(0o755)


def _calistir(tmp_path: Path, **ortam: str) -> tuple[subprocess.CompletedProcess, str]:
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    iz = tmp_path / "iz.log"
    _sahte(bin_, "docker", 'echo "-- sahte dump $(date +%s%N)"')
    _sahte(bin_, "mc", f'echo "mc $*" >> "{iz.as_posix()}"; exit 1')
    _sahte(bin_, "restic", f'echo "restic $1" >> "{iz.as_posix()}"')
    env_dosyasi = tmp_path / ".env.prod"
    env_dosyasi.write_text("POSTGRES_USER=u\nPOSTGRES_DB=d\n", encoding="utf-8", newline="\n")
    temel = {k: v for k, v in os.environ.items() if k != "BACKUP_MINIO_ENABLED"}
    env = {
        **temel,
        # Git Bash, Windows PATH'ini kendisi POSIX biçimine çevirir.
        "PATH": str(bin_) + os.pathsep + os.environ.get("PATH", ""),
        "ENV_FILE": env_dosyasi.as_posix(),
        "BACKUP_DIR": (tmp_path / "yedek").as_posix(),
        "MIN_BYTES": "1",
        "RESTIC_REPOSITORY": "sahte:depo",
        **ortam,
    }
    sonuc = subprocess.run(
        [BASH, BETIK.as_posix()], cwd=tmp_path, env=env,
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    return sonuc, (iz.read_text(encoding="utf-8") if iz.exists() else "")


def test_varsayilan_minio_aynalamasi_kapali_restic_calisir(tmp_path):
    sonuc, iz = _calistir(tmp_path)
    assert sonuc.returncode == 0, sonuc.stderr
    assert "mc " not in iz, "varsayılanda MinIO aynalanmamalı"
    assert "restic backup" in iz
    assert "aynalama kapalı" in sonuc.stdout


def test_aynalama_basarisizsa_db_yedegi_ve_restic_yine_calisir(tmp_path):
    sonuc, iz = _calistir(tmp_path, BACKUP_MINIO_ENABLED="true")
    assert "mc mirror" in iz
    assert "restic backup" in iz, "MinIO hatası uzak DB yedeğini durdurdu"
    assert sonuc.returncode == 2
    assert list((tmp_path / "yedek").glob("adana-*.sql.gz")), "dump alınmadı"
