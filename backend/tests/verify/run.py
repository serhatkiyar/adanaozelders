"""Doğrulama paketini izole veritabanında çalıştırır.

Neden gerekli: kök `conftest.py`, CI'da .env olmadan çalışabilmek için
`os.environ.setdefault("POSTGRES_USER", "test")` gibi SAHTE varsayılanlar
koyar. `setdefault` env'de değer yoksa yazdığından, `.env` dosyasındaki gerçek
kimlik bilgileri (pydantic tarafından okunur) devreye giremez ve bağlantı
"role test does not exist" ile düşer.

Bu runner `.env`'i okuyup gerçek değerleri ortama koyar, veritabanı adını
`adana_verify` ile değiştirir ve pytest'i alt süreç olarak çalıştırır.

Kullanım (backend/ içinden):
    python tests/verify/run.py            # tüm doğrulama paketi
    python tests/verify/run.py -k A1      # tek senaryo
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

VERIFY_DB = "adana_verify"
BACKEND = pathlib.Path(__file__).resolve().parents[2]


def load_dotenv(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def main() -> int:
    env = os.environ.copy()
    env.update(load_dotenv(BACKEND / ".env"))
    # İzole veritabanı — geliştirme verisine dokunulmaz.
    env["POSTGRES_DB"] = VERIFY_DB
    # Guard'lar test ortamında beklenmedik davranmasın.
    env["AUTO_CREATE_DB"] = "False"
    env["ENVIRONMENT"] = "development"

    cmd = [
        sys.executable, "-m", "pytest",
        "tests/verify", "-q", "-p", "no:cacheprovider",
        # Tek event loop: her testte yeni loop + engine.dispose()
        # kombinasyonu Windows/asyncpg'de bağlantıyı asıyor.
        "-o", "asyncio_default_fixture_loop_scope=session",
        "-o", "asyncio_default_test_loop_scope=session",
        *sys.argv[1:],
    ]
    print(f">> {' '.join(cmd)}  (POSTGRES_DB={VERIFY_DB})", flush=True)
    return subprocess.run(cmd, cwd=BACKEND, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
