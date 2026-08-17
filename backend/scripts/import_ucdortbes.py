"""ÜçDörtBeş Yayınları kataloğunu (33 kitap) mağaza kataloğuna aktarır.

Kaynak, yerelde üretilen iki dosyadır (bu betik kazıma/birleştirme YAPMAZ):

  * ``ucdortbes-import.jsonl`` — satır başına bir ürün. Excel liste fiyatı +
    ``books.csv`` künyesi + kapak dosya adı ISBN üzerinden birleştirilmiştir.
  * ``ucdortbes-covers/`` — kapak PNG'leri, dosya adı ``<ISBN>.png``.

Yazma işi ürün için mevcut, denetlenmiş ``services.store_service
.bulk_import_products``'a devredilir — ISBN dedup, kategori çözümleme, KDV
doğrulama, slug üretimi ve stok defterine (``stock_ledger``) ilk bakiye yazımı
zaten orada doğru yapılıyor; burada tekrar üretilmez.

İdempotency İKİ katmanlıdır:

  1. ``bulk_import_products`` ISBN'i DB'de bulunan satırı atlar. Bu betik aynı
     kontrolü ÖN-filtre olarak da yapar ki (a) o satır için görsel MinIO'ya
     boşuna yüklenmesin, (b) rapor "zaten var" diyebilsin.
  2. ISBN'i OLMAYAN satır (bkz. aşağıdaki not) bu korumanın dışında kalır; o
     yüzden betik kendi JSONL günlüğünü tutar
     (``scripts/data/ucdortbes_import_log.jsonl``). Her başarılı satır kendi
     anahtarıyla (``isbn:<isbn>`` veya ``title:<başlık>``) damgalanır ve
     yeniden çalıştırmada atlanır.

ISBN'siz satır notu: yayınevi ``9786255566652`` ISBN'ini İKİ kitaba birden
vermiş (Start Geometri + Start Paragraf). JSONL'de ISBN Start Geometri'de
bırakıldı, Start Paragraf ``"isbn": null`` geldi — yanlış ISBN yazmak,
ISBN'siz bırakmaktan daha zararlıdır (barkodla yanlış kitap eşleşir).

Kullanım (backend dizininden):

    python scripts/import_ucdortbes.py                      # dry-run (varsayılan)
    python scripts/import_ucdortbes.py --apply              # uygula
    python scripts/import_ucdortbes.py --apply --skip-images  # MinIO'ya dokunma

Varsayılan yollar ``scripts/data/`` altındadır; iki kaynağı oraya kopyalayın
ya da ``--jsonl`` / ``--images-dir`` ile yol verin.
"""

import argparse
import asyncio
import datetime
import json
import pathlib
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
from models.store import Product, ProductCategory  # noqa: E402
from services import store_service  # noqa: E402

DATA_DIR = pathlib.Path(__file__).resolve().parent / "data"
DEFAULT_JSONL = DATA_DIR / "ucdortbes-import.jsonl"
DEFAULT_IMAGES_DIR = DATA_DIR / "ucdortbes-covers"
LOG_PATH = DATA_DIR / "ucdortbes_import_log.jsonl"

CATEGORY_SLUG = "yks-kitaplari"
CATEGORY_NAME = "YKS Kitapları"
# Kategori yoksa oluşturulur; varsa bu üst kategoriye bağlanır (yoksa köke).
PARENT_CATEGORY_SLUG = "sinav-kitaplari"


def _row_key(row: dict) -> str:
    """İdempotency anahtarı. ISBN varsa o, yoksa başlık.

    Başlığa düşmek ISBN kadar güçlü değildir ama ISBN'siz satırın tek ayırt
    edici alanı odur; alternatif (anahtarsız bırakmak) her çalıştırmada
    kopya ürün üretirdi.
    """
    isbn = (row.get("isbn") or "").strip()
    if isbn:
        return f"isbn:{isbn}"
    return f"title:{(row.get('title') or '').strip().lower()}"


def _load_processed_keys() -> dict[str, dict]:
    """Daha önce başarıyla işlenmiş anahtarlar (idempotency günlüğü)."""
    if not LOG_PATH.exists():
        return {}
    out: dict[str, dict] = {}
    for line in LOG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        out[rec["key"]] = rec
    return out


def _append_log(records: list[dict]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _read_jsonl(path: pathlib.Path) -> list[dict]:
    rows: list[dict] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"HATA: {path.name} satır {i} okunamadı: {exc}") from exc
    return rows


def _s(value) -> str | None:
    """``bulk_import_products`` satırları CSV kökenli olduğu için METİN bekler
    (``_dec``/``_g`` yardımcıları ``str`` varsayar; sayı gelirse ya patlar ya da
    ``0`` değerini boş sayar). JSONL doğal tipler taşıdığından burada çevrilir."""
    if value is None:
        return None
    if isinstance(value, bool):  # beklenmiyor; sessiz 1/0'a düşmesin
        raise TypeError("bool alan beklenmiyordu")
    return str(value)


async def _minio_available() -> bool:
    """``storage.ensure_bucket`` best-effort'tur ve hata olsa bile sessizce
    döner — burada gerçek bir erişilebilirlik kontrolü gerekiyor, o yüzden
    bucket'a doğrudan ``head_bucket`` denenir."""
    try:
        async with storage._s3_client() as s3:  # noqa: SLF001
            await s3.head_bucket(Bucket=settings.AWS_BUCKET_NAME)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  MinIO'ya erişilemedi ({exc}) — görsel adımı ATLANACAK.")
        return False


async def _upload_cover(
    cover_file: str | None, images_dir: pathlib.Path
) -> tuple[str | None, str]:
    if not cover_file:
        return None, "JSONL'de cover_file yok"
    p = images_dir / cover_file
    if not p.exists():
        return None, f"kapak dosyası diskte yok: {p}"
    try:
        data = p.read_bytes()
        url = await storage.upload_library_photo(data, square=False)
        return url, f"yüklendi ({p.name}, {p.stat().st_size} bayt)"
    except Exception as exc:  # noqa: BLE001
        return None, f"yükleme hatası ({p.name}): {exc}"


async def _ensure_category(db, *, apply: bool) -> int | None:
    """``yks-kitaplari`` kategorisini bulur, yoksa oluşturur.

    ``bulk_import_products`` bilinmeyen ``category_slug``'ı satır hatası
    sayar, o yüzden kategori toplu yazımdan ÖNCE var olmalı ve commit
    edilmelidir.
    """
    cat = (
        await db.execute(
            select(ProductCategory).where(
                ProductCategory.slug == CATEGORY_SLUG,
                ProductCategory.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if cat is not None:
        print(f"Kategori: '{CATEGORY_SLUG}' mevcut (id={cat.id}).")
        return cat.id

    if not apply:
        print(f"Kategori: '{CATEGORY_SLUG}' YOK — uygulamada oluşturulacak.")
        return None

    parent = (
        await db.execute(
            select(ProductCategory.id).where(
                ProductCategory.slug == PARENT_CATEGORY_SLUG,
                ProductCategory.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    max_sort = (
        await db.execute(
            select(func.coalesce(func.max(ProductCategory.sort_order), 0))
        )
    ).scalar_one()
    cat = ProductCategory(
        slug=CATEGORY_SLUG,
        name=CATEGORY_NAME,
        parent_id=parent,
        sort_order=int(max_sort) + 1,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    print(
        f"Kategori: '{CATEGORY_SLUG}' OLUŞTURULDU (id={cat.id}, "
        f"parent={parent if parent else 'kök'})."
    )
    return cat.id


async def main(args: argparse.Namespace) -> int:
    jsonl_path = pathlib.Path(args.jsonl)
    images_dir = pathlib.Path(args.images_dir)
    if not jsonl_path.exists():
        print(f"HATA: JSONL bulunamadı: {jsonl_path}")
        return 1
    if not args.skip_images and not images_dir.exists():
        print(f"HATA: kapak klasörü bulunamadı: {images_dir}")
        return 1

    run_id = uuid.uuid4().hex[:12]
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    source_rows = _read_jsonl(jsonl_path)
    processed = _load_processed_keys()
    print(f"JSONL'den okunan satır: {len(source_rows)}  ({jsonl_path})")
    print(f"Mod: {'UYGULA (--apply)' if args.apply else 'DRY-RUN'}")
    print()

    async with AsyncSessionLocal() as db:
        admin = (
            await db.execute(
                select(Admin)
                .where(Admin.deleted_at.is_(None))
                .order_by(Admin.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if admin is None:
            print(
                "HATA: DB'de silinmemiş admin bulunamadı — "
                "ürün created_by_admin_id gerekli."
            )
            return 1
        print(f"Ürün sahibi admin: id={admin.id} ({admin.email})")

        await _ensure_category(db, apply=args.apply)

        existing_isbns = set(
            (
                await db.execute(
                    select(Product.isbn).where(
                        Product.isbn.is_not(None), Product.deleted_at.is_(None)
                    )
                )
            ).scalars()
        )
        # ISBN'siz satırın DB tarafındaki tek savunması başlıktır (günlük
        # silinmiş/taşınmamışsa bu kontrol kopyayı yine de yakalar).
        existing_titles = {
            t.strip().lower()
            for t in (
                await db.execute(
                    select(Product.title).where(Product.deleted_at.is_(None))
                )
            ).scalars()
            if t
        }

        minio_ok = (not args.skip_images) and await _minio_available()
        if args.skip_images:
            print("Görsel adımı --skip-images ile kapatıldı.")

        to_import: list[dict] = []
        row_meta: list[dict] = []
        skipped_log: list[dict] = []
        skipped_db: list[dict] = []

        for src in source_rows:
            key = _row_key(src)
            title = (src.get("title") or "").strip()
            isbn = (src.get("isbn") or "").strip() or None

            if key in processed:
                skipped_log.append({"key": key, "title": title})
                continue
            if isbn and isbn in existing_isbns:
                skipped_db.append({"key": key, "title": title, "why": "ISBN zaten kayıtlı"})
                continue
            if not isbn and title.lower() in existing_titles:
                skipped_db.append(
                    {"key": key, "title": title, "why": "ISBN'siz, aynı başlık zaten kayıtlı"}
                )
                continue

            cover_url, cover_note = (None, "görsel adımı kapalı")
            if minio_ok:
                if args.apply:
                    cover_url, cover_note = await _upload_cover(
                        src.get("cover_file"), images_dir
                    )
                else:
                    cf = src.get("cover_file")
                    if not cf:
                        cover_note = "JSONL'de cover_file yok"
                    elif (images_dir / cf).exists():
                        cover_note = f"yüklenecek ({cf})"
                    else:
                        cover_note = f"DOSYA YOK: {images_dir / cf}"

            row = {
                "title": title,
                "description": src.get("description"),
                "kind": src.get("kind") or "PHYSICAL",
                "status": src.get("status") or "DRAFT",
                "price": _s(src.get("price")),
                "compare_at_price": _s(src.get("compare_at_price")),
                "tax_rate": _s(src.get("tax_rate")),
                "stock": _s(src.get("stock")),
                "category_slug": CATEGORY_SLUG,
                "cover_url": cover_url,
                "author": src.get("author"),
                "publisher": src.get("publisher"),
                "isbn": isbn,
                "page_count": _s(src.get("page_count")),
            }
            to_import.append(row)
            row_meta.append(
                {
                    "key": key,
                    "title": title,
                    "isbn": isbn,
                    "cover_note": cover_note,
                    "price": src.get("price"),
                    "gecici_fiyat": bool(src.get("price_is_placeholder")),
                }
            )

        if skipped_log:
            print(f"\nGünlükte zaten işlenmiş (atlandı): {len(skipped_log)}")
            for s in skipped_log:
                print(f"  - {s['key']} {s['title'][:60]!r}")
        if skipped_db:
            print(f"\nDB'de zaten var (atlandı, GÜNCELLENMEDİ): {len(skipped_db)}")
            for s in skipped_db:
                print(f"  - {s['key']} {s['title'][:60]!r} — {s['why']}")

        print(f"\nYüklenecek aday satır: {len(to_import)}")
        for meta in row_meta:
            fiyat = f"{meta['price']}" + (" (GEÇİCİ)" if meta["gecici_fiyat"] else "")
            print(
                f"  - {meta['title'][:58]!r}\n"
                f"      isbn : {meta['isbn'] or 'YOK (çift ISBN kararı)'}\n"
                f"      fiyat: {fiyat}\n"
                f"      kapak: {meta['cover_note']}"
            )

        gecici = [m for m in row_meta if m["gecici_fiyat"]]
        if gecici:
            print(
                f"\nUYARI: {len(gecici)} üründe fiyat kaynakta yoktu ve 999 TL "
                f"geçici fiyatla yazılacak. Hepsi DRAFT olduğu için satışa "
                f"çıkmaz; fiyatlar girilmeden ACTIVE yapılmamalı."
            )

        if not args.apply:
            print("\nDRY-RUN — hiçbir şey yazılmadı. Uygulamak için: --apply")
            return 0

        if not to_import:
            print("\nYüklenecek yeni satır yok.")
            return 0

        batch_size = max(1, args.batch_size)
        n_batches = (len(to_import) + batch_size - 1) // batch_size
        print(
            f"\nUygulama başlıyor: {len(to_import)} satır, {n_batches} parti "
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
                f"  Parti {bi + 1}/{n_batches}: created={result['created']} "
                f"skipped={result['skipped']} errors={len(result['errors'])} "
                f"— {elapsed:.1f}s"
            )
            for e in result["errors"]:
                idx = e["row"] - 1
                başlık = batch_meta[idx]["title"] if idx < len(batch_meta) else "?"
                print(f"      ! row={e['row']} ({başlık[:50]!r}): {e['message']}")

            # Günlük eşleştirmesi SIRA ile değil KİMLİKLE yapılır: servis
            # bazı satırları atlarsa (skipped) sıra kayar ve her satır bir
            # sonraki ürünün id'siyle damgalanırdı.
            by_isbn = {p.isbn: p for p in created_rows if p.isbn}
            by_title = {(p.title or "").strip().lower(): p for p in created_rows}
            log_records = []
            for meta in batch_meta:
                prod = (
                    by_isbn.get(meta["isbn"])
                    if meta["isbn"]
                    else by_title.get(meta["title"].strip().lower())
                )
                if prod is None:
                    # Oluşmamış olabilir (hata/atlama) — günlüğe YAZMA ki bir
                    # sonraki çalıştırma bu satırı yeniden denesin.
                    continue
                log_records.append(
                    {
                        "run_id": run_id,
                        "key": meta["key"],
                        "product_id": prod.id,
                        "sku": prod.sku,
                        "isbn": prod.isbn,
                        "title": prod.title,
                        "imported_at": started_at,
                    }
                )
            _append_log(log_records)

            if len(log_records) != result["created"]:
                print(
                    f"      UYARI: {result['created']} ürün oluştu ama "
                    f"{len(log_records)} tanesi günlüğe eşleştirilebildi — "
                    f"eşleşmeyenler yeniden çalıştırmada tekrar denenecek."
                )

            if len(result["errors"]) > args.max_batch_errors:
                print(
                    f"\nDURDURULDU: bu partide {len(result['errors'])} hata "
                    f"(> {args.max_batch_errors}). Başarılı satırlar günlüğe "
                    f"yazıldı; yeniden çalıştırma bu noktadan devam eder."
                )
                aborted = True
                break

        print(
            f"\nTOPLAM: created={total_created} skipped(servis-içi)={total_skipped} "
            f"errors={total_errors}"
        )
        print(f"run_id={run_id}  günlük: {LOG_PATH}")
        print(
            "Ürünlerin hepsi DRAFT durumdadır — mağazada görünmezler. "
            "Fiyat/başlık kontrolünden sonra panelden ACTIVE yapın."
        )
        return 1 if aborted else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jsonl", default=str(DEFAULT_JSONL))
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR))
    parser.add_argument(
        "--apply", action="store_true", help="değişiklikleri gerçekten yaz"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="hiçbir şey yazma (varsayılan davranış; açıklık için)",
    )
    parser.add_argument(
        "--skip-images", action="store_true", help="MinIO'ya hiç dokunma"
    )
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument(
        "--max-batch-errors",
        type=int,
        default=5,
        help="bir partide bu sayıdan fazla hata olursa DUR",
    )
    ns = parser.parse_args()

    if ns.dry_run and ns.apply:
        raise SystemExit("--dry-run ve --apply birlikte verilemez.")

    sys.exit(asyncio.run(main(ns)))
