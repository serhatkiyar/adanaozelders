"""Taksonomi v1 yükleyici — kategori ağacı + ürün atamaları (1 Eyl 2026).

Kaynak: Desktop/iş kültür scrapping/taxonomy/ (taxonomy-v1.yaml, 171 düğüm;
urun-kategori-v1.csv, 11.915 ürün eşlemesi). Kullanıcı kararı: güven eşiği
UYGULANMAZ, herkes yaprağına yüklenir ("sonra optimize ederiz").

Davranış:
  * Kategoriler SLUG ile upsert edilir; slug = düğümün TAM YOL id'si
    ("kirtasiye/kalemler..." → "kirtasiye-kalemler...") — tekillik ve yeniden
    koşulabilirlik bunun üzerine kurulu. Var olan kategori SİLİNMEZ.
  * Ürünler önce BARKODLA, barkodu boş/eşleşmeyenler CSV'deki id ile eşlenir
    (id yalnız barkod uyuşmazsa ve üründe barkod YOKSA kullanılır — yanlış
    ürüne yazmamak için).
  * `--uygula` verilmeden KURU KOŞU: hiçbir şey yazmaz, sayıları raporlar.
  * Uygulamadan önce mevcut atamaların geri-dönüş yedeği CSV olarak yazılır.

Çalıştırma (backend/):  python scripts/taxonomy_yukle.py [--uygula]
"""
from __future__ import annotations

import asyncio
import csv
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml  # noqa: E402
from sqlalchemy import select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from models.store import Product, ProductCategory  # noqa: E402

KAYNAK = Path(r"C:\Users\kiyar\Desktop\iş kültür scrapping\taxonomy")
YEDEK_DIZIN = Path(__file__).resolve().parent / "out"


def yol_slug(dugum_id: str) -> str:
    return dugum_id.replace("/", "-")[:140]


async def kategorileri_yukle(db, uygula: bool) -> tuple[dict[str, int], int]:
    """YAML düğümlerini upsert eder; düğüm id → DB id haritası döner."""
    d = yaml.safe_load((KAYNAK / "taxonomy-v1.yaml").read_text(encoding="utf-8"))
    dugumler = d["dugumler"]
    dugumler.sort(key=lambda x: x["seviye"])  # ebeveynler önce

    mevcut = {
        c.slug: c.id
        for c in (await db.execute(select(ProductCategory))).scalars()
        if c.deleted_at is None
    }
    harita: dict[str, int] = {}
    yeni = 0
    for n in dugumler:
        slug = yol_slug(n["id"])
        if slug in mevcut:
            harita[n["id"]] = mevcut[slug]
            continue
        yeni += 1
        if not uygula:
            harita[n["id"]] = -yeni  # kuru koşuda sahte id
            continue
        kat = ProductCategory(
            slug=slug,
            name=n["ad"],
            parent_id=harita.get(n["ust"]) if n.get("ust") else None,
        )
        db.add(kat)
        await db.flush()
        harita[n["id"]] = kat.id
    return harita, yeni


async def main() -> None:
    uygula = "--uygula" in sys.argv
    # Kullanıcı kararı (1 Eyl): amaç kategorileri SİTEDE görmek; ürün atamaları
    # 11.9k'lık scrape kataloğu import edilince yapılacak (mevcut DB ürünleriyle
    # kimlik kesişimi yok — 632 "id eşleşmesi" tesadüfi çakışmaydı, YAZILMAZ).
    sadece_agac = "--urunleri-de-ata" not in sys.argv
    async with AsyncSessionLocal() as db:
        harita, yeni_kategori = await kategorileri_yukle(db, uygula)
        if sadece_agac:
            print(f"kategori: {yeni_kategori} yeni, {len(harita)} toplam düğüm")
            if uygula:
                await db.commit()
                print("AĞAÇ UYGULANDI (ürün ataması yapılmadı).")
            else:
                print("KURU KOŞU — yazılmadı. Uygulamak için: --uygula")
            return

        with open(KAYNAK / "urun-kategori-v1.csv", encoding="utf-8-sig") as fh:
            satirlar = list(csv.DictReader(fh, delimiter=";"))

        urunler = (
            (await db.execute(select(Product).where(Product.deleted_at.is_(None))))
            .scalars()
            .all()
        )
        barkodla = {p.barcode.strip(): p for p in urunler if p.barcode}
        idle = {p.id: p for p in urunler}

        eslesen_barkod = eslesen_id = eslesmeyen = yaprak_yok = 0
        atamalar: list[tuple[Product, int]] = []
        for s in satirlar:
            hedef = harita.get(s["leaf_id"])
            if hedef is None:
                yaprak_yok += 1
                continue
            p = barkodla.get((s["barkod"] or "").strip())
            if p is not None:
                eslesen_barkod += 1
            else:
                aday = idle.get(int(s["id"])) if s["id"].isdigit() else None
                if aday is not None and not aday.barcode:
                    p = aday
                    eslesen_id += 1
            if p is None:
                eslesmeyen += 1
                continue
            atamalar.append((p, hedef))

        degisen = sum(1 for p, h in atamalar if p.category_id != h)
        print(f"kategori: {yeni_kategori} yeni, {len(harita)} toplam düğüm")
        print(f"ürün: {eslesen_barkod} barkodla + {eslesen_id} id ile eşleşti, "
              f"{eslesmeyen} eşleşmedi, {yaprak_yok} yaprağı tanınmadı")
        print(f"atama: {len(atamalar)} ürün, {degisen} tanesinin kategorisi değişecek")

        if not uygula:
            print("KURU KOŞU — yazılmadı. Uygulamak için: --uygula")
            return

        # Geri-dönüş yedeği (mevcut atamalar) — uygulamadan HEMEN önce.
        YEDEK_DIZIN.mkdir(exist_ok=True)
        yedek = YEDEK_DIZIN / f"kategori-yedek-{datetime.now():%Y%m%d-%H%M%S}.csv"
        with open(yedek, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["product_id", "eski_category_id"])
            for p in urunler:
                w.writerow([p.id, p.category_id])
        print(f"yedek: {yedek}")

        for p, hedef in atamalar:
            p.category_id = hedef
        await db.commit()
        print("UYGULANDI.")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    asyncio.run(main())
