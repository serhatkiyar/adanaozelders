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
    # E-posta doğrulama durumu (EmailVerificationMixin) — mevcut DB'lere de uygula.
    "ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
    # Admin hesapları güvenilir kabul edilir; eski admin satırlarını doğrulanmış yap
    # (idempotent: ilk koşudan sonra NULL kalmaz). Tutor/client gerçekten doğrulamalı.
    "UPDATE admins SET email_verified_at = now() WHERE email_verified_at IS NULL",
    # Ders kaynaklarına dosya eki desteği (link vs yüklenmiş dosya).
    "ALTER TABLE booking_resources ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'link'",
    "ALTER TABLE booking_resources ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)",
    "ALTER TABLE booking_resources ADD COLUMN IF NOT EXISTS content_type VARCHAR(120)",
    "ALTER TABLE booking_resources ADD COLUMN IF NOT EXISTS size_bytes INTEGER",
    # Eğitmen eğitim bilgisine diploma/belge eki (zorunlu onay kanıtı).
    "ALTER TABLE tutor_educations ADD COLUMN IF NOT EXISTS document_url VARCHAR(500)",
    "ALTER TABLE tutor_educations ADD COLUMN IF NOT EXISTS document_name VARCHAR(255)",
    # Kelime kartı aralığı gün → dakika (Anki öğrenme adımları). Eski kolonu (varsa)
    # bırakıp yenisini ekleriz; tablo yeni olduğundan veri kaybı yok.
    "ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS interval_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE flashcards DROP COLUMN IF EXISTS interval_days",
)


def _config() -> Config:
    cfg = Config(str(_ALEMBIC_INI))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


def _run_stamp_subprocess():
    import subprocess
    import sys
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "stamp", "head"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Alembic stamp failed: {result.stderr}")

async def ensure_schema() -> None:
    """Şemanın güncel olduğunu garanti eder (create_all + alembic stamp head)."""
    # Tüm modellerin metadata'ya yüklü olduğundan emin ol.
    import models  # noqa: F401

    logger.info("Schema: ensuring tables/extensions via create_all")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for ddl in _ADDED_COLUMNS_DDL:
            await conn.execute(text(ddl))
            
    # stamp komutunu subprocess olarak çalıştır (Windows'ta uvicorn + asyncio.run dead-lock'ını önler)
    # Windows SelectorEventLoop hatası almamak için standart subprocess kütüphanesini to_thread ile kullanıyoruz.
    logger.info("Schema: stamping alembic head via sync subprocess")
    try:
        await asyncio.to_thread(_run_stamp_subprocess)
        logger.info("Schema: ready, alembic stamped to head")
    except Exception as e:
        logger.error(str(e))
