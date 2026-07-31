"""Defter yeniden bazlama — YALNIZ GELİŞTİRME/TEST ortamı.

## Neden var

Geliştirme veritabanındaki `products.stock` değerleri defterle uyuşmuyordu. Kök
sebep **canlı migration değil, test/geliştirme kazasıydı**: entegrasyon testleri
geliştirme veritabanına karşı koşuyordu ve bir mutasyon provası denetim işine
`UPDATE products SET stock = 0` enjekte edip commit etti. Defter (append-only)
zarar görmedi; bozulan şey ondan **türetilen** `products.stock` alanı oldu.

Bu yüzden düzeltmenin canlı migration'da yeri yoktur: üretimde böyle bir sapma
oluşmadı ve otomatik düzeltme, gerçek bir stok sorununu sessizce örtme riski
taşır. Araç ayrı, açık onaylı ve yalnız geliştirme ortamında çalışır.

## Güvenlik sözleşmesi

* `ENVIRONMENT=production` → **sert ret**.
* Varsayılan **dry-run**; `--apply` olmadan hiçbir şey yazılmaz.
* Değiştirilemez hareketler **asla** güncellenmez/silinmez.
* Ürün satırı `FOR UPDATE` ile kilit altında düzeltilir.
* Dijital ürün, negatif sonuç ve belirsiz durumlar **otomatik düzeltilmez**.
* İkinci çalıştırma yeni hareket üretmez (idempotent).
* Uygulamadan önce ve sonra özet basar.

## Yön

`--source ledger` (varsayılan): `products.stock ← defterin son qty_after`'ı.
Defter bozulmamışsa doğru yön budur ve **yeni hareket yazılmaz** (defter zaten o
değeri söylüyor; hareket eklemek zinciri bozardı).

`--source stock`: defter, mevcut `products.stock`'u açıklayacak şekilde bir
`ADMIN_ADJUSTMENT` hareketiyle tamamlanır (`reason_code=HATALI_GIRIS`,
`note` içinde `DEVELOPMENT_REBASE` damgası). Defterin eksik olduğu, stoğun
doğru sayıldığı durumlar için.

    python -m scripts.dev_rebase_stock                     # dry-run özet
    python -m scripts.dev_rebase_stock --apply             # uygula
    python -m scripts.dev_rebase_stock --purge-test-products --apply
"""
from __future__ import annotations

import argparse
import asyncio
import io
import sys

from sqlalchemy import select, text

from core.config import settings
from core.database import AsyncSessionLocal
from models.store import Product, StockMovement
from services import stock_ledger

DEV_DAMGA = "DEVELOPMENT_REBASE"

#: Test kodunun ürettiği ürünlerin slug önekleri.
TEST_ONEKLERI = (
    "stok-test-", "stok-yaris-", "yazici-", "denetim-",
    "kilit-", "uc-testi-", "probe-", "migr-", "kabul-",
)

SAPMA_SORGUSU = text(
    """
    SELECT p.id, p.sku, p.title, p.kind, p.stock,
           coalesce(m.qty_after, 0) AS defter, coalesce(x.adet, 0) AS hareket
    FROM products p
    LEFT JOIN (SELECT product_id, max(id) son, count(*) adet
               FROM stock_movements GROUP BY product_id) x ON x.product_id = p.id
    LEFT JOIN stock_movements m ON m.id = x.son
    WHERE p.stock IS NOT NULL AND p.stock IS DISTINCT FROM coalesce(m.qty_after, 0)
    ORDER BY p.id
    """
)


def _guard() -> None:
    if (settings.ENVIRONMENT or "").strip().lower() == "production":
        raise SystemExit(
            "REDDEDİLDİ: bu araç ENVIRONMENT=production ile çalıştırılamaz. "
            "Üretimde stok/defter sapması bir VERİ SORUNUDUR ve elle "
            "incelenmelidir; toplu yeniden bazlama gerçek bir kaybı örter."
        )


def _test_urunu(slug: str) -> bool:
    return any((slug or "").startswith(o) for o in TEST_ONEKLERI)


async def _ozet(baslik: str) -> tuple[int, int]:
    async with AsyncSessionLocal() as s:
        sapma = len((await s.execute(SAPMA_SORGUSU)).all())
        hareket = (
            await s.execute(text("SELECT count(*) FROM stock_movements"))
        ).scalar_one()
    print(f"{baslik:<10} sapmalı ürün: {sapma:>5}   defter satırı: {hareket:>6}")
    return sapma, hareket


async def _purge_test_products(apply: bool) -> int:
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(Product.id, Product.slug))).all()
    hedef = [r.id for r in rows if _test_urunu(r.slug)]
    print(f"\ntest kaynaklı ürün: {len(hedef)}")
    if not hedef or not apply:
        return len(hedef)
    async with AsyncSessionLocal() as s:
        # Defter append-only trigger'ı yalnız bu işlem için ve YALNIZ
        # geliştirme/test ortamında devre dışı bırakılır.
        await s.execute(text("ALTER TABLE stock_movements DISABLE TRIGGER USER"))
        try:
            await s.execute(
                text("DELETE FROM stock_movements WHERE product_id = ANY(:i)"),
                {"i": hedef},
            )
        finally:
            await s.execute(text("ALTER TABLE stock_movements ENABLE TRIGGER USER"))
        await s.execute(text("ALTER TABLE products DISABLE TRIGGER USER"))
        try:
            await s.execute(text("DELETE FROM products WHERE id = ANY(:i)"), {"i": hedef})
        finally:
            await s.execute(text("ALTER TABLE products ENABLE TRIGGER USER"))
        await s.commit()
    print(f"  → {len(hedef)} test ürünü ve defter satırları silindi")
    return len(hedef)


async def _rebase(kaynak: str, apply: bool) -> dict[str, int]:
    sayac = {"duzeltildi": 0, "atlandi": 0, "hareket": 0}
    async with AsyncSessionLocal() as s:
        sapmalar = (await s.execute(SAPMA_SORGUSU)).all()

    print(f"\nsapmalı ürün: {len(sapmalar)}  ·  yön: {kaynak}")
    for r in sapmalar:
        if r.kind != "PHYSICAL":
            print(f"  ATLA  {r.id:>6} {r.sku}  dijital ürün — otomatik düzeltilmez")
            sayac["atlandi"] += 1
            continue
        if kaynak == "ledger":
            hedef = int(r.defter)
            if hedef < 0:
                print(f"  ATLA  {r.id:>6} {r.sku}  defter negatif ({hedef}) — belirsiz")
                sayac["atlandi"] += 1
                continue
            if r.hareket == 0:
                print(
                    f"  ATLA  {r.id:>6} {r.sku}  defteri BOŞ; stok {r.stock} "
                    "— hangisinin doğru olduğu belirsiz (--source stock kullanın)"
                )
                sayac["atlandi"] += 1
                continue
            print(f"  DÜZELT {r.id:>6} {r.sku}  stok {r.stock} → {hedef} (defterden)")
            sayac["duzeltildi"] += 1
            if apply:
                async with AsyncSessionLocal() as s:
                    # Kilit altında: eşzamanlı bir satış araya girmesin.
                    kilitli = await stock_ledger.lock_products(s, [r.id])
                    p = kilitli[r.id]
                    son = (
                        await s.execute(
                            select(StockMovement.qty_after)
                            .where(StockMovement.product_id == r.id)
                            .order_by(StockMovement.id.desc())
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if son is None:
                        await s.rollback()
                        continue
                    if p.stock == son:          # idempotent: ikinci koşumda no-op
                        await s.rollback()
                        continue
                    await s.execute(
                        text("UPDATE products SET stock = :v WHERE id = :i"),
                        {"v": int(son), "i": r.id},
                    )
                    await s.commit()
        else:  # kaynak == "stock"
            delta = int(r.stock) - int(r.defter)
            if delta == 0:
                continue
            if int(r.stock) < 0:
                print(f"  ATLA  {r.id:>6} {r.sku}  stok negatif — belirsiz")
                sayac["atlandi"] += 1
                continue
            print(
                f"  HAREKET {r.id:>6} {r.sku}  defter {r.defter} → {r.stock} "
                f"(ADMIN_ADJUSTMENT {delta:+d})"
            )
            sayac["duzeltildi"] += 1
            if apply:
                async with AsyncSessionLocal() as s:
                    # Idempotency: aynı damgalı hareket varsa tekrar yazma.
                    var = (
                        await s.execute(
                            select(StockMovement.id).where(
                                StockMovement.product_id == r.id,
                                StockMovement.note.like(f"{DEV_DAMGA}%"),
                            )
                        )
                    ).first()
                    if var:
                        await s.rollback()
                        continue
                    # `apply_movement` stoğu KENDİSİ yazar; hedefe delta ile gider.
                    await stock_ledger.apply_movement(
                        s, r.id,
                        qty_delta=delta,
                        bucket=stock_ledger.StockBucket.SALEABLE,
                        movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
                        reason_code="HATALI_GIRIS",
                        actor_type="ADMIN",
                        actor_id=1,
                        note=(
                            f"{DEV_DAMGA}: geliştirme ortamında defter ile "
                            f"products.stock ayrışmıştı ({r.defter} → {r.stock})"
                        ),
                    )
                    await s.commit()
                    sayac["hareket"] += 1
    return sayac


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="gerçekten uygula")
    ap.add_argument("--source", choices=("ledger", "stock"), default="ledger")
    ap.add_argument("--purge-test-products", action="store_true")
    a = ap.parse_args()

    _guard()
    print(f"ortam: {settings.ENVIRONMENT}   veritabanı: {settings.POSTGRES_DB}")
    print("MOD : " + ("UYGULA (--apply)" if a.apply else "DRY-RUN (hiçbir şey yazılmaz)"))
    print()
    await _ozet("ÖNCE")

    if a.purge_test_products:
        await _purge_test_products(a.apply)

    sayac = await _rebase(a.source, a.apply)

    print()
    await _ozet("SONRA" if a.apply else "(dry-run)")
    print(
        f"\ndüzeltilecek/düzeltilen: {sayac['duzeltildi']}   "
        f"atlanan (belirsiz): {sayac['atlandi']}   "
        f"yazılan hareket: {sayac['hareket']}"
    )
    if not a.apply:
        print("\nHiçbir şey değiştirilmedi. Uygulamak için: --apply")
    return 0


# Windows konsolu cp1254; Türkçe/ok karakterleri kırmasın.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
