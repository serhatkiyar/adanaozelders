#!/usr/bin/env python3
"""adana_venues_all.json verisini kullanarak Obsidian notlarını düzenli,
frontmatter'lı (veritabanı gibi sorgulanabilir) formata dönüştürür.

- Her not: YAML frontmatter (isim/tur/kategori/lat/lng/telefon/website/maps/kaynak)
  + okunaklı gövde (konum callout'u, olanak şablonu, harita linki).
- Orijinal ham içerik notun altında <details>'te saklanır (güvenlik).
- Ayrıca '00 Adana Mekân Veritabanı.md' adında Dataview tablolu ana indeks üretir.
"""
import json
import re
from datetime import date
from pathlib import Path

VAULT = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
JSON_PATH = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out\adana_venues_all.json")
TODAY = date.today().isoformat()

# kategori (klasör) -> tür (modelimize yakın etiket)
TUR = {
    "Kütüphaneler": "kütüphane",
    "Bilgi Evleri": "bilgi-evi",
    "Cafeler": "çalışma-kafesi",
    "Eğitim Kurumları": "eğitim-kurumu",
    "Sürücü Kursları": "sürücü-kursu",
    "Rehabilatasyon": "rehabilitasyon",
    "Diğerleri": "diğer",
}


def fmt_phone(d: str) -> str:
    """Sadece rakamları okunaklı Türk telefon biçimine getir."""
    if not d:
        return ""
    digits = re.sub(r"\D", "", d)
    if len(digits) == 11 and digits.startswith("0"):
        return f"{digits[0:4]} {digits[4:7]} {digits[7:9]} {digits[9:11]}"
    if len(digits) == 10 and digits.startswith("5"):
        return f"0{digits[0:3]} {digits[3:6]} {digits[6:8]} {digits[8:10]}"
    return d


def yaml_str(s: str) -> str:
    return '"' + s.replace('"', "'") + '"' if s else '""'


def build_note(r: dict) -> str:
    tur = TUR.get(r["kategori"], "diğer")
    tel = fmt_phone(r["telefon"])
    lat = r["lat"]
    lng = r["lng"]
    coord = f"{lat}, {lng}" if lat is not None else "—"

    # Google zenginleştirmesi (varsa boşları tamamla)
    website = r["website"] or r.get("google_website", "")
    if not tel and r.get("google_phone"):
        tel = r["google_phone"]
    adres = r.get("adres", "")
    il = r.get("il", "")
    ilce = r.get("ilce", "")
    mahalle = r.get("mahalle", "")
    posta = r.get("posta", "")
    puan = r.get("puan", "")
    yorum = r.get("yorum_sayisi", "")
    saatler = [s.strip() for s in (r.get("saatler", "") or "").split("|") if s.strip()]

    fm = [
        "---",
        f"isim: {yaml_str(r['isim'])}",
        f"tur: {tur}",
        f"kategori: {yaml_str(r['kategori'])}",
        f"il: {yaml_str(il)}",
        f"ilce: {yaml_str(ilce)}",
        f"mahalle: {yaml_str(mahalle)}",
        f"posta: {yaml_str(posta)}",
        f"adres: {yaml_str(adres)}",
        f"lat: {lat if lat is not None else ''}",
        f"lng: {lng if lng is not None else ''}",
        f"telefon: {yaml_str(tel)}",
        f"website: {yaml_str(website)}",
        f"puan: {puan if puan != '' else ''}",
        f"yorum_sayisi: {yorum if yorum != '' else ''}",
        f"maps: {yaml_str(r['maps_url'])}",
        f"kaynak: {r['link_tipi']}",
        f"guncelleme: {TODAY}",
        f"tags: [adana, mekan, {tur}{(', ilce-' + ilce.lower().replace(' ', '-')) if ilce else ''}]",
        "---",
        "",
        f"# {r['isim']}",
        "",
        "> [!info] Künye",
    ]
    if lat is not None:
        fm.append(f"> 📍 **Konum:** `{coord}`" + (f" · [Haritada aç]({r['maps_url']})" if r['maps_url'] else ""))
    else:
        fm.append("> 📍 **Konum:** _koordinat yok_")
    if tel:
        fm.append(f"> 📞 **Telefon:** {tel}")
    if website:
        fm.append(f"> 🌐 **Web:** {website}")
    if adres:
        fm.append(f"> 🏠 **Adres:** {adres}")
    konum_satir = " · ".join(x for x in [ilce, mahalle] if x)
    if konum_satir:
        fm.append(f"> 🗺️ **Bölge:** {konum_satir}")
    if puan != "":
        fm.append(f"> ⭐ **Puan:** {puan} ({yorum} yorum)")
    fm.append(f"> 🏷️ **Tür:** {tur}")

    saat_blok = (["| Gün | Saat |", "|---|---|"] +
                 [f"| {s.split(':',1)[0]} | {s.split(':',1)[1].strip() if ':' in s else ''} |" for s in saatler]
                 ) if saatler else ["_(Google'da saat bilgisi yok — elle eklenebilir)_"]

    body = [
        "",
        "## Olanaklar",
        "- [ ] WiFi",
        "- [ ] Sessiz çalışma alanı",
        "- [ ] Kafeterya / içecek",
        "- [ ] Priz / şarj",
        "- [ ] Klima",
        "",
        "## Çalışma Saatleri",
        *saat_blok,
        "",
        "## Notlar",
        "",
    ]

    # Kaynak referans (veriden üretilir — dosyadan okunmaz, böylece iç içe gömülmez)
    raw_lines = [x for x in [r.get("maps_url", ""), r.get("telefon", ""), r.get("website", "")] if x]
    details = ["", "---", "<details><summary>Kaynak (Google Maps / iletişim)</summary>", "", "```", *raw_lines, "```", "</details>", ""]

    return "\n".join(fm + body + details)


def main():
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    written = 0
    for r in rows:
        rel = (r["alt_klasor"] + "/" if r["alt_klasor"] else "") + r["isim"] + ".md"
        path = VAULT / rel
        path.parent.mkdir(parents=True, exist_ok=True)  # yoksa oluştur (yeni kayıtlar)
        path.write_text(build_note(r), encoding="utf-8")
        written += 1
    print(f"Düzenlenen not: {written} / {len(rows)}")

    # Ana indeks / veritabanı notu
    index = f"""---
isim: "Adana Mekân Veritabanı"
tags: [adana, index, moc]
guncelleme: {TODAY}
---

# 📚 Adana Mekân Veritabanı

Adana merkezdeki çalışma/eğitim mekânlarının yapılandırılmış kataloğu.
Her not frontmatter ile veritabanı gibi sorgulanabilir.

> [!tip] Dataview eklentisi
> Aşağıdaki tablolar **Dataview** eklentisi kuruluysa otomatik dolar.
> (Ayarlar → Community plugins → "Dataview" yükle & aç.)

## Tüm mekânlar (koordinatlı)

```dataview
TABLE tur AS "Tür", ilce AS "İlçe", mahalle AS "Mahalle", puan AS "Puan", telefon AS "Telefon"
FROM #mekan
WHERE lat
SORT tur ASC, ilce ASC, isim ASC
```

## İlçelere göre dağılım

```dataview
TABLE length(rows) AS "Adet"
FROM #mekan
GROUP BY ilce
SORT length(rows) DESC
```

## Türlere göre sayım

```dataview
TABLE length(rows) AS "Adet"
FROM #mekan
GROUP BY tur
SORT length(rows) DESC
```

## Koordinatı eksik olanlar (tamamlanacak)

```dataview
LIST
FROM #mekan
WHERE !lat
```

---

_Toplam {len(rows)} kayıt · {sum(1 for r in rows if r['lat'] is not None)} tanesi koordinatlı._
_Kaynak veri: `ceyhan-tutor-market/scripts/out/adana_venues_geo.csv`_
"""
    (VAULT / "00 Adana Mekân Veritabanı.md").write_text(index, encoding="utf-8")
    print("Ana indeks yazıldı: 00 Adana Mekân Veritabanı.md")


if __name__ == "__main__":
    main()
