"""Startup'ta veritabanı şemasını hazırlama.

Şema **tek kaynaktan** yönetilir: `migrations/versions/` altındaki Alembic
baseline migration'ı. Açılışta (`AUTO_CREATE_DB=true`) `ensure_schema` yalnızca
`alembic upgrade head` çalıştırır:
  - Boş bir DB'de tüm şemayı (tablolar, extension'lar, enum'lar, GiST/GIN index'ler,
    exclusion constraint, generated/TSVECTOR kolonlar) kurar.
  - Zaten güncel bir DB'de no-op'tur.

Tarihsel not: Eskiden `Base.metadata.create_all` + elle `ALTER ... ADD COLUMN`
listesi kullanılırdı çünkü ilk "initial" migration dolu bir DB'ye karşı üretilmiş,
boş DB'yi kuramıyordu. O bağımlılık, boş Postgres'e karşı autogenerate edilip elle
tamamlanan (extension'lar) tek bir baseline migration ile kaldırıldı; create_all
yolunun ürettiği şemayla `pg_dump` diff'i birebir doğrulandı.

Geçiş guard'ı: squash öncesinde `alembic_version`'ı artık var olmayan bir revizyona
(ör. eski `c4e1f0a2b3d5`) stamp'lenmiş DB'lerde `upgrade head` "revizyon bulunamadı"
hatası verir. Bu durumda tablolar zaten mevcut olduğundan `stamp head --purge` ile
baseline'a işaretlenip upgrade no-op'a indirgenir (canlı dev DB + diğer makineler
otomatik geçer).
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    """Alembic'i ayrı süreçte çalıştırır.

    Windows'ta uvicorn'un çalışan event loop'u içinde `command.upgrade`/`stamp`
    çağırmak SelectorEventLoop + asyncio.run dead-lock'ına yol açıyordu; subprocess
    bunu önler. env.py URL'yi `settings.DATABASE_URL`'den okur (miras alınan ortam).
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(_BACKEND_DIR),
        capture_output=True,
        text=True,
    )


def _provision_schema() -> None:
    """`alembic upgrade head`; gerekirse squash-öncesi DB'leri baseline'a taşı."""
    res = _run_alembic("upgrade", "head")
    if res.returncode == 0:
        return

    err = f"{res.stdout or ''}\n{res.stderr or ''}"
    # Squash öncesi stamp'lenmiş DB: eski revizyon script'i artık yok. Tablolar zaten
    # var olduğundan baseline'a yeniden işaretle (purge eski sürüm satırını siler).
    if "locate revision" in err or "Can't locate" in err:
        logger.warning(
            "Bilinmeyen alembic revizyonu; baseline'a 'stamp head --purge' uygulanıyor"
        )
        st = _run_alembic("stamp", "head", "--purge")
        if st.returncode != 0:
            raise RuntimeError(f"Alembic stamp failed: {st.stderr}")
        res2 = _run_alembic("upgrade", "head")
        if res2.returncode != 0:
            raise RuntimeError(f"Alembic upgrade failed: {res2.stderr}")
        return

    raise RuntimeError(f"Alembic upgrade failed: {res.stderr}")


async def ensure_schema() -> None:
    """Şemanın güncel olduğunu garanti eder (`alembic upgrade head`)."""
    # Tüm modellerin metadata'ya yüklü olduğundan emin ol (env.py de import eder).
    import models  # noqa: F401

    logger.info("Schema: alembic upgrade head (migration tek kaynak)")
    try:
        await asyncio.to_thread(_provision_schema)
        logger.info("Schema: ready (head)")
    except Exception as e:
        logger.error(str(e))
        raise
