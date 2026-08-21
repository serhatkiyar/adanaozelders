"""kitapsec.com kazıma verisini (books.sqlite3) mağaza kataloğuna aktarır.

Kaynak: C:\\Users\\kiyar\\Desktop\\universite_hazirlik\\books.sqlite3 — 10.087
kayıt, ``stock_status`` alanına göre üç durumda: "24 Saatte Kargoda" (1.760,
gerçek stok sinyali var), "Tedarik Ediliyor (3-5 gün içinde kargoda)" (2.931,
satılabilir ama miktar sinyali yok), "Tükendi (Satışa Kapalıdır)" (5.396,
satışa kapalı — YÜKLENMEZ). "ORTA" filtre: ilk ikisi, 4.691 kayıt.

Yazma işi ürünün kendisi için mevcut, denetlenmiş `services.store_service
.bulk_import_products`'a devredilir — ISBN dedup, kategori çözümleme, KDV
doğrulama, stok defterine (`stock_ledger`) ilk bakiye yazımı zaten orada
doğru yapılıyor; burada tekrar üretmek yerine onu çağırıyoruz.

İdempotency: `bulk_import_products` yalnız ISBN'i olan satırları DB'de arayıp
atlıyor — ISBN'siz satırlar için bu koruma yok. Bu yüzden bu betik KENDİ
JSONL günlüğünü tutar (``scripts/data/kitapsec_import_log.jsonl``): her
başarılı satır ``source_id`` (kaynak sqlite `products.id`) ile damgalanır,
yeniden çalıştırmada zaten günlükte olan `source_id`'ler atlanır — ISBN'li
veya ISBN'siz fark etmeksizin tam idempotency.

Kullanım (backend dizininden):

    python scripts/import_kitapsec_books.py --mode trial              # 20 kayıtlık kürate edilmiş deneme, rapor
    python scripts/import_kitapsec_books.py --mode trial --apply      # ... uygula
    python scripts/import_kitapsec_books.py --mode full               # 4.691 kayıt, rapor (dry-run)
    python scripts/import_kitapsec_books.py --mode full --apply       # ... uygula
    python scripts/import_kitapsec_books.py --undo <run_id>           # bir çalıştırmanın ürünlerini soft-delete eder
"""

import argparse
import asyncio
import datetime
import json
import pathlib
import re
import sqlite3
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# Windows konsolu cp1254 kullanır; Türkçe karakterler UnicodeEncodeError ile
# betiği düşürür — çıktıyı UTF-8'e sabitle (diğer scripts/*.py ile aynı desen).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from sqlalchemy import func, select  # noqa: E402

from core import storage  # noqa: E402
from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from models.admin import Admin  # noqa: E402
from models.store import Product  # noqa: E402
from services import store_service  # noqa: E402

DEFAULT_SQLITE_PATH = (
    pathlib.Path.home() / "Desktop" / "universite_hazirlik" / "books.sqlite3"
)
DEFAULT_IMAGES_DIR = pathlib.Path.home() / "Desktop" / "universite_hazirlik" / "images"
LOG_PATH = pathlib.Path(__file__).resolve().parent / "data" / "kitapsec_import_log.jsonl"

CATEGORY_SLUG = "yks-kitaplari"

# Aşama 1 analizinde kararlaştırılan ORTA filtre: kesin stokta + tedarik
# süreli — "Tükendi (Satışa Kapalıdır)" hariç.
ORTA_STATUSES = ("24 Saatte Kargoda", "Tedarik Ediliyor (3-5 gün içinde kargoda)")

# ceyhandb'deki 4 canlı üründe zaten bulunan ISBN'ler — bilerek ATLANIR,
# güncellenmez (kullanıcı kararı: İP-5 tax_rate'i / elle girilmiş veri
# kazınmış veriyle ezilmesin). `bulk_import_products` bunları zaten ISBN
# dedup'ıyla atlar; burada ayrıca ÖN-filtrelenir ki (a) görsel indirme/yükleme
# bu satırlar için hiç denenmesin, (b) rapora açıkça "bilinen çakışma" diye
# düşsün (genel "zaten yüklenmiş" atlamasından ayrı görünsün).
KNOWN_OVERLAP_ISBNS = {
    "9786258070187",
    "9786058136816",
    "9786051949291",
    "9786050657104",
}

# Kullanıcının elle seçtiği 20 kayıtlık kürate edilmiş deneme partisi —
# rastgele DEĞİL: uç durumları bilerek içerir (bkz. Aşama 1 raporu).
#   5x "24 Saatte Kargoda" normal (gerçek stok_quantity_min'li)
#   5x "Tedarik Ediliyor" normal (fallback stoklu)
#   3x geçersiz ISBN (13 haneli değil)
#   3x görseli eksik (2) veya en büyük dosya boyutlu (1)
#   2x en uzun başlıklı
#   2x list_price NULL
TRIAL_IDS = [
    # 24 Saatte Kargoda — normal
    1, 2, 7, 18, 24,
    # Tedarik Ediliyor — normal
    4, 5, 9, 10, 11,
    # geçersiz ISBN (4 haneli iç kod)
    45, 56, 77,
    # görsel eksik (2) / en büyük dosya (1)
    2126, 2220, 1061,
    # en uzun başlık
    3479, 269,
    # list_price NULL
    6, 8,
]

ISBN13_RE = re.compile(r"^\d{13}$")


def _load_processed_ids() -> dict[int, dict]:
    """Daha önce başarıyla işlenmiş kaynak id'leri (idempotency günlüğü)."""
    if not LOG_PATH.exists():
        return {}
    out: dict[int, dict] = {}
    for line in LOG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        out[rec["source_id"]] = rec
    return out


def _append_log(records: list[dict]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _fetch_source_rows(sqlite_path: pathlib.Path, mode: str) -> list[dict]:
    con = sqlite3.connect(str(sqlite_path))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    if mode == "trial":
        placeholders = ",".join("?" * len(TRIAL_IDS))
        cur.execute(
            f"SELECT * FROM products WHERE id IN ({placeholders})", TRIAL_IDS  # noqa: S608
        )
        rows = [dict(r) for r in cur.fetchall()]
        # TRIAL_IDS sırasını koru (rapor okunurken bucket sırası anlamlı olsun).
        by_id = {r["id"]: r for r in rows}
        rows = [by_id[i] for i in TRIAL_IDS if i in by_id]
    else:
        placeholders = ",".join("?" * len(ORTA_STATUSES))
        cur.execute(
            f"SELECT * FROM products WHERE stock_status IN ({placeholders}) "  # noqa: S608
            "ORDER BY id",
            ORTA_STATUSES,
        )
        rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def _slugify_for_log(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _row_stock(row: dict, *, fallback_stock: int) -> tuple[int, str]:
    """(yazılacak stok, gerekçe) döner — rapor bu gerekçeyi satır satır döker."""
    if row["stock_status"] == "24 Saatte Kargoda":
        qty = row["stock_quantity_min"]
        if qty and qty > 0:
            return int(qty), f"gerçek stock_quantity_min={qty} (24 Saatte Kargoda)"
        return fallback_stock, (
            f"24 Saatte Kargoda ama stock_quantity_min boş — fallback={fallback_stock}"
        )
    return fallback_stock, (
        f"Tedarik Ediliyor (miktar sinyali yok) — fallback={fallback_stock}"
    )


def _row_isbn(row: dict) -> tuple[str | None, str]:
    isbn = (row["isbn"] or "").strip()
    if ISBN13_RE.match(isbn):
        return isbn, "gecerli 13 haneli ISBN"
    return None, f"gecersiz ISBN kaynakta ('{isbn}', {len(isbn)} hane) — bos birakildi"


async def _minio_available() -> bool:
    """``storage.ensure_bucket`` başlangıçta best-effort'tur ve HER ZAMAN
    (hata olsa bile) sessizce döner — burada gerçek bir erişilebilirlik
    kontrolü gerekiyor, o yüzden bucket'a doğrudan `head_bucket` denenir."""
    try:
        async with storage._s3_client() as s3:  # noqa: SLF001
            await s3.head_bucket(Bucket=settings.AWS_BUCKET_NAME)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  MinIO'ya erişilemedi ({exc}) — görsel adımı ATLANACAK.")
        return False


async def _upload_cover(row: dict, images_dir: pathlib.Path) -> tuple[str | None, str]:
    image_path = row["image_path"]
    if not image_path:
        return None, "kaynakta image_path yok"
    p = images_dir / pathlib.Path(image_path).name
    if not p.exists():
        return None, f"görsel dosyası diskte yok: {p}"
    try:
        data = p.read_bytes()
        url = await storage.upload_product_photo(data)
        return url, f"yüklendi ({p.name}, {p.stat().st_size} bayt)"
    except Exception as exc:  # noqa: BLE001
        return None, f"yükleme hatası ({p.name}): {exc}"


async def main(args: argparse.Namespace) -> int:
    sqlite_path = pathlib.Path(args.sqlite)
    images_dir = pathlib.Path(args.images_dir)
    if not sqlite_path.exists():
        print(f"HATA: kaynak sqlite bulunamadı: {sqlite_path}")
        return 1

    run_id = uuid.uuid4().hex[:12]
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    processed = _load_processed_ids()
    rows = _fetch_source_rows(sqlite_path, args.mode)
    print(f"Kaynaktan çekilen kayıt: {len(rows)} (mode={args.mode})")

    already_done = [r for r in rows if r["id"] in processed]
    rows = [r for r in rows if r["id"] not in processed]
    if already_done:
        print(
            f"  {len(already_done)} kayıt daha önce bu günlükte işlenmiş "
            f"({LOG_PATH.name}) — idempotent olarak ATLANDI."
        )

    async with AsyncSessionLocal() as db:
        admin = (
            await db.execute(
                select(Admin).where(Admin.deleted_at.is_(None)).order_by(Admin.id).limit(1)
            )
        ).scalar_one_or_none()
        if admin is None:
            print("HATA: DB'de silinmemiş admin bulunamadı — ürün created_by_admin_id gerekli.")
            return 1

        existing_isbns = set(
            (
                await db.execute(
                    select(Product.isbn).where(
                        Product.isbn.is_not(None), Product.deleted_at.is_(None)
                    )
                )
            ).scalars()
        )

        minio_ok = (not args.skip_images) and await _minio_available()

        to_import: list[dict] = []
        row_meta: list[dict] = []  # to_import ile aynı sırada — rapor için
        skipped_known_overlap: list[dict] = []
        skipped_other_overlap: list[dict] = []

        for row in rows:
            raw_isbn = (row["isbn"] or "").strip()
            if raw_isbn in KNOWN_OVERLAP_ISBNS:
                skipped_known_overlap.append(row)
                continue
            if raw_isbn and raw_isbn in existing_isbns:
                skipped_other_overlap.append(row)
                continue

            isbn, isbn_note = _row_isbn(row)
            stock, stock_note = _row_stock(row, fallback_stock=args.fallback_stock)

            cover_url, cover_note = (None, "MinIO ayakta değil — görsel adımı atlandı")
            if minio_ok:
                cover_url, cover_note = await _upload_cover(row, images_dir)

            list_price = row["list_price"]
            r = {
                "title": _slugify_for_log(row["title"])[:250],
                "description": row["description"] or None,
                "kind": "PHYSICAL",
                "status": "ACTIVE",
                "price": str(row["sale_price"]),
                "compare_at_price": (str(list_price) if list_price else None),
                "tax_rate": str(args.tax_rate),
                "stock": str(stock),
                "category_slug": CATEGORY_SLUG,
                "cover_url": cover_url,
                "author": row["author"] or None,
                "publisher": row["publisher"] or None,
                "isbn": isbn,
                "page_count": (str(row["page_count"]) if row["page_count"] else None),
                "dimensions": row["dimensions"] or None,
            }
            to_import.append(r)
            row_meta.append(
                {
                    "source_id": row["id"],
                    "isbn_note": isbn_note,
                    "stock_note": stock_note,
                    "cover_note": cover_note,
                    "title": r["title"],
                }
            )

        print()
        print(f"Bilinen çakışan ISBN (atlandı, GÜNCELLENMEDİ): {len(skipped_known_overlap)}")
        for r in skipped_known_overlap:
            print(f"  - id={r['id']} isbn={r['isbn']} title={r['title'][:70]!r}")
        if skipped_other_overlap:
            print(f"Diğer mevcut-ISBN çakışması (atlandı): {len(skipped_other_overlap)}")
            for r in skipped_other_overlap:
                print(f"  - id={r['id']} isbn={r['isbn']} title={r['title'][:70]!r}")

        print()
        print(f"Yüklenecek aday satır: {len(to_import)}")
        for meta in row_meta:
            print(
                f"  - src#{meta['source_id']:>5} {meta['title'][:60]!r}\n"
                f"      isbn: {meta['isbn_note']}\n"
                f"      stok: {meta['stock_note']}\n"
                f"      gorsel: {meta['cover_note']}"
            )

        if not args.apply:
            print()
            print("DRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply")
            return 0

        if not to_import:
            print()
            print("Yüklenecek yeni satır yok.")
            return 0

        batch_size = max(1, args.batch_size)
        n_batches = (len(to_import) + batch_size - 1) // batch_size
        print()
        print(
            f"Uygulama başlıyor: {len(to_import)} satır, {n_batches} parti "
            f"(parti başı {batch_size})."
        )

        total_created = total_skipped = total_errors = 0
        aborted = False
        for bi in range(n_batches):
            lo, hi = bi * batch_size, min((bi + 1) * batch_size, len(to_import))
            batch_rows = to_import[lo:hi]
            batch_meta = row_meta[lo:hi]

            t0 = time.monotonic()
            max_id_before = (
                await db.execute(select(func.coalesce(func.max(Product.id), 0)))
            ).scalar_one()

            result = await store_service.bulk_import_products(db, admin, batch_rows)

            created_rows = (
                await db.execute(
                    select(Product.id, Product.isbn, Product.sku, Product.title)
                    .where(Product.id > max_id_before)
                    .order_by(Product.id)
                )
            ).all()
            elapsed = time.monotonic() - t0

            total_created += result["created"]
            total_skipped += result["skipped"]
            total_errors += len(result["errors"])

            print(
                f"  Parti {bi + 1}/{n_batches} [src#{batch_meta[0]['source_id']}.."
                f"{batch_meta[-1]['source_id']}]: created={result['created']} "
                f"skipped={result['skipped']} errors={len(result['errors'])} "
                f"— {elapsed:.1f}s"
            )
            if result["errors"]:
                for e in result["errors"]:
                    idx = e["row"] - 1
                    src = batch_meta[idx]["source_id"] if idx < len(batch_meta) else "?"
                    print(f"      ! row={e['row']} (src#{src}): {e['message']}")

            if len(created_rows) != result["created"]:
                print(
                    f"      UYARI: id>{max_id_before} sorgusu {len(created_rows)} satır "
                    f"buldu, servis {result['created']} 'created' bildirdi — eşleşmiyor."
                )

            error_indices = {e["row"] - 1 for e in result["errors"]}
            ok_meta = [m for i, m in enumerate(batch_meta) if i not in error_indices]
            log_records = [
                {
                    "run_id": run_id,
                    "source_id": meta["source_id"],
                    "product_id": prod.id,
                    "sku": prod.sku,
                    "isbn": prod.isbn,
                    "title": prod.title,
                    "imported_at": started_at,
                }
                # strict=True bilinçli: ok_meta yalnız `errors` satırlarını
                # eler, servisin `skipped` (ISBN dedup) satırlarını ELEMEZ.
                # Uzunluklar ayrışırsa eşleştirme kayar ve her source_id bir
                # SONRAKİ ürünün id'siyle günlüğe yazılır — `--undo` o zaman
                # yanlış ürünleri soft-delete eder. Sessiz kesme yerine
                # gürültülü hata: eşleştiremediğimizi bilmek şart.
                for meta, prod in zip(ok_meta, created_rows, strict=True)
            ]
            _append_log(log_records)

            if len(result["errors"]) > args.max_batch_errors:
                print(
                    f"\nDURDURULDU: bu partide {len(result['errors'])} hata "
                    f"(> {args.max_batch_errors}). Bu partiye kadarki başarılı satırlar "
                    "günlüğe yazıldı, yeniden çalıştırma bu noktadan devam eder."
                )
                aborted = True
                break

        print()
        print(
            f"TOPLAM: created={total_created} skipped(servis-ici)={total_skipped} "
            f"errors={total_errors}"
        )
        print(f"run_id={run_id}  (geri almak için: --undo {run_id})")
        return 1 if aborted else 0


async def undo(run_id: str) -> int:
    if not LOG_PATH.exists():
        print("Günlük dosyası yok, geri alınacak bir şey bulunamadı.")
        return 1
    targets = []
    for line in LOG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if rec.get("run_id") == run_id:
            targets.append(rec)
    if not targets:
        print(f"run_id={run_id} günlükte bulunamadı.")
        return 1
    print(f"{len(targets)} ürün soft-delete edilecek (run_id={run_id}):")
    for t in targets:
        print(f"  - product_id={t['product_id']} sku={t['sku']} title={t['title'][:60]!r}")
    async with AsyncSessionLocal() as db:
        for t in targets:
            try:
                await store_service.delete_product(db, t["product_id"])
            except Exception as exc:  # noqa: BLE001
                print(f"  ! product_id={t['product_id']} silinemedi: {exc}")
    print("Tamamlandı (soft-delete). Günlükteki satırlar bilgi amaçlı bırakıldı.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["trial", "full"], default="trial")
    parser.add_argument("--sqlite", default=str(DEFAULT_SQLITE_PATH))
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR))
    parser.add_argument("--fallback-stock", type=int, default=5)
    parser.add_argument("--tax-rate", default="0")
    parser.add_argument("--apply", action="store_true", help="değişiklikleri gerçekten yaz")
    parser.add_argument("--skip-images", action="store_true", help="MinIO'ya hiç dokunma")
    parser.add_argument("--batch-size", type=int, default=500, help="parti başına satır sayısı")
    parser.add_argument(
        "--max-batch-errors", type=int, default=5,
        help="bir partide bu sayıdan fazla hata olursa DUR",
    )
    parser.add_argument("--undo", metavar="RUN_ID", help="bir run_id'nin ürünlerini soft-delete et")
    ns = parser.parse_args()

    if ns.undo:
        sys.exit(asyncio.run(undo(ns.undo)))
    sys.exit(asyncio.run(main(ns)))
