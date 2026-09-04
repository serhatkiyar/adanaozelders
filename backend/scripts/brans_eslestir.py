# -*- coding: utf-8 -*-
"""Mevcut serbest metin branşları kanonik derse bağlar (idempotent).

`tutor_subjects.subject` bugüne kadar doğrulanmamış serbest metindi; kayıtlarda
`Matematik`, `TYT`, `Fen Bilgisi`, `İngilizce konuşma becerileri` gibi karışık
yazımlar var. Bu betik onları `subjects` kataloğuna bağlar.

EŞLEME SIRASI (hepsi `tr_normalize` üzerinden):
  1. Ders adı tam eşleşme
  2. Eşanlamlı tam eşleşme (`fen` → Fen Bilimleri, `tyt matematik` → Matematik)
  3. Ders slug'ı

Eşleşmeyen kayıt **DOKUNULMADAN KALIR** (`subject_id` NULL) ve rapora düşer;
silinmez. "Osmanlı Türkçesi Paleografyası" gerçek bir hizmettir, taksonomide
karşılığı yok diye eğitmenin bildirimini yok saymak veri kaybıdır — o kayıtlar
panelin "eşlenmemiş branşlar" kuyruğuna düşer (Faz 4).

VARSAYILAN KURU KOŞUDUR. Yazmak için `--uygula`.
Geri almak için: `--geri-al <yedek.csv>` (betik yazmadan önce yedek üretir).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import datetime
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, update  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from core.search_text import normalize_tr  # noqa: E402
from models.subject import Subject, SubjectAlias  # noqa: E402
from models.tutor import TutorSubject  # noqa: E402

CIKTI_DIZINI = Path(__file__).resolve().parents[1] / "scripts" / "out"


async def _harita(db) -> dict[str, int]:
    """normalize edilmiş metin → subject_id. Öncelik: ad > eşanlamlı > slug."""
    harita: dict[str, int] = {}
    sluglar = (
        await db.execute(
            select(Subject.slug, Subject.id).where(Subject.deleted_at.is_(None))
        )
    ).all()
    for slug, sid in sluglar:
        harita.setdefault(slug, sid)
    aliaslar = (
        await db.execute(select(SubjectAlias.normalized, SubjectAlias.subject_id))
    ).all()
    for metin, sid in aliaslar:
        harita[metin] = sid
    adlar = (
        await db.execute(
            select(Subject.name, Subject.id).where(Subject.deleted_at.is_(None))
        )
    ).all()
    for ad, sid in adlar:
        harita[normalize_tr(ad)] = sid  # ad en güçlü sinyal, üzerine yazar
    return harita


async def esle(uygula: bool) -> tuple[list[tuple], list[tuple]]:
    async with AsyncSessionLocal() as db:
        harita = await _harita(db)
        satirlar = (
            await db.execute(
                select(TutorSubject.tutor_id, TutorSubject.subject, TutorSubject.subject_id)
            )
        ).all()

        yedek: list[tuple] = []
        rapor: list[tuple] = []
        # Aynı eğitmende iki ayrı metin aynı derse çıkabilir: biri "İngilizce",
        # diğeri "İngilizce konuşma becerileri" — ikincisi ilkinin eşanlamlısı.
        # `uq_tutor_subjects_canonical` bunu zaten reddediyor; ilkini bağlar,
        # ikincisini eşleşmemiş bırakırız (silmeyiz — bildirimi kaybetmeyelim).
        alinan: set[tuple[int, int]] = {
            (t, s) for t, _m, s in satirlar if s is not None
        }
        for tutor_id, metin, mevcut in satirlar:
            hedef = harita.get(normalize_tr(metin))
            if hedef is None:
                rapor.append(("ESLESMEDI", tutor_id, metin, ""))
                continue
            if mevcut == hedef:
                rapor.append(("ZATEN", tutor_id, metin, str(hedef)))
                continue
            if (tutor_id, hedef) in alinan:
                rapor.append(("YINELENEN", tutor_id, metin, str(hedef)))
                continue
            alinan.add((tutor_id, hedef))
            yedek.append((tutor_id, metin, mevcut if mevcut is not None else ""))
            rapor.append(("ESLESTI", tutor_id, metin, str(hedef)))
            if uygula:
                await db.execute(
                    update(TutorSubject)
                    .where(
                        TutorSubject.tutor_id == tutor_id,
                        TutorSubject.subject == metin,
                    )
                    .values(subject_id=hedef)
                )
        if uygula:
            await db.commit()
    return rapor, yedek


async def geri_al(yedek_yolu: Path) -> int:
    """Yedek CSV'den `subject_id` değerlerini eski hâline döndürür."""
    with yedek_yolu.open(encoding="utf-8", newline="") as f:
        satirlar = list(csv.reader(f))[1:]
    async with AsyncSessionLocal() as db:
        for tutor_id, metin, eski in satirlar:
            await db.execute(
                update(TutorSubject)
                .where(
                    TutorSubject.tutor_id == int(tutor_id),
                    TutorSubject.subject == metin,
                )
                .values(subject_id=int(eski) if eski else None)
            )
        await db.commit()
    return len(satirlar)


def main() -> None:
    ap = argparse.ArgumentParser(description="Serbest metin branşları kanonike bağlar.")
    ap.add_argument("--uygula", action="store_true")
    ap.add_argument("--geri-al", type=Path, help="Yedek CSV'den geri döndür")
    a = ap.parse_args()

    if a.geri_al:
        n = asyncio.run(geri_al(a.geri_al))
        print("geri alındı: %d satır" % n)
        return

    rapor, yedek = asyncio.run(esle(a.uygula))
    sayac: dict[str, int] = {}
    for tur, *_ in rapor:
        sayac[tur] = sayac.get(tur, 0) + 1
    for tur in sorted(sayac):
        print("  %-12s %d" % (tur, sayac[tur]))
    for tur, _tid, metin, _h in rapor:
        if tur == "ESLESMEDI":
            print("  ! eşleşmedi: %s" % metin)

    CIKTI_DIZINI.mkdir(parents=True, exist_ok=True)
    damga = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    with (CIKTI_DIZINI / ("brans_rapor_%s.csv" % damga)).open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.writer(f)
        w.writerow(["islem", "tutor_id", "subject", "subject_id"])
        w.writerows(rapor)
    if a.uygula and yedek:
        yol = CIKTI_DIZINI / ("brans_yedek_%s.csv" % damga)
        with yol.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["tutor_id", "subject", "eski_subject_id"])
            w.writerows(yedek)
        print("YEDEK: %s  (geri almak için --geri-al bu-dosya)" % yol)

    print("UYGULANDI." if a.uygula else "KURU KOŞU — yazılmadı. Uygulamak için: --uygula")


if __name__ == "__main__":
    main()
