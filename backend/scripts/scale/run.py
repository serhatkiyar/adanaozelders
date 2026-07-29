"""Ölçek provasını izole veritabanında çalıştırır.

Neden ayrı bir runner: `.env` gerçek geliştirme veritabanını gösterir ve bu
paket YÜZ BİNLERCE satır yazar. Runner `.env`'i okur, veritabanı adını
`adana_scale` ile değiştirir, gerekirse veritabanını yaratıp şemayı kurar,
sonra istenen komutu alt süreç olarak çalıştırır.

Kullanım (backend/ içinden):
    python scripts/scale/run.py --create        # DB yarat + alembic upgrade head
    python scripts/scale/run.py seed            # veriyi üret
    python scripts/scale/run.py seed --scale 0.1  # küçük prova
    python scripts/scale/run.py probe           # sorgu ölçümü
    python scripts/scale/run.py drop            # veritabanını sil
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

SCALE_DB = "adana_scale"
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


def scale_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(load_dotenv(BACKEND / ".env"))
    env["POSTGRES_DB"] = SCALE_DB
    # Uygulama açılış otomasyonları bu süreçte devreye girmemeli.
    env["AUTO_CREATE_DB"] = "False"
    env["SEED_DEMO_DATA"] = "False"
    env["ENVIRONMENT"] = "development"
    # Toplu yükleme ve ANALYZE, istek yolu için konan sorgu tavanını (15 sn)
    # meşru biçimde aşar; ölçüm veritabanında tavan kapalıdır.
    env["DB_STATEMENT_TIMEOUT_MS"] = "0"
    return env


def _run_admin_sql(env: dict[str, str], statements: list[str], *, database: str = "postgres") -> None:
    """Bakım komutlarını asyncpg ile çalıştırır (projede tek DB sürücüsü o).

    CREATE/DROP DATABASE transaction bloğunda çalışamaz; asyncpg'nin `execute`
    metodu implicit transaction açmadığından doğrudan uygundur.
    """
    import asyncio

    import asyncpg

    async def _go() -> None:
        conn = await asyncpg.connect(
            user=env["POSTGRES_USER"],
            password=env["POSTGRES_PASSWORD"],
            host=env.get("POSTGRES_HOST", "localhost"),
            port=int(env.get("POSTGRES_PORT", "5432")),
            database=database,
        )
        try:
            for sql in statements:
                await conn.execute(sql)
                print(f"   {sql}")
        finally:
            await conn.close()

    asyncio.run(_go())


def create() -> int:
    env = scale_env()
    print(f">> veritabanı hazırlanıyor: {SCALE_DB}")
    _run_admin_sql(
        env,
        [
            # Açık oturumlar DROP'u bloklar (ör. önceki probe süreci).
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{SCALE_DB}' AND pid <> pg_backend_pid()",
            f"DROP DATABASE IF EXISTS {SCALE_DB}",
            f"CREATE DATABASE {SCALE_DB}",
        ],
    )
    print(">> alembic upgrade head")
    rc = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env
    ).returncode
    if rc:
        return rc
    # Ölçüm için gerekli; kurulu değilse ölçüm EXPLAIN ANALYZE ile sürer (probe uyarır).
    try:
        _run_admin_sql(
            env,
            ["CREATE EXTENSION IF NOT EXISTS pg_stat_statements"],
            database=SCALE_DB,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"   ! pg_stat_statements kurulamadı: {exc}")
        print("     (postgresql.conf'ta shared_preload_libraries gerekir; ölçüm EXPLAIN ile sürer)")
    return 0


def drop() -> int:
    env = scale_env()
    _run_admin_sql(
        env,
        [
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{SCALE_DB}' AND pid <> pg_backend_pid()",
            f"DROP DATABASE IF EXISTS {SCALE_DB}",
        ],
    )
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__)
        return 0
    if args[0] == "--create":
        return create()
    if args[0] == "drop":
        return drop()

    target = {"seed": "scripts/scale/seed_scale.py", "probe": "scripts/scale/probe.py"}.get(
        args[0]
    )
    if target is None:
        print(f"bilinmeyen komut: {args[0]}")
        return 2
    cmd = [sys.executable, target, *args[1:]]
    print(f">> {' '.join(cmd)}  (POSTGRES_DB={SCALE_DB})", flush=True)
    return subprocess.run(cmd, cwd=BACKEND, env=scale_env()).returncode


if __name__ == "__main__":
    raise SystemExit(main())
