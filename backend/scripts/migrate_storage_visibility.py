"""Depolamadaki nesneleri erişim sınıfına göre yeniden yerleştirir.

Neden gerekli: bucket policy artık anonim okumayı YALNIZ ``avatars/`` ve
``library-photos/`` öneklerine veriyor (bkz. ``core/storage.PUBLIC_PREFIXES``).
Bu kural yürürlüğe girdiğinde eski yerleşim iki yönde de yanlış kalır:

* **Avatarlar bucket KÖKÜNDE** duruyordu (``<uuid>.webp``) → artık hiçbir Allow
  kapsamında değiller, profil fotoğrafları 403 olur. ``avatars/`` altına taşınır.
* **Hassas dosyalar public öneklerdeydi** (ders materyali, diploma, karne, cevap
  anahtarı, dijital ürün, teslim kanıtı fotoğrafı, kurye vesikalığı) → adresi
  bilen herkese açıktı. ``private/`` altına taşınır ve bundan sonra yalnız kısa
  ömürlü imzalı adresle okunur.

Çalışma biçimi: her nesne önce kopyalanır (``copy_object``), sonra veritabanındaki
adres güncellenir, en son eski nesne silinir. Sıra bilinçlidir — arada kesilirse
kayıp olmaz, en kötü ihtimalle artık (orphan) nesne kalır. Betik **idempotent**tir:
hedefte olan satırlar atlanır, tekrar tekrar çalıştırılabilir.

Kullanım (backend dizininden):

    python scripts/migrate_storage_visibility.py            # yalnız rapor (dry-run)
    python scripts/migrate_storage_visibility.py --apply    # uygula
"""

import argparse
import asyncio
import pathlib
import sys
from dataclasses import dataclass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# Windows konsolu varsayılan olarak cp1254 kullanır ve Türkçe/işaret karakterleri
# UnicodeEncodeError ile betiği düşürür — çıktı akışını UTF-8'e sabitle.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from sqlalchemy import text  # noqa: E402

from core import storage  # noqa: E402
from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402


@dataclass(frozen=True)
class Move:
    """Bir kolondaki adreslerin taşınacağı hedef önek."""

    table: str
    column: str
    prefix: str  # storage anahtarındaki hedef önek (sondaki / olmadan)
    note: str


# Hassas kolonlar → `private/<prefix>/`. Liste açık tutulur: yeni bir dosya
# yüzeyi eklendiğinde buraya da eklenmezse eski veri taşınmaz (yenisi zaten
# doğru yere yazılır).
PRIVATE_MOVES: tuple[Move, ...] = (
    Move("booking_resources", "url", "lesson-resources", "ders materyali"),
    Move("tutor_educations", "document_url", "education-docs", "diploma/belge"),
    Move("library_exam_sessions", "answer_key_url", "answer-keys", "cevap anahtarı"),
    Move("library_exam_catalogs", "answer_key_url", "answer-keys", "cevap anahtarı"),
    Move("exam_registrations", "result_document_url", "exam-results", "öğrenci karnesi"),
    Move("products", "digital_asset_key", "digital-assets", "dijital ürün dosyası"),
    Move("order_items", "digital_asset_key", "digital-assets", "dijital ürün (snapshot)"),
    Move("couriers", "photo_url", "couriers", "kurye vesikalığı"),
    Move("delivery_stops", "photo_url", "delivery-proof", "teslim kanıtı fotoğrafı"),
)

# Avatarlar public kalır ama kökten `avatars/` önekine iner.
AVATAR_COLUMN = "avatar_url"
AVATAR_PREFIX = "avatars"


async def _avatar_tables(db) -> list[str]:
    """``avatar_url`` kolonu olan tablolar (ayrı kullanıcı tabloları + sonradan
    eklenenler). Elle liste tutmak yerine şemaya sorulur."""
    rows = await db.execute(
        text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND column_name = :col "
            "ORDER BY table_name"
        ),
        {"col": AVATAR_COLUMN},
    )
    return [r[0] for r in rows]


def _target_key(key: str, *, prefix: str, private: bool) -> str | None:
    """Anahtarın hedefteki hâli; zaten hedefteyse ``None``."""
    base = key.rsplit("/", 1)[-1]
    target = f"{storage.PRIVATE_PREFIX}{prefix}/{base}" if private else f"{prefix}/{base}"
    return None if key == target else target


async def _column_exists(db, table: str, column: str) -> bool:
    return bool(
        (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
                ),
                {"t": table, "c": column},
            )
        ).first()
    )


async def _move_column(db, s3, move: Move, *, private: bool, apply: bool) -> tuple[int, int]:
    """Tek kolonu taşır → (taşınan, atlanan) sayısı."""
    if not await _column_exists(db, move.table, move.column):
        # Şema evrildiğinde betik tümden çökmesin; eksik olanı söyleyip devam et.
        print("  (kolon yok — atlandı)")
        return 0, 0

    rows = (
        await db.execute(
            text(
                f"SELECT id, {move.column} AS url FROM {move.table} "  # noqa: S608 - sabit liste
                f"WHERE {move.column} IS NOT NULL AND {move.column} <> ''"
            )
        )
    ).all()

    moved = skipped = 0
    for row_id, url in rows:
        key = storage.key_from_url(url)
        if not key:
            # Harici bağlantı (ör. ders kaynağı olarak verilmiş bir site) —
            # bizim bucket'ımızda değil, dokunulmaz.
            skipped += 1
            continue
        target = _target_key(key, prefix=move.prefix, private=private)
        if target is None:
            skipped += 1
            continue

        new_url = storage.object_url(target)
        print(f"  {move.table}.{move.column}#{row_id}: {key} → {target}")
        if not apply:
            moved += 1
            continue

        try:
            await s3.copy_object(
                Bucket=settings.AWS_BUCKET_NAME,
                CopySource={"Bucket": settings.AWS_BUCKET_NAME, "Key": key},
                Key=target,
            )
        except Exception as exc:  # nesne yoksa satırı bozmadan geç
            print(f"    ! kopyalanamadı ({exc}) — satır değiştirilmedi")
            skipped += 1
            continue

        await db.execute(
            text(f"UPDATE {move.table} SET {move.column} = :u WHERE id = :i"),  # noqa: S608
            {"u": new_url, "i": row_id},
        )
        await db.commit()
        try:
            await s3.delete_object(Bucket=settings.AWS_BUCKET_NAME, Key=key)
        except Exception as exc:
            print(f"    ! eski nesne silinemedi ({exc}) — adres güncel, artık kaldı")
        moved += 1
    return moved, skipped


async def main(apply: bool) -> int:
    total_moved = total_skipped = 0
    async with AsyncSessionLocal() as db:
        avatar_moves = [
            Move(t, AVATAR_COLUMN, AVATAR_PREFIX, "profil fotoğrafı")
            for t in await _avatar_tables(db)
        ]
        async with storage._s3_client() as s3:
            for move in avatar_moves:
                print(f"\n▸ {move.table}.{move.column} — {move.note} (public)")
                m, s = await _move_column(db, s3, move, private=False, apply=apply)
                total_moved += m
                total_skipped += s
            for move in PRIVATE_MOVES:
                print(f"\n▸ {move.table}.{move.column} — {move.note} (private)")
                m, s = await _move_column(db, s3, move, private=True, apply=apply)
                total_moved += m
                total_skipped += s

    verb = "taşındı" if apply else "taşınacak"
    print(f"\n{total_moved} nesne {verb}, {total_skipped} atlandı.")
    if not apply and total_moved:
        print("Uygulamak için: --apply")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="değişiklikleri gerçekten uygula"
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.apply)))
