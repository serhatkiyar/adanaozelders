#!/usr/bin/env python3
"""_Maps Eksik notlarından maps_url + lat/lng alıp JSON kayıtlarını günceller."""
import json
import re
import unicodedata
from pathlib import Path

_HERE = Path(__file__).resolve().parent

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
FOLDER = VAULT / "_Maps Eksik"
JSON_PATH = _HERE / "out" / "adana_venues_all.json"

URL = re.compile(r"https?://\S+")
LL = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
AT = re.compile(r"/@(-?\d+\.\d+),(-?\d+\.\d+),")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def fm_val(text, key):
    m = re.search(rf"^{key}:\s*(.*)$", text, re.M)
    return m.group(1).strip().strip('"') if m else ""


rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
eksik = [r for r in rows if r.get("alt_klasor") == "_Maps Eksik"]
by_name = {norm(r["isim"]): r for r in eksik}

notes = sorted(FOLDER.glob("*.md"))
matched_recs = set()
unmatched_notes = []

for p in notes:
    t = p.read_text(encoding="utf-8", errors="replace")
    isim = fm_val(t, "isim") or p.stem
    maps = next((u for u in URL.findall(t) if ("google." in u and "/maps" in u) or "maps.app.goo.gl" in u), "")
    lat = fm_val(t, "lat"); lng = fm_val(t, "lng")
    if (not lat or not lng) and maps:
        m = LL.search(maps) or AT.search(maps)
        if m: lat, lng = m.group(1), m.group(2)
    rec = by_name.get(norm(isim))
    info = {"isim": isim, "maps": maps, "lat": lat, "lng": lng}
    if rec:
        matched_recs.add(id(rec))
        rec["maps_url"] = maps
        rec["lat"] = float(lat) if lat else None
        rec["lng"] = float(lng) if lng else None
        rec["link_tipi"] = "long" if lat else "yok"
        print(f"  güncellendi: {isim}  lat={lat}")
    else:
        unmatched_notes.append(info)

# eşleşmeyen not(lar) = yeniden adlandırılmış kayıt (ör. Başlıksız → İsimsiz Cafe)
leftover_recs = [r for r in eksik if id(r) not in matched_recs]
for info, rec in zip(unmatched_notes, leftover_recs):
    rec["isim"] = info["isim"]
    rec["maps_url"] = info["maps"]
    rec["lat"] = float(info["lat"]) if info["lat"] else None
    rec["lng"] = float(info["lng"]) if info["lng"] else None
    rec["link_tipi"] = "long" if info["lat"] else "yok"
    # kafe ise kategori düzelt
    if re.search(r"cafe|kafe", info["isim"], re.I):
        rec["kategori"] = "Cafeler"
    print(f"  yeniden adlandırıldı → {info['isim']}  (kategori={rec['kategori']})")

JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nMaps linki olan _Maps Eksik kaydı: {sum(1 for r in eksik if r.get('maps_url'))}/{len(eksik)}")
