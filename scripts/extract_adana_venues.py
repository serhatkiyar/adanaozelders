#!/usr/bin/env python3
"""Adana Obsidian kasasındaki notlardan mekân verisini ayıklar.

Her not tipik olarak bir Google Maps linki + opsiyonel telefon içerir.
Uzun maps linklerinde lat/lng gömülüdür: ...!3d<lat>!4d<lng>...
Bu script:
  - isim (dosya adı)
  - kategori (üst klasör yolundan)
  - telefon (varsa)
  - lat/lng (uzun linkten parse edilebiliyorsa)
  - maps_url
  - link_tipi (long = lat/lng var, short = maps.app.goo.gl çözülmeli, yok)
çıkarır ve CSV + JSON üretir.
"""
import csv
import json
import re
import sys
from pathlib import Path

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
OUT_DIR = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")

LATLNG_RE = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
# Yedek: @lat,lng,zoom kalıbı (place name içeren linklerde 3d/4d daha doğru)
AT_RE = re.compile(r"/@(-?\d+\.\d+),(-?\d+\.\d+),")
URL_RE = re.compile(r"https?://\S+")
# Türk telefon: 0xxx / 5xx / +90, boşluk ve parantez toleranslı
PHONE_RE = re.compile(r"(?:\+?90[\s-]?)?(?:0?\s?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})")


def categorize(rel_parts):
    """Üst klasör yapısından kaba kategori üret."""
    top = rel_parts[0] if rel_parts else "?"
    return top


def parse_file(path: Path):
    rel = path.relative_to(VAULT)
    parts = list(rel.parts[:-1])  # klasörler (dosya adı hariç)
    text = path.read_text(encoding="utf-8", errors="replace")

    urls = [u.strip() for u in URL_RE.findall(text)]

    def is_maps(u):
        return ("google." in u and "/maps" in u) or "maps.app.goo.gl" in u

    maps_urls = [u for u in urls if is_maps(u)]
    website = next((u for u in urls if not is_maps(u)), "")
    url = maps_urls[0] if maps_urls else ""

    lat = lng = None
    link_type = "yok"
    if url:
        if "maps.app.goo.gl" in url:
            link_type = "short"  # lat/lng yok, çözülmeli
        else:
            m = LATLNG_RE.search(url)
            if m:
                lat, lng = float(m.group(1)), float(m.group(2))
                link_type = "long"
            else:
                m2 = AT_RE.search(url)
                if m2:
                    lat, lng = float(m2.group(1)), float(m2.group(2))
                    link_type = "long_at"
                else:
                    link_type = "long_nolatlng"

    # telefonu URL dışındaki metinden ara (URL içindeki sayılarla karışmasın)
    non_url = URL_RE.sub(" ", text)
    phone_match = PHONE_RE.search(non_url)
    phone = re.sub(r"\s+", "", phone_match.group(0)) if phone_match else ""

    return {
        "isim": path.stem,
        "kategori": categorize(parts),
        "alt_klasor": "/".join(parts),
        "telefon": phone,
        "lat": lat,
        "lng": lng,
        "link_tipi": link_type,
        "maps_url": url,
        "website": website,
    }


def main():
    files = sorted(VAULT.rglob("*.md"))
    rows = [parse_file(f) for f in files]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Tümü
    json_path = OUT_DIR / "adana_venues_all.json"
    json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    fields = ["isim", "kategori", "alt_klasor", "telefon", "lat", "lng", "link_tipi", "maps_url", "website"]
    csv_path = OUT_DIR / "adana_venues_all.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    # Sadece lat/lng'si olanlar (kullanıma en yakın)
    geo = [r for r in rows if r["lat"] is not None]
    geo_path = OUT_DIR / "adana_venues_geo.csv"
    with geo_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(geo)

    # Özet
    from collections import Counter
    cat = Counter(r["kategori"] for r in rows)
    ltype = Counter(r["link_tipi"] for r in rows)
    with_phone = sum(1 for r in rows if r["telefon"])

    print(f"Toplam not        : {len(rows)}")
    print(f"lat/lng olan      : {len(geo)}")
    print(f"telefon olan      : {with_phone}")
    print("\n-- Link tipi --")
    for k, v in ltype.most_common():
        print(f"  {k:16}: {v}")
    print("\n-- Kategori --")
    for k, v in cat.most_common():
        print(f"  {k:24}: {v}")
    print(f"\nÇıktılar: {OUT_DIR}")


if __name__ == "__main__":
    main()
