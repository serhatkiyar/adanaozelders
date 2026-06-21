#!/usr/bin/env python3
"""Maps URL'si olmayan kayıtların notlarını '_Maps Eksik' klasörüne taşır."""
import json
from pathlib import Path

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
JSON_PATH = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out\adana_venues_all.json")
TARGET = "_Maps Eksik"

rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
(VAULT / TARGET).mkdir(exist_ok=True)

moved = 0
for r in rows:
    if str(r.get("maps_url", "")).strip():
        continue
    old_rel = (r["alt_klasor"] + "/" if r["alt_klasor"] else "") + r["isim"] + ".md"
    old_path = VAULT / old_rel
    new_path = VAULT / TARGET / (r["isim"] + ".md")
    if old_path.exists():
        old_path.replace(new_path)
    r["alt_klasor"] = TARGET
    moved += 1
    print(f"  taşındı: {r['isim']}")

JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nToplam taşınan: {moved} · klasör: {TARGET}")
