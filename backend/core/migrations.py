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
    # Kütüphane operatörü rolü (role_id=4). Mevcut DB'lerde `role_type` PG enum'una 4.
    # değeri idempotent ekle (fresh DB'de create_all zaten 4 değerle kurar → no-op).
    # PG12+: ADD VALUE bir transaction içinde çalışabilir; yeni değer ancak commit'ten
    # sonra (seed aşamasında) kullanılır — ensure_schema bu transaction'ı önce commit eder.
    "ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'LIBRARY_OPERATOR'",
    # Kütüphane çalışma alanı saatlik ücreti (Faz 3 — saatlik koltuk rezervasyonu).
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS study_hourly_price NUMERIC(10,2)",
    # Kurumsal logo (1:1; cover_url banner). library_images tablosu create_all ile gelir.
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500)",
    # QR okutulamazsa elle girilen kısa doğrulama kodu (deneme bileti + çalışma rez.).
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS short_code VARCHAR(12)",
    "ALTER TABLE study_reservations ADD COLUMN IF NOT EXISTS short_code VARCHAR(12)",
    # Deneme içeriği & sonuç yönetimi. library_exam_catalogs tablosu create_all ile gelir;
    # mevcut tablolara yeni kolonlar idempotent eklenir.
    "ALTER TABLE library_exam_sessions ADD COLUMN IF NOT EXISTS catalog_id INTEGER REFERENCES library_exam_catalogs(id) ON DELETE SET NULL",
    "ALTER TABLE library_exam_sessions ADD COLUMN IF NOT EXISTS answer_key_url VARCHAR(500)",
    "ALTER TABLE library_exam_sessions ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_correct INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_wrong INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_blank INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_net NUMERIC(6,2)",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_rank INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS result_document_url VARCHAR(500)",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS results_entered_by_user_id INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS results_entered_by_role_id INTEGER",
    "ALTER TABLE exam_registrations ADD COLUMN IF NOT EXISTS results_entered_at TIMESTAMPTZ",
    # Kütüphane oturumu sonucunun öğrenci /denemeler panosuna idempotent projeksiyonu.
    "ALTER TABLE practice_exams ADD COLUMN IF NOT EXISTS source_registration_id INTEGER REFERENCES exam_registrations(id) ON DELETE SET NULL",
    # Kayıt başına tek projeksiyon (create_all mevcut tabloya index eklemez → elle).
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_exams_source_reg ON practice_exams (source_registration_id) WHERE source_registration_id IS NOT NULL",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_text VARCHAR(300)",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_lat NUMERIC(9,6)",
    "ALTER TABLE tutors ADD COLUMN IF NOT EXISTS location_lng NUMERIC(9,6)",
    # Kütüphane yapısal adresi (il/ilçe/mahalle/sokak/no) — elle girilir.
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS district VARCHAR(100)",
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(150)",
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS street VARCHAR(200)",
    "ALTER TABLE libraries ADD COLUMN IF NOT EXISTS building_no VARCHAR(30)",
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
    # To-Do gelişmeleri (Todoist benzeri): tekrarlama, gelen kutusu, 4-kademe öncelik.
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence VARCHAR(30)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false",
    # İç içe alt görev (Todoist): self-FK üst görev. Üst silinince alt da silinir.
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE",
    "ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS is_inbox BOOLEAN NOT NULL DEFAULT false",
    # Favoriler (Todoist): proje/etiket/filtre "Favoriler" bölümüne sabitlenir.
    # task_filters yeni tablo olduğundan create_all ile gelir; mevcut iki tabloya ekle.
    "ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE task_labels ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false",
    # Öncelik enum(LOW/MEDIUM/HIGH) → smallint(1..4). Yalnız kolon hâlâ enum ise dönüştür
    # (idempotent: dönüşümden sonra udt_name='int2' olur, blok atlanır).
    """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'priority'
          AND udt_name = 'task_priority'
      ) THEN
        ALTER TABLE tasks ALTER COLUMN priority DROP DEFAULT;
        ALTER TABLE tasks ALTER COLUMN priority TYPE smallint
          USING (CASE priority::text
                   WHEN 'HIGH' THEN 1
                   WHEN 'MEDIUM' THEN 3
                   WHEN 'LOW' THEN 4
                   ELSE 4 END);
        ALTER TABLE tasks ALTER COLUMN priority SET DEFAULT 4;
      END IF;
    END $$;
    """,
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
