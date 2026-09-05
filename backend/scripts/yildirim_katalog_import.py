"""Yıldırım B2B kataloğunu mağazaya yükler — GÖRSELSİZ deneme importu (1 Eyl).

Kullanıcı kararı: mevcut ürünler önemsiz, tablo "sıfırlanabilir". Sıfırlama
SOFT-DELETE ile yapılır (hard delete sipariş/stok defterlerini FK'dan koparıp
para kayıtlarını bozar; soft-delete aynı görsel sonucu verir, tarihçe durur).

Kaynaklar (Desktop/iş kültür scrapping/):
  * yildirim-katalog-v2(1).csv  — 11.915 ürün: ad, marka, barkod, stok,
    liste_fiyat, maliyet; resim URL'leri BİLEREK KULLANILMAZ (görselsiz deneme).
  * taxonomy/urun-kategori-v1.csv — id → leaf_id (kategori) eşlemesi.

Kurallar:
  * kind=PHYSICAL, seller_type=PLATFORM, currency varsayılan.
  * Kategorisi eşleşen ürün ACTIVE, eşleşmeyen DRAFT (ck_products: ACTIVE
    ürün kategorisiz olamaz).
  * sku "YLD-<kaynak id>" (kaynağa geri dönülebilir kimlik); slug ad'dan,
    çakışmada id ekiyle. Barkod tekrarında yalnız İLKİ barkod taşır
    (uq_products_barcode_active kısmi tekil).
  * marka `publisher` alanına yazılır (ayrı marka kolonu yok; detay sayfası
    bunu "Yayıncı" diye gösterebilir — bilinçli geçici tercih, deneme importu).
  * tax_rate'e DOKUNULMAZ (mali müşavir kararı bekleyen mevcut sözleşme).

Çalıştırma (backend/): python scripts/yildirim_katalog_import.py [--uygula]
"""
from __future__ import annotations

import asyncio
import csv
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml  # noqa: E402
from sqlalchemy import select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from models.store import Product, ProductCategory  # noqa: E402

KAYNAK = Path(r"C:\Users\kiyar\Desktop\iş kültür scrapping")


def temizle(s: str) -> str:
    s = (s or "").strip().strip('"').strip()
    return re.sub(r"\s+", " ", s)


def slugla(s: str) -> str:
    s = s.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosucgiosu"))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:240] or "urun"


def fiyat(s: str) -> str | None:
    s = (s or "").strip().replace(".", "").replace(",", ".") if "," in (s or "") else (s or "").strip()
    try:
        f = float(s)
    except ValueError:
        return None
    return f"{f:.2f}" if f > 0 else None


async def main() -> None:
    uygula = "--uygula" in sys.argv

    # Kaynak id → leaf_id
    with open(KAYNAK / "taxonomy" / "urun-kategori-v1.csv", encoding="utf-8-sig") as fh:
        leaf_by_id = {r["id"]: r["leaf_id"] for r in csv.DictReader(fh, delimiter=";")}

    with open(KAYNAK / "yildirim-katalog-v2(1).csv", encoding="utf-8-sig") as fh:
        s = fh.readline(); ayrac = ";" if s.count(";") > s.count(",") else ","
    with open(KAYNAK / "yildirim-katalog-v2(1).csv", encoding="utf-8-sig") as fh:
        katalog = list(csv.DictReader(fh, delimiter=ayrac))

    dugumler = yaml.safe_load((KAYNAK / "taxonomy" / "taxonomy-v1.yaml").read_text(encoding="utf-8"))["dugumler"]
    slug_by_leaf = {n["id"]: n["id"].replace("/", "-")[:140] for n in dugumler}

    async with AsyncSessionLocal() as db:
        kategoriler = {
            c.slug: c.id
            for c in (await db.execute(select(ProductCategory).where(ProductCategory.deleted_at.is_(None)))).scalars()
        }
        kat_by_leaf = {leaf: kategoriler.get(slug) for leaf, slug in slug_by_leaf.items()}

        mevcut = (
            (await db.execute(select(Product).where(Product.deleted_at.is_(None)))).scalars().all()
        )

        gorulen_barkod: set[str] = set()
        gorulen_slug: set[str] = set()
        yeni: list[Product] = []
        fiyatsiz = kategorisiz = 0
        for r in katalog:
            ad = temizle(r["ad"])
            if not ad:
                continue
            p = fiyat(r["liste_fiyat"])
            if p is None:
                fiyatsiz += 1
                continue
            barkod = temizle(r.get("clean_barkod") or r["barkod"].replace('="', "").replace('"', ""))
            if barkod in gorulen_barkod:
                barkod = ""
            elif barkod:
                gorulen_barkod.add(barkod)

            slug = slugla(ad)
            if slug in gorulen_slug:
                slug = f"{slug}-{r['id']}"[:280]
            gorulen_slug.add(slug)

            kat = kat_by_leaf.get(leaf_by_id.get(r["id"], ""), None)
            if kat is None:
                kategorisiz += 1

            try:
                stok = max(0, int(float((r["stok"] or "0").replace(",", "."))))
            except ValueError:
                stok = 0

            yeni.append(
                Product(
                    slug=slug,
                    title=ad[:250],
                    kind="PHYSICAL",
                    seller_type="PLATFORM",
                    price=p,
                    stock=stok,
                    sku=f"YLD-{r['id']}",
                    barcode=barkod or None,
                    publisher=temizle(r["marka"])[:200] or None,
                    category_id=kat,
                    status="ACTIVE" if kat is not None else "DRAFT",
                )
            )

        print(f"kaynak: {len(katalog)} satır")
        print(f"hazır: {len(yeni)} ürün ({fiyatsiz} fiyatsız atlandı, {kategorisiz} kategorisiz->DRAFT)")
        print(f"soft-delete edilecek mevcut ürün: {len(mevcut)}")

        if not uygula:
            print("KURU KOŞU — yazılmadı. Uygulamak için: --uygula")
            return

        simdi = datetime.now(timezone.utc)
        for eski in mevcut:
            eski.deleted_at = simdi
        await db.flush()  # kısmi unique'ler (slug/barkod) boşalsın

        db.add_all(yeni)
        await db.commit()
        print("UYGULANDI.")


if __name__ == "__main__":
    asyncio.run(main())
