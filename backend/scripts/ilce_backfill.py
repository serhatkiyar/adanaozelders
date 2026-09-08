# -*- coding: utf-8 -*-
"""Eğitmenlerin serbest metin konumundan yapısal `Tutor.district` doldurur.

## Neden var (8 Eyl 2026, ölçümle)

Yerel geliştirme veritabanında `/api/v1/tutors/search` şunları döndürüyordu:

    filtresiz            -> 7 eğitmen
    district=Seyhan      -> 0
    district=Çukurova    -> 0

Sebep: 7 eğitmenin 7'sinde de `Tutor.district` kolonu boştu. Yani sitedeki
"İlçe" filtresi hangi ilçe seçilirse seçilsin boş liste veriyordu — hata
vermeden, sessizce.

İlçe bilgisi kayıptı değil, YANLIŞ YERDEYDİ: serbest metin `location_text`
alanında duruyordu ("Adana, Seyhan", "Adana Ceyhan", "Adana, Çukurova"). O alan
aramaya hiç girmiyor.

Yazma yolu bugün sağlam — hem ilan sihirbazı hem eğitmen ayarları `district`
gönderiyor ve `tutor_service.update_profile` onu modele yazıyor. Bu kayıtlar o
alan akışa girmeden önce oluşturulmuş. Yani bu betik bir kereliktir; yeni
ilanlar ilçesini kendi doldurur.

## Eşleştirme kuralı

`location_text` Türkçe katlamalı (`normalize_tr`) hâle getirilir ve bilinen
Adana ilçeleri KELİME SINIRIYLA aranır. Kelime sınırı şart: "Ceyhan" araması
"Ceyhanbeyli" gibi bir metinde yanlış eşleşmemeli.

Birden fazla ilçe geçen metin **atlanır** — "Seyhan'dan Çukurova'ya giderim"
yazan birine ilçe atamak uydurmak olur. Hiç eşleşmeyen de atlanır. Betik boş
kolonu asla tahminle doldurmaz.

Yalnız `district` kolonu BOŞ olan kayıtlara dokunur; dolu olanı ezmez.

## Kullanım

    python scripts/ilce_backfill.py            # yalnız rapor (prova)
    python scripts/ilce_backfill.py --uygula   # yaz
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import or_, select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from core.search_text import normalize_tr  # noqa: E402
from models.tutor import Tutor  # noqa: E402

# Adana'nın 15 ilçesi. Frontend `lib/districts.ts` ile aynı küme olmalı;
# oradaki "Merkez" GERÇEK BİR İLÇE DEĞİL ve bilerek burada yok.
ADANA_ILCELERI = (
    "Seyhan",
    "Çukurova",
    "Yüreğir",
    "Sarıçam",
    "Ceyhan",
    "Kozan",
    "Karaisalı",
    "Karataş",
    "Yumurtalık",
    "İmamoğlu",
    "Pozantı",
    "Aladağ",
    "Feke",
    "Saimbeyli",
    "Tufanbeyli",
)


def ilce_bul(metin: str | None) -> str | None:
    """Serbest metinde geçen TEK ilçeyi döndürür; belirsizse None.

    Kelime sınırı (`\\b`) kullanılır: "Ceyhan" araması "Ceyhanbeyli" içinde
    eşleşmemeli. Birden fazla ilçe geçiyorsa karar veremeyiz — None.
    """
    if not metin:
        return None
    norm = normalize_tr(metin)
    bulunan = {
        ilce
        for ilce in ADANA_ILCELERI
        if re.search(rf"\b{re.escape(normalize_tr(ilce))}\b", norm)
    }
    return bulunan.pop() if len(bulunan) == 1 else None


async def calistir(uygula: bool) -> tuple[list[tuple], list[tuple]]:
    """(yazılacaklar, atlananlar) döndürür."""
    yazilacak: list[tuple] = []
    atlanan: list[tuple] = []
    async with AsyncSessionLocal() as db:
        satirlar = (
            await db.execute(
                select(Tutor).where(
                    # Yalnız ilçesi boş olanlar; dolu kayıt asla ezilmez.
                    or_(Tutor.district.is_(None), Tutor.district == ""),
                )
            )
        ).scalars().all()

        for t in satirlar:
            ilce = ilce_bul(t.location_text)
            if ilce:
                yazilacak.append((t.id, t.location_text, ilce))
                if uygula:
                    t.district = ilce
            else:
                atlanan.append((t.id, t.location_text))

        if uygula and yazilacak:
            await db.commit()
    return yazilacak, atlanan


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--uygula",
        action="store_true",
        help="Değişiklikleri yaz (verilmezse yalnız rapor basar).",
    )
    args = ap.parse_args()

    yazilacak, atlanan = asyncio.run(calistir(args.uygula))

    kip = "YAZILDI" if args.uygula else "PROVA (yazılmadı)"
    print(f"--- İlçe backfill · {kip}")
    print(f"Eşleşen : {len(yazilacak)}")
    for tid, metin, ilce in yazilacak:
        print(f"   #{tid:<4} {ilce:<12} <- {metin!r}")
    print(f"Atlanan : {len(atlanan)}  (eşleşme yok ya da birden fazla ilçe)")
    for tid, metin in atlanan:
        print(f"   #{tid:<4} {metin!r}")
    if not args.uygula and yazilacak:
        print("\nYazmak için: python scripts/ilce_backfill.py --uygula")


if __name__ == "__main__":
    main()
