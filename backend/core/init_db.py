from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

import models  # noqa: F401  (populate metadata + register extension DDL)
from core.config import settings
from core.database import AsyncSessionLocal, Base, engine
from core.security import hash_password
from models.admin import Admin
from models.role import ROLE_IDS, Role, RoleType


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _apply_lightweight_migrations(conn)
    async with AsyncSessionLocal() as session:
        await _seed_roles(session)
        await _seed_admin(session)
        await session.commit()


_USER_TABLES = ("clients", "tutors", "admins")


async def _apply_lightweight_migrations(conn: AsyncConnection) -> None:
    # create_all mevcut tabloları ALTER etmediğinden, şema farklarını idempotent kapat.
    # (Alembic yok; bu projede dev migrasyonları burada toplanır.)
    await conn.execute(
        text("ALTER TABLE tutors ADD COLUMN IF NOT EXISTS teaching_mode VARCHAR(20)")
    )
    for table in _USER_TABLES:
        await conn.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS about TEXT")
        )

    await _migrate_split_full_name(conn)

    # Review: eğitmen yanıtı kolonu.
    await conn.execute(
        text("ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tutor_reply TEXT")
    )

    # Booking: iptal nedeni (karşı tarafa bildirimde gösterilir).
    await conn.execute(
        text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT")
    )

    # Mesajlaşma: okunmamış sayacı için taraf başına son okuma zamanı.
    await conn.execute(
        text(
            "ALTER TABLE conversations "
            "ADD COLUMN IF NOT EXISTS client_last_read_at timestamptz"
        )
    )
    await conn.execute(
        text(
            "ALTER TABLE conversations "
            "ADD COLUMN IF NOT EXISTS tutor_last_read_at timestamptz"
        )
    )

    # Booking: ders biçimi + canlı ders odası + ders öncesi hatırlatma bayrağı.
    await conn.execute(
        text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mode VARCHAR(20)")
    )
    await conn.execute(
        text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location TEXT")
    )
    await conn.execute(
        text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meeting_room VARCHAR(120)")
    )
    await conn.execute(
        text(
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent "
            "boolean NOT NULL DEFAULT false"
        )
    )

    # Q&A: soruları derse (booking) bağla; haklar ders bazında kümelenir.
    await conn.execute(
        text("ALTER TABLE qa_threads ADD COLUMN IF NOT EXISTS booking_id INTEGER")
    )
    await conn.execute(
        text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM information_schema.key_column_usage k
                JOIN information_schema.table_constraints t
                  ON k.constraint_name = t.constraint_name
                WHERE t.table_name = 'qa_threads'
                  AND t.constraint_type = 'FOREIGN KEY'
                  AND k.column_name = 'booking_id'
              ) THEN
                ALTER TABLE qa_threads
                  ADD CONSTRAINT fk_qa_threads_booking
                  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
              END IF;
            END $$;
            """
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_qa_threads_booking "
            "ON qa_threads (booking_id)"
        )
    )

    await _migrate_qa_quota_counter(conn)
    await _migrate_qa_messages(conn)
    await _migrate_tutor_demographics(conn)
    await _migrate_client_demographics(conn)


async def _migrate_qa_messages(conn: AsyncConnection) -> None:
    # QA artık çok mesajlı (chat). Mevcut question/answer'ı qa_messages'a bir kez taşı.
    await conn.execute(
        text(
            """
            INSERT INTO qa_messages (thread_id, sender_role, body, created_at, updated_at)
            SELECT t.id, 'CLIENT', t.question, t.created_at, t.created_at
            FROM qa_threads t
            WHERE t.question IS NOT NULL AND t.question <> ''
              AND NOT EXISTS (SELECT 1 FROM qa_messages m WHERE m.thread_id = t.id);
            """
        )
    )
    await conn.execute(
        text(
            """
            INSERT INTO qa_messages (thread_id, sender_role, body, created_at, updated_at)
            SELECT t.id, 'TUTOR', t.answer,
                   COALESCE(t.answered_at, t.updated_at), COALESCE(t.answered_at, t.updated_at)
            FROM qa_threads t
            WHERE t.answer IS NOT NULL AND t.answer <> ''
              AND NOT EXISTS (
                SELECT 1 FROM qa_messages m WHERE m.thread_id = t.id AND m.sender_role = 'TUTOR'
              );
            """
        )
    )


async def _migrate_tutor_demographics(conn: AsyncConnection) -> None:
    # Tutor demografi (yaş & cinsiyet) — filtreleme için. Client tarafında bilinçli olarak yok (KVKK).
    await conn.execute(
        text(
            """
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender') THEN
                CREATE TYPE gender AS ENUM ('MALE','FEMALE','UNSPECIFIED');
              END IF;
            END $$;
            """
        )
    )
    await conn.execute(text("ALTER TABLE tutors ADD COLUMN IF NOT EXISTS birth_date date"))
    await conn.execute(text("ALTER TABLE tutors ADD COLUMN IF NOT EXISTS gender gender"))
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_tutors_demo_active ON tutors (gender, birth_date) "
            "WHERE deleted_at IS NULL AND status = 'APPROVED'"
        )
    )


async def _migrate_client_demographics(conn: AsyncConnection) -> None:
    # Öğrenci demografi (yaş & cinsiyet) — kayıt sırasında opsiyonel toplanır, profilden düzenlenir.
    # 'gender' enum tipi tutor migration'ında zaten oluşturulmuş olabilir; guard ile idempotent.
    await conn.execute(
        text(
            """
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender') THEN
                CREATE TYPE gender AS ENUM ('MALE','FEMALE','UNSPECIFIED');
              END IF;
            END $$;
            """
        )
    )
    await conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date date"))
    await conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS gender gender"))
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_clients_demo_active ON clients (gender, birth_date) "
            "WHERE deleted_at IS NULL"
        )
    )


async def _migrate_qa_quota_counter(conn: AsyncConnection) -> None:
    # "3 soru hakkı" otoritesi bookings.qa_used sayacına taşınır (atomik tüketim).
    # COUNT-then-INSERT race'i DB seviyesinde kapatılır; CHECK son savunmadır.
    await conn.execute(
        text(
            "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qa_used smallint "
            "NOT NULL DEFAULT 0"
        )
    )
    # Mevcut qa_threads sayımından bir kez doldur; geçmiş race'li satırları LEAST ile clamp'le.
    await conn.execute(
        text(
            """
            UPDATE bookings b SET qa_used = LEAST(sub.c, 3)
            FROM (
              SELECT booking_id, count(*) AS c FROM qa_threads
              WHERE booking_id IS NOT NULL AND deleted_at IS NULL
              GROUP BY booking_id
            ) sub
            WHERE b.id = sub.booking_id AND b.qa_used = 0;
            """
        )
    )
    await conn.execute(
        text(
            """
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_qa_quota'
              ) THEN
                ALTER TABLE bookings ADD CONSTRAINT ck_bookings_qa_quota
                  CHECK (qa_used >= 0 AND qa_used <= 3);
              END IF;
            END $$;
            """
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_bookings_pair_status ON bookings "
            "(client_id, tutor_id, status) WHERE deleted_at IS NULL"
        )
    )


async def _migrate_split_full_name(conn: AsyncConnection) -> None:
    # Phase 7: tek 'full_name' alanını first_name / last_name / username'e böl.
    # Mevcut veriyi koruyacak şekilde idempotent çalışır; her açılışta güvenle tekrarlanabilir.
    for table in _USER_TABLES:
        await conn.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS first_name VARCHAR(75)")
        )
        await conn.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS last_name VARCHAR(75)")
        )
        await conn.execute(
            text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS username VARCHAR(50)")
        )
        # Eski full_name verisini ad/soyad'a böl (kolon hâlâ varken).
        await conn.execute(
            text(
                f"""
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = '{table}' AND column_name = 'full_name'
                  ) THEN
                    UPDATE {table}
                    SET first_name = COALESCE(
                            NULLIF(first_name, ''),
                            NULLIF(split_part(full_name, ' ', 1), ''),
                            'Kullanıcı'),
                        last_name = COALESCE(
                            NULLIF(last_name, ''),
                            NULLIF(CASE WHEN position(' ' in full_name) > 0
                                   THEN btrim(substring(full_name from position(' ' in full_name) + 1))
                                   ELSE '' END, ''),
                            '')
                    WHERE first_name IS NULL OR first_name = '';
                  END IF;
                END $$;
                """
            )
        )
        # username boşsa e-posta yerel kısmından türet; id ile benzersizliği garanti et.
        await conn.execute(
            text(
                f"""
                UPDATE {table}
                SET username = COALESCE(
                        NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9_]', '', 'g')), ''),
                        'user'
                    ) || '_' || id::text
                WHERE username IS NULL OR username = '';
                """
            )
        )
        await conn.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN first_name SET NOT NULL")
        )
        await conn.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN last_name SET NOT NULL")
        )
        await conn.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN username SET NOT NULL")
        )
        await conn.execute(
            text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_username_active "
                f"ON {table} (username) WHERE deleted_at IS NULL"
            )
        )

    # Ad-soyad fuzzy araması için fonksiyonel trgm index; eski kolon-bazlı index'i kaldır.
    await conn.execute(text("DROP INDEX IF EXISTS ix_tutors_full_name_trgm"))
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_tutors_name_trgm ON tutors "
            "USING gin ((first_name || ' ' || last_name) gin_trgm_ops)"
        )
    )

    # Türetme tamamlandı; artık gereksiz full_name kolonunu kaldır.
    for table in _USER_TABLES:
        await conn.execute(
            text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS full_name")
        )


async def _seed_roles(session: AsyncSession) -> None:
    for role_type, role_id in ROLE_IDS.items():
        if await session.get(Role, role_id) is None:
            session.add(Role(id=role_id, name=role_type))


async def _seed_admin(session: AsyncSession) -> None:
    if not (settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
        return
    stmt = select(Admin.id).where(
        Admin.email == settings.ADMIN_EMAIL, Admin.deleted_at.is_(None)
    )
    if (await session.execute(stmt)).first() is not None:
        return
    parts = settings.ADMIN_FULL_NAME.split(" ", 1)
    first_name = parts[0] or "System"
    last_name = parts[1] if len(parts) > 1 else "Admin"
    username = settings.ADMIN_EMAIL.split("@", 1)[0] or "admin"
    session.add(
        Admin(
            email=settings.ADMIN_EMAIL,
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            first_name=first_name,
            last_name=last_name,
            username=username,
            role_id=ROLE_IDS[RoleType.ADMIN],
        )
    )
