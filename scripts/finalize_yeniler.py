#!/usr/bin/env python3
"""'yeniler' kayıtlarını gerçek kategori klasörlerine taşır + CSV'leri yeniler."""
import csv
import json
import shutil
from pathlib import Path

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
OUT = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")
JSON_PATH = OUT / "adana_venues_all.json"

rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))

moved = 0
for r in rows:
    if r.get("alt_klasor") == "yeniler":
        r["alt_klasor"] = r["kategori"]  # kategori = klasör adı
        moved += 1

JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"alt_klasor düzeltildi: {moved} kayıt")

# yeniler klasörünü tamamen sil (notlar format adımında doğru klasöre yeniden yazılacak)
yeniler = VAULT / "yeniler"
if yeniler.exists():
    shutil.rmtree(yeniler)
    print("'yeniler' klasörü silindi")

# CSV'leri yeniden üret
fields = ["isim","kategori","alt_klasor","il","ilce","mahalle","posta","adres",
          "telefon","lat","lng","puan","yorum_sayisi","saatler","google_website",
          "website","google_place_id","maps_url"]
for r in rows:
    for f in fields:
        r.setdefault(f, "")
with (OUT/"adana_venues_all.csv").open("w",encoding="utf-8-sig",newline="") as fh:
    w=csv.DictWriter(fh,fieldnames=fields,extrasaction="ignore");w.writeheader();w.writerows(rows)
geo=[r for r in rows if r["lat"] not in (None,"")]
with (OUT/"adana_venues_geo.csv").open("w",encoding="utf-8-sig",newline="") as fh:
    w=csv.DictWriter(fh,fieldnames=fields,extrasaction="ignore");w.writeheader();w.writerows(geo)
print(f"CSV yenilendi · all={len(rows)} · geo={len(geo)}")
