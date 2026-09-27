"""scripts/yedek.sh — yerel yedekler yalnız root'a açık (dizin 700, dosyalar 600).

Betik sahte `docker` ile gerçekten çalıştırılır. Sahte docker, MinIO tar'ını
konteynerdeki gibi 644 izinle yazar; betiğin bunu 600'e çekmesi beklenir.
POSIX izinleri gerektirir; Windows'ta atlanır.
"""
from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

BETIK = Path(__file__).resolve().parents[2] / "scripts" / "yedek.sh"
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX izinleri gerekli")

SAHTE_DOCKER = r"""#!/usr/bin/env bash
if [[ "$1" == compose ]]; then echo "PGDMP-sahte-dump"; exit 0; fi
if [[ "$1" == run ]]; then
  for a in "$@"; do case "$a" in *:/cikti) cikti="${a%%:/cikti}";; /cikti/*) dosya="${a#/cikti/}";; esac; done
  echo "tar" > "$cikti/$dosya"; chmod 644 "$cikti/$dosya"; exit 0
fi
exit 1
"""


@pytest.fixture
def proje(tmp_path):
    bin_ = tmp_path / "bin"; bin_.mkdir()
    (bin_ / "docker").write_text(SAHTE_DOCKER, encoding="utf-8", newline="\n"); (bin_ / "docker").chmod(0o755)
    p = tmp_path / "proje"; p.mkdir()
    (p / ".env.prod").write_text("POSTGRES_USER=u\nPOSTGRES_DB=d\nGIZLI=x\n", encoding="utf-8")
    (p / ".env.prod").chmod(0o600)
    (p / "backups").mkdir(mode=0o755)
    return {"p": p, "env": {**os.environ, "PATH": f"{bin_}{os.pathsep}{os.environ['PATH']}", "PROJE": str(p)}}


def _izin(yol: Path) -> int:
    return stat.S_IMODE(yol.stat().st_mode)


def test_dizin_700_dump_tar_env_600(proje):
    r = subprocess.run(["bash", str(BETIK)], env=proje["env"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    b = proje["p"] / "backups"
    assert _izin(b) == 0o700
    dosyalar = sorted(b.iterdir())
    assert {f.name.split("-")[0] for f in dosyalar} == {"db", "minio", "env"}
    for f in dosyalar:
        assert _izin(f) == 0o600, f"{f.name} {oct(_izin(f))}"


def test_betik_umask_ve_varsayilan_proje_yolu_korunur():
    metin = BETIK.read_text(encoding="utf-8")
    assert "set -euo pipefail" in metin and "umask 077" in metin
    assert 'PROJE="${PROJE:-/opt/adanaozelders}"' in metin
    assert 'chmod 700 "$HEDEF"' in metin and 'chmod 600 "$HEDEF/minio-$TARIH.tar.gz"' in metin
