"""Startup'ta veritabanı şemasını hazırlama yardımcıları.

ÖNEMLİ BAĞLAM: Mevcut Alembic "initial" revizyonu (6c1c09c8b1f4) dolu bir dev
DB'sine karşı autogenerate edildiği için TABLOLARI/EXTENSION'LARI OLUŞTURMAZ
(yalnızca birkaç index farkını içerir). Bu yüzden temiz bir DB'de salt
`alembic upgrade head` çalıştırmak tam şemayı KURAMAZ.

Bu nedenle şema şöyle garanti edilir:
  1) `Base.metadata.create_all` — eksik tabloları ve (before_create event'i ile)
     pg_trgm/btree_gist extension'larını idempotent olarak kurar. Temiz DB'de tam
     güncel şemayı, mevcut DB'de yalnız eksikleri oluşturur (var olanı bozmaz).
  2) `alembic stamp head` — Alembic sürüm işaretçisini en güncel revizyona sabitler
     (gelecekteki incremental migration'lar doğru baz alır).

NOT (follow-up): Temiz bir Postgres erişilebildiğinde, boş bir DB'ye karşı tek bir
düzgün "initial" migration (--autogenerate) üretip eskileri squash etmek ve buradaki
create_all bağımlılığını kaldırmak idealdir.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from core.database import Base, engine

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

# create_all MEVCUT tablolara yeni KOLON eklemez. Sonradan eklenen kolonları, mevcut
# dev DB'lerde de garanti etmek için idempotent ALTER ile uygularız (fresh DB'de no-op).
_ADDED_COLUMNS_DDL: tuple[str, ...] = (
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_text VARCHAR(300)",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_lat NUMERIC(9,6)",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_lng NUMERIC(9,6)",
)


def _config() -> Config:
    cfg = Config(str(_ALEMBIC_INI))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


def _stamp_head() -> None:
    command.stamp(_config(), "head")


async def ensure_schema() -> None:
    """Şemanın güncel olduğunu garanti eder (create_all + alembic stamp head)."""
    # Tüm modellerin metadata'ya yüklü olduğundan emin ol.
    import models  # noqa: F401

    logger.info("Schema: ensuring tables/extensions via create_all")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for ddl in _ADDED_COLUMNS_DDL:
            await conn.execute(text(ddl))
    # stamp, env.py online modu (asyncio.run) kullandığından ayrı thread'de.
    await asyncio.to_thread(_stamp_head)
    logger.info("Schema: ready, alembic stamped to head")
