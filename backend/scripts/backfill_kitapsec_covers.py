"""kitapsec importundan kalan görselsiz ürünlere kapak fotoğrafı yükler.

`import_kitapsec_books.py` MinIO kapalıyken 4.687 ürünü `cover_url=NULL` ile
yükledi (deneme + tam tur, `kitapsec_import_log.jsonl` içinde kayıtlı). Bu
betik SADECE o günlükteki `product_id`'leri hedefler — orijinal 7 ürüne
(günlükte yok) asla dokunmaz.

Eşleşme: günlükteki `source_id` (kaynak sqlite `products.id`) ile kaynak
satırın `image_path`'i okunur (`images/{isbn}.{ext}` — ISBN geçersiz olup
DB'de isbn=NULL yazılan kayıtlarda da bu alan doludur, çünkü kaynaktaki
image_path ISBN doğrulamasından bağımsızdır). ISBN'e göre DOSYA ADI
TAHMİN EDİLMEZ; kaynağın kendi image_path'i okunur.

Boyutlandırma kararı: `core.storage.pad_to_square` kullanılır — aynen
`store_service.set_cover`'ın (admin elle kapak yüklerken) kullandığı yol.
Görsel oranı bozulmadan beyaz zeminli `PRODUCT_IMAGE_SIZE` (1200px) kare
tuvale sığdırılır (kırpılmaz), WebP kalite 82'ye çevrilir.
Ayrıca liste görünümü için AYRI bir küçük thumbnail ÜRETİLMİYOR: platformda
zaten tek `cover_url` mimarisi var (bkz. `ProductSearchOut.cover_url`,
srcset/thumbnail alanı yok) — ikinci bir boyut eklemek yalnız bu betikte
özel bir şema sapması yaratırdı. WebP + 1200px kare tuval kaynaktaki en büyük
dosyayı (448 KB, JPEG/PNG) zaten büyük ölçüde küçültüyor (WebP q82 tipik
olarak orijinal JPEG'in %20-40'ı büyüklüğünde çıkar); mevcut liste
sayfasının performans etkisi bu betiğin sonunda ölçülüp raporlanır.

İdempotency: `cover_url IS NOT NULL` olan ürün atlanır — tekrar çalıştırma
güvenlidir. Bu turda kapak eklenen `product_id`'ler ayrı bir günlüğe
(``kitapsec_cover_log.jsonl``) yazılır; ``--undo-covers <run_id>`` bu
günlükten okuyup `cover_url`'i NULL'a geri döndürür (eski dosya MinIO'dan
silinmez — geri almanın amacı veritabanı referansını geri almaktır).

Kullanım (backend dizininden):

    python scripts/backfill_kitapsec_covers.py                      # rapor (dry-run)
    python scripts/backfill_kitapsec_covers.py --apply               # uygula
    python scripts/backfill_kitapsec_covers.py --undo-covers <run_id> # cover_url'leri geri al
"""

import argparse
import asyncio
import datetime
import json
import pathlib
import sqlite3
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

from sqlalchemy import select, update  # noqa: E402

from core import storage  # noqa: E402
from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from models.store import Product  # noqa: E402


async def _upload_via_shared_client(s3, file_bytes: bytes) -> str:
    """`storage.upload_product_photo` ile AYNI dönüşüm (pad_to_square → WebP →
    ``library-photos/`` public önek), ama HER görsel için yeni bir aioboto3
    Session/istemci kurmak yerine ÇAĞRI SAHİBİNİN açtığı TEK istemciyi kullanır.

    Neden gerekli: ilk denemede parti başı (200 görsel) ~220 saniye sürdü —
    görsel başına ~1,1 saniye. Suçlu Pillow ya da ağ değil: `aioboto3.Session()`
    her çağrıda botocore'un servis modellerini diskten yeniden yüklüyor. 4.681
    görselde bu, tüm turu ~90 dakikaya çıkarıyordu. Tek istemciyle bu maliyet
    turda BİR KEZ ödenir.

    Dönüşüm ``pad_to_square``'dir (``optimize_photo`` DEĞİL): mağaza ızgarasında
    her ürün görseli aynı beyaz zeminli kare tuvalde durmalı. Bu betiğin kendi
    kopyası olması yalnız istemci paylaşımı içindir — dönüşüm kararı tek
    kaynakta, ``core/storage``'da yaşar."""
    data = await storage._optimize_in_thread(storage.pad_to_square, file_bytes)  # noqa: SLF001
    key = f"library-photos/{uuid.uuid4().hex}.webp"
    body_kwargs = {
        "Bucket": settings.AWS_BUCKET_NAME,
        "Key": key,
        "Body": data,
        "ContentType": "image/webp",
    }
    try:
        await s3.put_object(**body_kwargs, ACL="public-read")
    except Exception:  # noqa: BLE001 — bazı MinIO kurulumları ACL parametresini reddeder
        await s3.put_object(**body_kwargs)
    return storage.object_url(key)

DEFAULT_SQLITE_PATH = (
    pathlib.Path.home() / "Desktop" / "universite_hazirlik" / "books.sqlite3"
)
DEFAULT_IMAGES_DIR = pathlib.Path.home() / "Desktop" / "universite_hazirlik" / "images"
IMPORT_LOG_PATH = pathlib.Path(__file__).resolve().parent / "data" / "kitapsec_import_log.jsonl"
COVER_LOG_PATH = pathlib.Path(__file__).resolve().parent / "data" / "kitapsec_cover_log.jsonl"


def _load_import_log() -> list[dict]:
    """Yalnız BU import turlarının ürünleri — orijinal 7 ürün burada YOK."""
    if not IMPORT_LOG_PATH.exists():
        print(f"HATA: {IMPORT_LOG_PATH} yok — önce import_kitapsec_books.py çalıştırılmalı.")
        return []
    out = []
    for line in IMPORT_LOG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _append_cover_log(records: list[dict]) -> None:
    COVER_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with COVER_LOG_PATH.open("a", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _source_image_paths(sqlite_path: pathlib.Path, source_ids: list[int]) -> dict[int, str | None]:
    con = sqlite3.connect(str(sqlite_path))
    cur = con.cursor()
    out: dict[int, str | None] = {}
    CHUNK = 900  # sqlite değişken limiti
    for i in range(0, len(source_ids), CHUNK):
        chunk = source_ids[i : i + CHUNK]
        placeholders = ",".join("?" * len(chunk))
        cur.execute(
            f"SELECT id, image_path FROM products WHERE id IN ({placeholders})",  # noqa: S608
            chunk,
        )
        for sid, image_path in cur.fetchall():
            out[sid] = image_path
    con.close()
    return out


async def _minio_available() -> bool:
    """`ensure_bucket` fail-open'dır (bkz. import_kitapsec_books.py'deki not) —
    burada gerçek erişilebilirlik için doğrudan `head_bucket` denenir."""
    try:
        async with storage._s3_client() as s3:  # noqa: SLF001
            await s3.head_bucket(Bucket=settings.AWS_BUCKET_NAME)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"HATA: MinIO'ya erişilemedi ({exc})")
        return False


async def main(args: argparse.Namespace) -> int:
    sqlite_path = pathlib.Path(args.sqlite)
    images_dir = pathlib.Path(args.images_dir)

    if not await _minio_available():
        print("Görsel yüklemesi yapılamaz — MinIO kapalı. Çıkılıyor.")
        return 1
    print("MinIO erişilebilir (head_bucket doğrulandı).")

    import_log = _load_import_log()
    if not import_log:
        return 1
    # source_id -> en son product_id/isbn (aynı source_id ikinci kez loglanmaz zaten,
    # ama güvence için son kaydı esas al).
    by_source: dict[int, dict] = {}
    for rec in import_log:
        by_source[rec["source_id"]] = rec
    print(f"İmport günlüğünde {len(by_source)} ürün (yalnız bu turların ürünleri).")

    image_paths = _source_image_paths(sqlite_path, list(by_source.keys()))

    async with AsyncSessionLocal() as db:
        product_ids = [rec["product_id"] for rec in by_source.values()]
        rows = (
            await db.execute(
                select(Product.id, Product.cover_url).where(
                    Product.id.in_(product_ids), Product.deleted_at.is_(None)
                )
            )
        ).all()
        cover_by_id = {pid: cover for pid, cover in rows}

        # source_id -> (product_id, image_path) — yalnız DB'de cover_url NULL olanlar.
        candidates: list[tuple[int, int, str | None]] = []
        already_set = 0
        not_in_db = 0
        for source_id, rec in by_source.items():
            pid = rec["product_id"]
            if pid not in cover_by_id:
                not_in_db += 1  # silinmiş/bulunamayan ürün — atla
                continue
            if cover_by_id[pid]:
                already_set += 1
                continue
            candidates.append((source_id, pid, image_paths.get(source_id)))

        print(
            f"Zaten cover_url dolu (idempotent atlandı): {already_set}\n"
            f"DB'de bulunamadı (silinmiş olabilir): {not_in_db}\n"
            f"Kapak adayı: {len(candidates)}"
        )

        missing_no_path = [c for c in candidates if not c[2]]
        candidates = [c for c in candidates if c[2]]
        print(f"Kaynakta image_path boş (eksik, hata SAYILMAZ): {len(missing_no_path)}")

        if not args.apply:
            print("\nDRY-RUN — hiçbir görsel yüklenmedi. Uygulamak için: --apply")
            return 0

        run_id = uuid.uuid4().hex[:12]
        started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        batch_size = max(1, args.batch_size)
        n_batches = (len(candidates) + batch_size - 1) // batch_size
        print(f"\nUygulama başlıyor: {len(candidates)} aday, {n_batches} parti (parti başı {batch_size}).")

        total_uploaded = total_not_found = total_errors = 0
        total_bytes = 0
        aborted = False

        async with storage._s3_client() as s3:  # noqa: SLF001 — tur boyunca TEK istemci
            for bi in range(n_batches):
                lo, hi = bi * batch_size, min((bi + 1) * batch_size, len(candidates))
                batch = candidates[lo:hi]
                t0 = time.monotonic()

                uploaded = not_found = errors = 0
                log_records = []
                for source_id, pid, image_path in batch:
                    p = images_dir / pathlib.Path(image_path).name
                    if not p.exists():
                        not_found += 1
                        continue
                    try:
                        data = p.read_bytes()
                        url = await _upload_via_shared_client(s3, data)
                    except Exception as exc:  # noqa: BLE001
                        errors += 1
                        print(f"      ! src#{source_id} pid={pid} yükleme hatası: {exc}")
                        continue

                    await db.execute(
                        update(Product).where(Product.id == pid).values(cover_url=url)
                    )
                    total_bytes += p.stat().st_size
                    uploaded += 1
                    log_records.append(
                        {
                            "run_id": run_id,
                            "source_id": source_id,
                            "product_id": pid,
                            "cover_url": url,
                            "uploaded_at": started_at,
                        }
                    )
                await db.commit()
                _append_cover_log(log_records)

                elapsed = time.monotonic() - t0
                total_uploaded += uploaded
                total_not_found += not_found
                total_errors += errors
                print(
                    f"  Parti {bi + 1}/{n_batches}: uploaded={uploaded} not_found={not_found} "
                    f"errors={errors} — {elapsed:.1f}s"
                )

                if errors > args.max_batch_errors:
                    print(
                        f"\nDURDURULDU: bu partide {errors} hata (> {args.max_batch_errors}). "
                        "Bu partiye kadarki başarılı yüklemeler kaydedildi; yeniden çalıştırma "
                        "(idempotent) bu noktadan devam eder."
                    )
                    aborted = True
                    break

        print(
            f"\nTOPLAM: uploaded={total_uploaded} not_found(dosya yok, hata sayılmadı)="
            f"{total_not_found} errors={total_errors} "
            f"(+{len(missing_no_path)} kaynakta image_path boş)"
        )
        print(f"Yüklenen kaynak baytları toplamı (optimize ÖNCESİ): {total_bytes / 1024 / 1024:.1f} MB")
        print(f"run_id={run_id}  (geri almak için: --undo-covers {run_id})")
        return 1 if aborted else 0


async def undo_covers(run_id: str) -> int:
    if not COVER_LOG_PATH.exists():
        print("Kapak günlüğü yok, geri alınacak bir şey bulunamadı.")
        return 1
    targets = []
    for line in COVER_LOG_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if rec.get("run_id") == run_id:
            targets.append(rec)
    if not targets:
        print(f"run_id={run_id} kapak günlüğünde bulunamadı.")
        return 1
    print(f"{len(targets)} ürünün cover_url'i NULL'a geri döndürülecek (run_id={run_id}).")
    print("Not: MinIO'daki nesneler SİLİNMEZ, yalnız DB referansı geri alınır.")
    async with AsyncSessionLocal() as db:
        ids = [t["product_id"] for t in targets]
        await db.execute(update(Product).where(Product.id.in_(ids)).values(cover_url=None))
        await db.commit()
    print("Tamamlandı.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", default=str(DEFAULT_SQLITE_PATH))
    parser.add_argument("--images-dir", default=str(DEFAULT_IMAGES_DIR))
    parser.add_argument("--apply", action="store_true", help="değişiklikleri gerçekten yaz")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument(
        "--max-batch-errors", type=int, default=10,
        help="bir partide bu sayıdan fazla YÜKLEME HATASI olursa DUR (dosya-yok hatası saymaz)",
    )
    parser.add_argument("--undo-covers", metavar="RUN_ID")
    ns = parser.parse_args()

    if ns.undo_covers:
        sys.exit(asyncio.run(undo_covers(ns.undo_covers)))
    sys.exit(asyncio.run(main(ns)))
