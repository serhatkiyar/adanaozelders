# -*- coding: utf-8 -*-
"""Ders taksonomisi anlık görüntüsünü veritabanına yükler (idempotent).

Girdi `backend/data/dersler_v1.json` — `scripts/dersler_disa_aktar.py`'nin
ürettiği, depoya giren türetilmiş liste.

VARSAYILAN KURU KOŞUDUR. Yazmak için `--uygula`.

İDEMPOTENTLİK ANAHTARI `slug`. Betik HİÇBİR KAYDI SİLMEZ ve mevcut bir dersin
`is_active` değerine DOKUNMAZ: admin'in panelden pasife aldığı bir ders,
yeniden yükleme sonrası dirilmemelidir — katalog betiklerinin klasik hatası
budur. Aynı gerekçeyle eşanlamlılarda yalnız `source='IMPORT'` satırlar
yönetilir; admin'in elle eklediği (`ADMIN`) ve göçten gelen (`MIGRATION`)
satırlara dokunulmaz.

AKTİFLİK: yeni doğan ders varsayılan olarak PASİFTİR. Aktif açılacaklar
`--aktif-liste` dosyasından gelir (varsayılan `data/ders_eklemeleri.json` —
bugün sitede zaten seçilebilen ~113 kalem). Gerekçe: katalog 846 ders taşıyor
ama arkasında eğitmen olmayan bir dersi vitrinde göstermek, düzeltmeye
çalıştığımız "aratılınca sıfır sonuç" hastalığını büyütmekten başka bir şey
yapmaz. Pasif ders veritabanında durur, panelden açılır.

Kullanım:
    python scripts/dersler_yukle.py                 # kuru koşu + rapor
    python scripts/dersler_yukle.py --uygula
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import datetime
import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from core.search_text import normalize_tr  # noqa: E402
from models.subject import (  # noqa: E402
    LEVEL_SCALES,
    SUBJECT_GROUPS,
    LevelScale,
    Subject,
    SubjectAlias,
    SubjectLevelScale,
)

BACKEND = Path(__file__).resolve().parents[1]
VARSAYILAN_KAYNAK = BACKEND / "data" / "dersler_v1.json"
VARSAYILAN_AKTIF = BACKEND / "data" / "ders_eklemeleri.json"
CIKTI_DIZINI = BACKEND / "scripts" / "out"


def _slug(ad: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize_tr(ad)).strip("-")[:160]


def _aktif_sluglar(yol: Path) -> set[str]:
    veri = json.loads(yol.read_text(encoding="utf-8"))
    return {_slug(k["ad"]) for k in veri["dersler"]}


def _dogrula(dersler: list[dict]) -> None:
    """Yüklemeden ÖNCE veri sözleşmesi. Bozuk anlık görüntü sessizce yarım
    katalog yüklemektense hiç yüklemesin."""
    sluglar = [d["slug"] for d in dersler]
    if len(sluglar) != len(set(sluglar)):
        raise SystemExit("Anlık görüntüde slug çakışması var — dışa aktarımı yeniden koş.")
    aliaslar = [a for d in dersler for a in d["aliaslar"]]
    if len(aliaslar) != len(set(aliaslar)):
        raise SystemExit("Anlık görüntüde eşanlamlı çakışması var.")
    kume = set(sluglar)
    for d in dersler:
        if d["ust_slug"] and d["ust_slug"] not in kume:
            raise SystemExit("Kırık ebeveyn bağı: %s -> %s" % (d["slug"], d["ust_slug"]))
        if d["grup"] not in SUBJECT_GROUPS:
            raise SystemExit("Bilinmeyen grup: %s (%s)" % (d["grup"], d["slug"]))
        for m in d["merdivenler"]:
            if m not in LEVEL_SCALES:
                raise SystemExit("Bilinmeyen merdiven: %s (%s)" % (m, d["slug"]))


async def yukle(kaynak: Path, aktif_yol: Path, uygula: bool) -> list[tuple[str, str, str]]:
    veri = json.loads(kaynak.read_text(encoding="utf-8"))["dersler"]
    _dogrula(veri)
    aktif = _aktif_sluglar(aktif_yol)
    # Ebeveyn önce: `ust_slug` boş olanlar ilk turda yazılır.
    veri.sort(key=lambda d: (d["ust_slug"] is not None, d["grup"], d["ad"]))

    rapor: list[tuple[str, str, str]] = []
    async with AsyncSessionLocal() as db:
        merdiven_kodlari = set(
            (await db.execute(select(LevelScale.code))).scalars().all()
        )
        eksik = {m for d in veri for m in d["merdivenler"]} - merdiven_kodlari
        if eksik:
            raise SystemExit(
                "Seviye merdivenleri tabloda yok: %s — migration uygulanmamış." % eksik
            )

        mevcut = {
            s.slug: s
            for s in (
                await db.execute(select(Subject).where(Subject.deleted_at.is_(None)))
            ).scalars()
        }
        id_ile: dict[str, int] = {s: o.id for s, o in mevcut.items()}

        for sira, d in enumerate(veri):
            ust_id = id_ile.get(d["ust_slug"]) if d["ust_slug"] else None
            ders = mevcut.get(d["slug"])
            if ders is None:
                ders = Subject(
                    slug=d["slug"],
                    name=d["ad"],
                    parent_id=ust_id,
                    group_code=d["grup"],
                    sort_order=sira,
                    is_active=d["slug"] in aktif,
                )
                db.add(ders)
                await db.flush()
                id_ile[d["slug"]] = ders.id
                mevcut[d["slug"]] = ders
                rapor.append(("YENI", d["slug"], "aktif" if ders.is_active else "pasif"))
            else:
                degisen = []
                for alan, yeni in (
                    ("name", d["ad"]),
                    ("parent_id", ust_id),
                    ("group_code", d["grup"]),
                ):
                    if getattr(ders, alan) != yeni:
                        degisen.append(alan)
                        setattr(ders, alan, yeni)
                # `is_active` BİLEREK atlanır — admin kararıdır.
                rapor.append(
                    ("GUNCEL", d["slug"], ",".join(degisen) if degisen else "degisiklik yok")
                )

            await _merdivenleri_yaz(db, ders, d["merdivenler"], rapor)
            await _aliaslari_yaz(db, ders, d["aliaslar"], rapor)

        if uygula:
            await db.commit()
        else:
            await db.rollback()
    return rapor


async def _merdivenleri_yaz(db, ders, merdivenler, rapor) -> None:
    var = {
        r.scale_code
        for r in (
            await db.execute(
                select(SubjectLevelScale).where(SubjectLevelScale.subject_id == ders.id)
            )
        ).scalars()
    }
    for m in set(merdivenler) - var:
        db.add(SubjectLevelScale(subject_id=ders.id, scale_code=m))
        rapor.append(("MERDIVEN", ders.slug, m))


async def _aliaslari_yaz(db, ders, aliaslar, rapor) -> None:
    """Yalnız IMPORT kaynaklı satırları yönetir.

    Çakışma (metin başka bir derse bağlı) sessizce ATLANIR ve rapora yazılır:
    veritabanındaki global benzersizlik kısıtı zaten reddederdi, ama patlayan
    bir yükleme yerine gözden geçirilebilir bir satır daha yararlıdır.
    """
    var = {
        a.normalized: a
        for a in (
            await db.execute(
                select(SubjectAlias).where(SubjectAlias.subject_id == ders.id)
            )
        ).scalars()
    }
    for metin in aliaslar:
        n = normalize_tr(metin)
        if n in var:
            continue
        sahip = (
            await db.execute(
                select(SubjectAlias).where(SubjectAlias.normalized == n)
            )
        ).scalars().first()
        if sahip is not None:
            if sahip.subject_id != ders.id:
                rapor.append(("ALIAS_CAKISMA", ders.slug, metin))
            continue
        db.add(SubjectAlias(subject_id=ders.id, alias=metin, source="IMPORT"))
        rapor.append(("ALIAS", ders.slug, metin))


def main() -> None:
    ap = argparse.ArgumentParser(description="Ders taksonomisini veritabanına yükler.")
    ap.add_argument("--kaynak", type=Path, default=VARSAYILAN_KAYNAK)
    ap.add_argument("--aktif-liste", type=Path, default=VARSAYILAN_AKTIF)
    ap.add_argument("--uygula", action="store_true", help="Yaz (varsayılan kuru koşu)")
    a = ap.parse_args()

    rapor = asyncio.run(yukle(a.kaynak, a.aktif_liste, a.uygula))

    sayac: dict[str, int] = {}
    for tur, _, _ in rapor:
        sayac[tur] = sayac.get(tur, 0) + 1
    for tur in sorted(sayac):
        print("  %-14s %d" % (tur, sayac[tur]))

    CIKTI_DIZINI.mkdir(parents=True, exist_ok=True)
    damga = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    yol = CIKTI_DIZINI / ("dersler_yukle_%s.csv" % damga)
    with yol.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["islem", "slug", "not"])
        w.writerows(rapor)
    print("rapor: %s" % yol)

    if a.uygula:
        print("UYGULANDI.")
    else:
        print("KURU KOŞU — yazılmadı. Uygulamak için: --uygula")


if __name__ == "__main__":
    main()
