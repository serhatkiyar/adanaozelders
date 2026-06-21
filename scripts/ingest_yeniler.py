#!/usr/bin/env python3
"""'yeniler' klasöründeki notları parse edip adana_venues_all.json'a ekler.

Hem ham (URL+telefon) hem formatlı (frontmatter'lı) notları işler.
Kategori: formatlıda frontmatter'dan; hamda aşağıdaki CAT_MAP'ten.
Sonra normal hat çalışır: enrich_google → format → dedup → report.
"""
import json
import re
from pathlib import Path

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
YENILER = VAULT / "yeniler"
JSON_PATH = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out\adana_venues_all.json")

URL_RE = re.compile(r"https?://\S+")
LL = re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")
AT = re.compile(r"/@(-?\d+\.\d+),(-?\d+\.\d+),")
PHONE_RE = re.compile(r"(?:\+?90[\s-]?)?0?\s?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}")

# Ham notlar için kategori + (gerekirse) isim düzeltmesi
CAT_MAP = {
    "Adana Bilim ve Sanat Merkezi (ADANA BİLSEM)": "Eğitim Kurumları",
    "Arı Vip Eğitim Kurumları": "Eğitim Kurumları",
    "birikimkurs Yüreğir": "Eğitim Kurumları",
    "Cukurova Vocational Training Center": "Eğitim Kurumları",
    "etüt merkezi": "Eğitim Kurumları",
    "Gazipaşa Eğitim Adana": "Eğitim Kurumları",
    "Pİ AKADEMİ EĞİTİM KURUMLARI YÜREĞİR": "Eğitim Kurumları",
    "Sarıçam Halk Eğitimi Merkezi": "Eğitim Kurumları",
    "T": "Sürücü Kursları",
    "Yüreğir Bilim ve Sanat Merkezi": "Eğitim Kurumları",
    "Çağrı Kişisel Gelişim Kursu": "Diğerleri",
    "ÖSD Österreichisches Sprachdiplom Deutsch Tester, Adana": "Eğitim Kurumları",
    "Özel KOÇ Motorlu Taşıt Sürücü Kursu": "Sürücü Kursları",
    "Özel Yeni Hedef": "Eğitim Kurumları",
    "İRİS   BEMER AKADEMİ ADANA": "Diğerleri",
}
NAME_FIX = {"T": "Öz Tuğra Sürücü Kursu"}


def parse_frontmatter(text):
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    fm = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip('"')
    return fm


def latlng(url):
    m = LL.search(url) or AT.search(url)
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def main():
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    existing_keys = {f"{r['alt_klasor']}/{r['isim']}" for r in rows}
    added = []

    for path in sorted(YENILER.glob("*.md")):
        stem = path.stem
        text = path.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)

        urls = URL_RE.findall(text)
        maps_url = next((u for u in urls if ("google." in u and "/maps" in u) or "maps.app.goo.gl" in u), "")
        website = next((u for u in urls if not (("google." in u and "/maps" in u) or "maps.app.goo.gl" in u)), "")
        non_url = URL_RE.sub(" ", text)
        pm = PHONE_RE.search(non_url)
        phone = re.sub(r"\s+", "", pm.group(0)) if pm else ""

        if fm:
            rec = {
                "isim": fm.get("isim", stem),
                "kategori": fm.get("kategori", "Diğerleri"),
                "alt_klasor": "yeniler",
                "telefon": fm.get("telefon", phone),
                "lat": float(fm["lat"]) if fm.get("lat") else None,
                "lng": float(fm["lng"]) if fm.get("lng") else None,
                "link_tipi": fm.get("kaynak", "long"),
                "maps_url": fm.get("maps", maps_url),
                "website": fm.get("website", website),
            }
        else:
            lat, lng = latlng(maps_url)
            rec = {
                "isim": NAME_FIX.get(stem, stem),
                "kategori": CAT_MAP.get(stem, "Diğerleri"),
                "alt_klasor": "yeniler",
                "telefon": phone,
                "lat": lat, "lng": lng,
                "link_tipi": "long" if lat else ("short" if "maps.app" in maps_url else "yok"),
                "maps_url": maps_url,
                "website": website,
            }
        key = f"yeniler/{rec['isim']}"
        if key in existing_keys:
            print(f"  zaten var, atlandı: {rec['isim']}")
            continue
        rows.append(rec)
        added.append(rec)
        # ham notu doğru isimle yeniden adlandır (T → Öz Tuğra)
        if rec["isim"] != stem:
            new_path = YENILER / (rec["isim"] + ".md")
            path.rename(new_path)

    JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nEklendi: {len(added)} kayıt · toplam JSON: {len(rows)}")
    for r in added:
        print(f"  + [{r['kategori']:18}] {r['isim']}  lat={r['lat']}")


if __name__ == "__main__":
    main()
