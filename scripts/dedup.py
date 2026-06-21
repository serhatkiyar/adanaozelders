#!/usr/bin/env python3
"""Mükerrer mekân kayıtlarını tespit eder (ve --apply ile temizler).

Sinyaller:
  1) aynı google_place_id  (en güvenilir)
  2) ~aynı koordinat (5 ondalık ≈ 1 m)
  3) aynı normalize isim
Bir grupta KORUNAN = en çok yoruma sahip / en dolu kayıt; diğerleri silinir.
--apply verilirse JSON+CSV güncellenir ve mükerrer Obsidian notları silinir.
"""
import argparse
import csv
import json
import re
import unicodedata
from pathlib import Path

OUT = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")
VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
JSON_PATH = OUT / "adana_venues_all.json"


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def completeness(r):
    score = 0
    for f in ["adres", "telefon", "google_phone", "website", "saatler", "puan"]:
        if str(r.get(f, "")).strip():
            score += 1
    try:
        score += int(r.get("yorum_sayisi") or 0) / 1000.0  # yorum bol → tercih
    except (TypeError, ValueError):
        pass
    return score


def group_key(r):
    pid = (r.get("google_place_id") or "").strip()
    if pid:
        return ("pid", pid)
    if r.get("lat") is not None:
        return ("geo", round(float(r["lat"]), 5), round(float(r["lng"]), 5))
    return ("name", norm(r["isim"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))

    groups = {}
    for r in rows:
        groups.setdefault(group_key(r), []).append(r)
    # isim bazlı ikinci tur (pid farklı ama aynı isim+yakın geo olabilir)
    name_groups = {}
    for r in rows:
        name_groups.setdefault(norm(r["isim"]), []).append(r)

    dup_groups = [g for g in groups.values() if len(g) > 1]
    name_dups = [g for k, g in name_groups.items() if len(g) > 1 and k]

    print(f"Toplam kayıt: {len(rows)}")
    print(f"Mükerrer grup (place_id/geo): {len(dup_groups)}")
    print(f"Aynı isimli grup: {len(name_dups)}\n")

    to_delete = []
    print("=== place_id / koordinat mükerrerleri ===")
    for g in dup_groups:
        g_sorted = sorted(g, key=completeness, reverse=True)
        keep = g_sorted[0]
        drop = g_sorted[1:]
        to_delete += drop
        print(f"  GRUP ({group_key(keep)[0]}):")
        print(f"    KORU : {keep['isim']}  [{keep.get('ilce','')}] yorum={keep.get('yorum_sayisi','')}")
        for d in drop:
            print(f"    SİL  : {d['isim']}  [{d.get('ilce','')}] yorum={d.get('yorum_sayisi','')}")

    print("\n=== aynı isimli (place_id farklı) — İNCELEME, otomatik silinmez ===")
    seen_ids = {id(x) for x in to_delete}
    for g in name_dups:
        if any(id(x) in seen_ids for x in g):
            continue  # zaten place_id grubunda yakalandı
        print(f"  '{g[0]['isim']}' ×{len(g)}:")
        for d in g:
            print(f"    - [{d.get('ilce','')}] {d.get('lat')},{d.get('lng')} place_id={d.get('google_place_id','')[:14]}")

    print(f"\nSilinecek (net mükerrer): {len(to_delete)} kayıt")

    if not args.apply:
        print("\n(Sadece rapor — silmek için: python scripts/dedup.py --apply)")
        return

    del_ids = {id(x) for x in to_delete}
    kept = [r for r in rows if id(r) not in del_ids]

    # Obsidian notlarını sil
    deleted_files = 0
    for d in to_delete:
        rel = (d["alt_klasor"] + "/" if d["alt_klasor"] else "") + d["isim"] + ".md"
        p = VAULT / rel
        if p.exists():
            p.unlink()
            deleted_files += 1

    # JSON + CSV yeniden yaz
    JSON_PATH.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["isim","kategori","alt_klasor","il","ilce","mahalle","posta","adres",
              "telefon","lat","lng","puan","yorum_sayisi","saatler","google_website",
              "website","google_place_id","maps_url"]
    for r in kept:
        for f in fields: r.setdefault(f, "")
    with (OUT/"adana_venues_all.csv").open("w",encoding="utf-8-sig",newline="") as fh:
        w=csv.DictWriter(fh,fieldnames=fields,extrasaction="ignore");w.writeheader();w.writerows(kept)
    geo=[r for r in kept if r["lat"] not in (None,"")]
    with (OUT/"adana_venues_geo.csv").open("w",encoding="utf-8-sig",newline="") as fh:
        w=csv.DictWriter(fh,fieldnames=fields,extrasaction="ignore");w.writeheader();w.writerows(geo)

    print(f"\nUYGULANDI · kalan kayıt: {len(kept)} · silinen not dosyası: {deleted_files}")


if __name__ == "__main__":
    main()
