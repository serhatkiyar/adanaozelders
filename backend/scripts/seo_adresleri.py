# -*- coding: utf-8 -*-
"""Kök SEO adreslerini eşitler (Modül 6).

Migration `m11_seo_adresleri` yayındaki eğitmenlere ilan adresini ve derslere
ders adresini zaten verir; yeni ilanlar ilk yayında (`tutor_service.approve`)
adres alır. Bu komut yalnız bu yolların DIŞINDA oluşmuş kayıtlar içindir:
tohum verisi (`core/seed.py` eğitmeni doğrudan APPROVED yazar) ya da
`dersler_yukle.py` ile sonradan eklenen dersler.

İdempotenttir: adresi olan ilana dokunmaz (adres ilk yayında sabitlenir).

Kullanım:
    python scripts/seo_adresleri.py            # yalnız rapor (prova)
    python scripts/seo_adresleri.py --uygula   # yaz
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from models.seo_slug import SeoSlug  # noqa: E402
from models.tutor import Tutor  # noqa: E402
from services import seo_slug_service  # noqa: E402


async def calistir(uygula: bool) -> list[tuple[int, str]]:
    verilen: list[tuple[int, str]] = []
    async with AsyncSessionLocal() as db:
        await seo_slug_service.ders_ilce_adreslerini_esitle(db)
        adressiz = (
            await db.execute(
                select(Tutor)
                .where(
                    *seo_slug_service.yayinda_kosulu(),
                    ~Tutor.id.in_(
                        select(SeoSlug.tutor_id).where(
                            SeoSlug.kind == "ilan", SeoSlug.is_current.is_(True)
                        )
                    ),
                )
                .order_by(Tutor.id)
            )
        ).scalars().all()
        for t in adressiz:
            verilen.append((t.id, await seo_slug_service.ilan_slug_ata(db, t)))
        if uygula:
            await db.commit()
        else:
            await db.rollback()
    return verilen


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--uygula", action="store_true", help="değişiklikleri yaz")
    args = ap.parse_args()
    verilen = asyncio.run(calistir(args.uygula))
    for tid, slug in verilen:
        print(f"  eğitmen {tid:>6} → /{slug}")
    print(
        f"{len(verilen)} ilana adres "
        + ("verildi." if args.uygula else "verilecek (prova; yazmak için --uygula).")
    )


if __name__ == "__main__":
    main()
