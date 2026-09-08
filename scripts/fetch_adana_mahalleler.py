# -*- coding: utf-8 -*-
"""Adana mahalle listesini OpenStreetMap'ten çeker (TEK SEFERLİK).

## Neden var

Arama kutusunda konum ilçe seviyesinde kalıyordu; kullanıcı mahalleye kadar
inebilmek istedi. Depoda hazır bir mahalle listesi yoktu — en yakın şey
`scripts/out/adana_venues_all.json` içindeki 238 mekân kaydından türetilebilen
66 mahalle adıydı, ama o bir yan ürün ve Adana'nın tamamını kapsamıyor.

## Bu betik ÜRÜNÜN ÇALIŞMA ZAMANI DEĞİLDİR

Çıktısı (`frontend/src/lib/adanaYerler.ts`) depoya statik olarak commit edilir.
Site çalışırken ne OSM'e ne başka bir servise gider. Betik yalnız veri
tazelemek gerektiğinde elle çalıştırılır.

Kullanıcı kararı buydu: konum önerileri kendi listemizden gelecek, Google
Places çalışma zamanında kullanılmayacak.

## Kaynak ve lisans

OpenStreetMap / Overpass API. Veri ODbL lisanslıdır — üretilen dosyanın
başında kaynak belirtilir.

## Yöntem

Her ilçe için ayrı Overpass sorgusu atılır (`admin_level=6` ilçe alanı içinde
`place=neighbourhood|quarter|suburb` düğümleri). İlçe ilçe gitmenin sebebi:
mahalleyi ilçesine bağlamak. Tek sorguda il genelinden çekilseydi her mahallenin
hangi ilçede olduğunu ayrıca nokta-poligon testiyle bulmak gerekirdi.

Overpass ortak ve ücretsiz bir kaynak: sorgular arasında bekleme vardır ve
sonuçlar `scripts/out/` altına ham olarak da yazılır, böylece TS dosyasını
yeniden üretmek için tekrar ağ çağrısı gerekmez.

## Kullanım

    python scripts/fetch_adana_mahalleler.py            # çek + TS üret
    python scripts/fetch_adana_mahalleler.py --onbellek # ham JSON'dan üret
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

KOK = Path(__file__).resolve().parents[1]
HAM_JSON = KOK / "scripts" / "out" / "adana_mahalleler_ham.json"
TS_CIKTI = KOK / "frontend" / "src" / "lib" / "adanaYerler.ts"

OVERPASS = "https://overpass-api.de/api/interpreter"

# Adana'nın 15 ilçesi. `backend/scripts/ilce_backfill.py` ile AYNI küme.
ILCELER = (
    "Seyhan",
    "Çukurova",
    "Yüreğir",
    "Sarıçam",
    "Ceyhan",
    "Kozan",
    "Karaisalı",
    "Karataş",
    "Yumurtalık",
    "İmamoğlu",
    "Pozantı",
    "Aladağ",
    "Feke",
    "Saimbeyli",
    "Tufanbeyli",
)

SORGU = """[out:json][timeout:120];
area["name"="{ilce}"]["admin_level"="6"]->.a;
node["place"~"^(neighbourhood|quarter|suburb)$"]["name"](area.a);
out center;
"""


def _cek(ilce: str, deneme: int = 3) -> list[dict]:
    """Overpass ortak ve kotalı bir kaynak: 429/504 BEKLENEN durumlardır.

    İlk turda ilçelerin yarısı kotaya takıldı. Çözüm sabırdır — her denemede
    bekleme artar (10s, 25s, 40s). Yeniden denemeden vazgeçilirse Çukurova ve
    Sarıçam gibi en yoğun ilçeler veri setinden eksik kalır.
    """
    veri = SORGU.format(ilce=ilce).encode("utf-8")
    son_hata: Exception | None = None
    for tur in range(deneme):
        if tur:
            bekle = 10 + tur * 15
            print(f"(yeniden deneme {tur + 1}, {bekle}s bekliyor)", end=" ", flush=True)
            time.sleep(bekle)
        istek = urllib.request.Request(
            OVERPASS,
            data=veri,
            headers={"User-Agent": "adana-ozel-ders/1.0 (tek seferlik veri cekimi)"},
        )
        try:
            with urllib.request.urlopen(istek, timeout=180) as y:
                return json.load(y).get("elements", [])
        except Exception as hata:
            son_hata = hata
    raise son_hata if son_hata else RuntimeError("bilinmeyen")


def cek_hepsi(yalniz_eksikler: bool = False) -> dict[str, list[dict]]:
    # Daha önce çekilenler korunur; yalnız boş kalan ilçeler yeniden denenir.
    sonuc: dict[str, list[dict]] = {}
    if HAM_JSON.exists():
        sonuc = json.loads(HAM_JSON.read_text(encoding="utf-8"))

    hedef = [i for i in ILCELER if not sonuc.get(i)] if yalniz_eksikler else list(ILCELER)
    if not hedef:
        print("Eksik ilçe yok.")
        return sonuc

    for i, ilce in enumerate(hedef, 1):
        print(f"[{i}/{len(hedef)}] {ilce} ...", end=" ", flush=True)
        try:
            ogeler = _cek(ilce)
        except Exception as hata:  # ağ/kota — o ilçe boş geçilir, betik ölmez
            print(f"HATA: {hata}")
            sonuc.setdefault(ilce, [])
            continue
        sonuc[ilce] = ogeler
        print(f"{len(ogeler)} mahalle")
        if i < len(hedef):
            time.sleep(8)  # ortak kaynağa nazik davran
    HAM_JSON.parent.mkdir(parents=True, exist_ok=True)
    HAM_JSON.write_text(
        json.dumps(sonuc, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\nHam veri: {HAM_JSON}")
    return sonuc


def _duzelt(ad: str) -> str:
    """OSM adlarındaki yaygın gürültüyü temizler."""
    ad = unicodedata.normalize("NFC", ad).strip()
    # "X Mahallesi" / "X Mah." → "X". Ad zaten mahalle listesinde; sonek
    # arama kutusunda her satırı uzatır ve yazarken eşleşmeyi zorlaştırır.
    for sonek in (" Mahallesi", " Mahalesi", " Mah.", " Mah"):
        if ad.endswith(sonek):
            ad = ad[: -len(sonek)].strip()
    return ad


def uret(ham: dict[str, list[dict]]) -> str:
    kayitlar: list[tuple[str, str, float, float]] = []
    gorulen: set[tuple[str, str]] = set()
    for ilce, ogeler in ham.items():
        for o in ogeler:
            ad = _duzelt((o.get("tags") or {}).get("name") or "")
            lat = o.get("lat") or (o.get("center") or {}).get("lat")
            lng = o.get("lon") or (o.get("center") or {}).get("lon")
            if not ad or lat is None or lng is None:
                continue
            anahtar = (ilce, ad)
            if anahtar in gorulen:
                continue
            gorulen.add(anahtar)
            kayitlar.append((ilce, ad, round(float(lat), 5), round(float(lng), 5)))

    kayitlar.sort(key=lambda k: (k[0], k[1]))
    satirlar = "\n".join(
        f'  {{ ilce: "{ilce}", mahalle: "{ad}", lat: {lat}, lng: {lng} }},'
        for ilce, ad, lat, lng in kayitlar
    )
    ilce_sayilari = {}
    for ilce, *_ in kayitlar:
        ilce_sayilari[ilce] = ilce_sayilari.get(ilce, 0) + 1
    dagilim = ", ".join(f"{k} {v}" for k, v in sorted(ilce_sayilari.items()))

    return f'''// ÜRETİLMİŞ DOSYA — elle düzenlemeyin.
// Üreten: scripts/fetch_adana_mahalleler.py
// Kaynak: OpenStreetMap (Overpass API), ODbL lisanslı.
//
// Adana'nın mahalleleri, arama kutusundaki konum önerileri için. Site çalışırken
// hiçbir dış servise gidilmez; bu liste statiktir ve yalnız elle tazelenir.
//
// Toplam {len(kayitlar)} mahalle. İlçe dağılımı: {dagilim}.

export interface AdanaYer {{
  ilce: string;
  mahalle: string;
  /** Mahalle merkezi — arama YARIÇAPININ çapası. */
  lat: number;
  lng: number;
}}

export const ADANA_YERLER: readonly AdanaYer[] = [
{satirlar}
];
'''


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--eksikler",
        action="store_true",
        help="Yalnız ham veride boş kalan ilçeleri yeniden dene (mevcutları korur).",
    )
    ap.add_argument(
        "--onbellek",
        action="store_true",
        help="Ağa çıkma; daha önce çekilmiş ham JSON'dan TS dosyasını üret.",
    )
    args = ap.parse_args()

    if args.onbellek:
        if not HAM_JSON.exists():
            sys.exit(f"Ham veri yok: {HAM_JSON}. Önce önbelleksiz çalıştırın.")
        ham = json.loads(HAM_JSON.read_text(encoding="utf-8"))
    else:
        ham = cek_hepsi(yalniz_eksikler=args.eksikler)

    icerik = uret(ham)
    TS_CIKTI.write_text(icerik, encoding="utf-8")
    adet = icerik.count("{ ilce:")
    print(f"Yazıldı: {TS_CIKTI}  ({adet} mahalle)")


if __name__ == "__main__":
    main()
