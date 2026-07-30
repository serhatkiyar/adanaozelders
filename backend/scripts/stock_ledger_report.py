"""Defter sapma raporu — SALT OKUNUR.

`products.stock` ile defterin son `qty_after` değeri arasındaki farkları ürün
bazında listeler. Hiçbir veriyi değiştirmez.

    cd backend && python -m scripts.stock_ledger_report            # özet + ilk 40
    cd backend && python -m scripts.stock_ledger_report --all      # hepsi
    cd backend && python -m scripts.stock_ledger_report --csv x.csv
"""
from __future__ import annotations

import argparse
import asyncio
import io
import csv
import sys

from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal

SORGU = text(
    """
    SELECT p.id                                    AS product_id,
           p.sku,
           p.title,
           p.kind,
           p.deleted_at IS NOT NULL                AS silinmis,
           p.stock                                 AS urun_stogu,
           coalesce(m.qty_after, 0)                AS defter_stogu,
           p.stock - coalesce(m.qty_after, 0)      AS fark,
           m.movement_type                         AS son_hareket,
           m.created_at                            AS son_hareket_tarihi,
           coalesce(x.adet, 0)                     AS hareket_sayisi,
           (p.slug LIKE 'stok-test-%%' OR p.slug LIKE 'stok-yaris-%%'
            OR p.slug LIKE 'yazici-%%'   OR p.slug LIKE 'denetim-%%'
            OR p.slug LIKE 'kilit-%%'    OR p.slug LIKE 'uc-testi-%%'
            OR p.slug LIKE 'probe-%%'    OR p.slug LIKE 'migr-%%'
            OR p.slug LIKE 'kabul-%%')             AS test_kaynakli
    FROM products p
    LEFT JOIN (
        SELECT product_id, max(id) AS son, count(*) AS adet
        FROM stock_movements GROUP BY product_id
    ) x ON x.product_id = p.id
    LEFT JOIN stock_movements m ON m.id = x.son
    WHERE p.stock IS NOT NULL
      AND p.stock IS DISTINCT FROM coalesce(m.qty_after, 0)
    ORDER BY test_kaynakli, p.id
    """
)

DIJITAL_SORGU = text(
    """
    SELECT p.id, p.sku, p.title, count(m.id) AS hareket
    FROM products p JOIN stock_movements m ON m.product_id = p.id
    WHERE p.stock IS NULL
    GROUP BY p.id, p.sku, p.title ORDER BY p.id
    """
)


async def topla():
    async with AsyncSessionLocal() as s:
        sapmalar = (await s.execute(SORGU)).all()
        dijital = (await s.execute(DIJITAL_SORGU)).all()
        toplam = (
            await s.execute(text("SELECT count(*) FROM products WHERE deleted_at IS NULL"))
        ).scalar_one()
    return sapmalar, dijital, toplam


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="hepsini yazdır")
    ap.add_argument("--csv", help="CSV'ye yaz")
    a = ap.parse_args()

    sapmalar, dijital, aktif = await topla()
    gercek = [r for r in sapmalar if not r.test_kaynakli]
    test = [r for r in sapmalar if r.test_kaynakli]

    print(f"veritabanı        : {settings.POSTGRES_DB}")
    print(f"aktif ürün        : {aktif}")
    print(f"sapmalı ürün      : {len(sapmalar)}  "
          f"(gerçek katalog {len(gercek)} · test kaynaklı {len(test)})")
    print(f"dijitalde hareket : {len(dijital)}")
    print()

    gosterilecek = sapmalar if a.all else (gercek + test)[:40]
    if gosterilecek:
        print(f"{'id':>6} {'SKU':<14} {'stok':>6} {'defter':>7} {'fark':>6} "
              f"{'hrk':>4}  {'son hareket':<18} {'tarih':<17} kaynak  başlık")
        for r in gosterilecek:
            print(
                f"{r.product_id:>6} {(r.sku or '-'):<14} {r.urun_stogu:>6} "
                f"{r.defter_stogu:>7} {r.fark:>6} {r.hareket_sayisi:>4}  "
                f"{(r.son_hareket or '—'):<18} "
                f"{(str(r.son_hareket_tarihi)[:16] if r.son_hareket_tarihi else '—'):<17} "
                f"{'TEST ' if r.test_kaynakli else 'GERÇEK'}  "
                f"{(r.title or '')[:38]}"
            )
        if not a.all and len(sapmalar) > len(gosterilecek):
            print(f"... (+{len(sapmalar) - len(gosterilecek)} satır; --all ile hepsi)")

    if dijital:
        print("\nDİJİTAL ÜRÜNDE HAREKET (olmamalı):")
        for r in dijital:
            print(f"  {r.id:>6} {r.sku:<14} {r.hareket:>3} hareket  {r.title[:40]}")

    if a.csv:
        with open(a.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                ["product_id", "sku", "title", "kind", "silinmis", "urun_stogu",
                 "defter_stogu", "fark", "son_hareket", "son_hareket_tarihi",
                 "hareket_sayisi", "test_kaynakli"]
            )
            for r in sapmalar:
                w.writerow(list(r))
        print(f"\nCSV yazıldı: {a.csv}")
    return 0


# Windows konsolu cp1254; Türkçe/ok karakterleri kırmasın.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
