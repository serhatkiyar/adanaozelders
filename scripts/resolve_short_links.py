#!/usr/bin/env python3
"""adana_venues_all.json içindeki kısa (maps.app.goo.gl) linkleri çözer.

Her kısa linkin redirect'ini takip edip final URL'den lat/lng ayıklar,
kaydı yerinde günceller (lat/lng/link_tipi/maps_url=final) ve dosyaları yeniden yazar.
Çözülemeyenler 'short_unresolved' olarak işaretlenir → elle tamamlanır.
"""
import csv
import json
import re
import time
import urllib.request
from pathlib import Path

OUT = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")
JSON_PATH = OUT / "adana_venues_all.json"

LL = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
AT = re.compile(r"/@(-?\d+\.\d+),(-?\d+\.\d+),")
FIELDS = ["isim", "kategori", "alt_klasor", "telefon", "lat", "lng",
          "link_tipi", "maps_url", "website"]


def resolve(url, tries=2):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=20)
            final = resp.geturl()
            m = LL.search(final) or AT.search(final)
            if m:
                return float(m.group(1)), float(m.group(2)), final
            return None, None, final
        except Exception:
            time.sleep(1.5)
    return None, None, None


def main():
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    shorts = [r for r in rows if r["link_tipi"] == "short"]
    print(f"Çözülecek kısa link: {len(shorts)}")
    ok = fail = 0
    for i, r in enumerate(shorts, 1):
        lat, lng, final = resolve(r["maps_url"])
        if lat is not None:
            r["lat"], r["lng"] = lat, lng
            r["link_tipi"] = "short_resolved"
            r["maps_url"] = final
            ok += 1
            status = f"{lat},{lng}"
        else:
            r["link_tipi"] = "short_unresolved"
            if final:
                r["maps_url"] = final
            fail += 1
            status = "ÇÖZÜLEMEDİ"
        print(f"  [{i}/{len(shorts)}] {r['isim'][:34]:36} {status}")
        time.sleep(0.6)

    # Yeniden yaz
    JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    with (OUT / "adana_venues_all.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    geo = [r for r in rows if r["lat"] is not None]
    with (OUT / "adana_venues_geo.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(geo)

    print(f"\nÇözüldü: {ok}  | Çözülemedi: {fail}")
    print(f"Toplam lat/lng'li kayıt: {len(geo)} / {len(rows)}")
    if fail:
        print("\nÇözülemeyenler (elle eklenecek):")
        for r in rows:
            if r["link_tipi"] == "short_unresolved":
                print(f"  - {r['isim']}  [{r['kategori']}]")


if __name__ == "__main__":
    main()
