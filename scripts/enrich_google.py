#!/usr/bin/env python3
"""adana_venues_all.json kayıtlarını Google Places API (New) ile zenginleştirir.

Her kayıt için tek bir Text Search (New) çağrısı yapar (locationBias = mevcut lat/lng),
ilk sonucu alıp şu alanları doldurur:
  adres, il, ilce, mahalle, posta, saatler, puan, yorum_sayisi, google_place_id
Sonuçlar scripts/out/google_cache.json'a cache'lenir → tekrar çalıştırınca para yanmaz.

Kullanım:
  python enrich_google.py --limit 5      # sadece ilk 5 (deneme turu)
  python enrich_google.py                # hepsi (cache'tekiler atlanır)
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")
JSON_PATH = OUT / "adana_venues_all.json"
CACHE_PATH = OUT / "google_cache.json"

API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress",
    "places.addressComponents", "places.location",
    "places.regularOpeningHours.weekdayDescriptions",
    "places.rating", "places.userRatingCount",
    "places.internationalPhoneNumber", "places.nationalPhoneNumber",
    "places.websiteUri",
])

ENRICH_FIELDS = ["adres", "il", "ilce", "mahalle", "posta", "saatler",
                 "puan", "yorum_sayisi", "google_phone", "google_website",
                 "google_place_id"]


def key_of(r):
    return f"{r['alt_klasor']}/{r['isim']}"


def comp(components, *types):
    """addressComponents içinden verilen type'lardan ilkini bul (longText)."""
    for t in types:
        for c in components:
            if t in c.get("types", []):
                return c.get("longText") or c.get("shortText") or ""
    return ""


def search(name, lat, lng):
    body = {
        "textQuery": f"{name} Adana",
        "maxResultCount": 1,
        "languageCode": "tr",
        "regionCode": "TR",
    }
    if lat is not None:
        body["locationBias"] = {"circle": {
            "center": {"latitude": lat, "longitude": lng}, "radius": 500.0}}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    })
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract(place):
    comps = place.get("addressComponents", [])
    hours = place.get("regularOpeningHours", {}).get("weekdayDescriptions", [])
    return {
        "adres": place.get("formattedAddress", ""),
        "il": comp(comps, "administrative_area_level_1"),
        "ilce": comp(comps, "administrative_area_level_2"),
        "mahalle": comp(comps, "administrative_area_level_4",
                        "sublocality_level_1", "sublocality", "neighborhood"),
        "posta": comp(comps, "postal_code"),
        "saatler": " | ".join(hours),
        "puan": place.get("rating", ""),
        "yorum_sayisi": place.get("userRatingCount", ""),
        "google_phone": place.get("internationalPhoneNumber",
                                  place.get("nationalPhoneNumber", "")),
        "google_website": place.get("websiteUri", ""),
        "google_place_id": place.get("id", ""),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="sadece ilk N kayıt")
    args = ap.parse_args()

    if not API_KEY:
        raise SystemExit("HATA: GOOGLE_MAPS_API_KEY ortam değişkeni yok.")

    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}

    todo = [r for r in rows if key_of(r) not in cache]
    if args.limit:
        todo = todo[:args.limit]

    print(f"Toplam {len(rows)} kayıt · cache'te {len(cache)} · bu turda işlenecek: {len(todo)}")
    if not todo:
        print("Yapılacak yeni kayıt yok (hepsi cache'te).")
    ok = miss = err = 0
    for i, r in enumerate(todo, 1):
        name = r["isim"]
        try:
            res = search(name, r["lat"], r["lng"])
            places = res.get("places", [])
            if places:
                info = extract(places[0])
                cache[key_of(r)] = info
                ok += 1
                print(f"  [{i}/{len(todo)}] {name[:32]:34} → {info['ilce'] or '?'} / {info['mahalle'] or '?'}")
            else:
                cache[key_of(r)] = {f: "" for f in ENRICH_FIELDS}
                cache[key_of(r)]["_nohit"] = True
                miss += 1
                print(f"  [{i}/{len(todo)}] {name[:32]:34} → sonuç yok")
        except urllib.error.HTTPError as e:
            err += 1
            detail = e.read().decode("utf-8", "replace")[:200]
            print(f"  [{i}/{len(todo)}] {name[:32]:34} → HTTP {e.code}: {detail}")
            if e.code in (400, 401, 403):
                print("  >> Anahtar/API sorunu olabilir, duruyorum.")
                break
        except Exception as e:
            err += 1
            print(f"  [{i}/{len(todo)}] {name[:32]:34} → HATA {e}")
        time.sleep(0.2)
        CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

    # cache'i kayıtlara işle ve yeniden yaz
    for r in rows:
        info = cache.get(key_of(r))
        if info:
            for f in ENRICH_FIELDS:
                r[f] = info.get(f, "")
    JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nBaşarılı: {ok} · sonuçsuz: {miss} · hata: {err}")
    print(f"Cache: {CACHE_PATH}")


if __name__ == "__main__":
    main()
