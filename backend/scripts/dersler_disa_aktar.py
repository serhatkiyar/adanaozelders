# -*- coding: utf-8 -*-
"""Superprof HAR kaydından ders taksonomisi anlık görüntüsü üretir.

NE YAPAR: kullanıcının kendi tarayıcı oturumundan alınmış HAR dosyasındaki
`/api/v3/subjects/` yanıtını okur, süzer, temizler ve **bizim** şemamıza
çevirip `backend/data/dersler_v1.json` üretir. Canlı siteye HİÇBİR istek atmaz.

NE ALMAZ: kaynağın iç kimlikleri, ilan sayıları (`ads_count`), "trending"
sıralaması, CDN görsel adresleri, Fransızca dilbilgisi alanları
(`partitive_article`/`definite_article`/`dative`), `txt_ann_spe`,
`lang_group_id`. Bunlar bizim için değersiz ve bire bir kopyayı andırır.

ÜRETİLEN DOSYA DEPOYA GİRER, HAR GİRMEZ: ham kayıt 11 MB'lık üçüncü taraf
yükü ve kişisel oturum izleri taşır (`backend/scripts/data/` zaten
.gitignore'da). Depoya giren, gözden geçirilebilir türetilmiş listedir —
`docs/data/adana-kitap-toptancilari/build.mjs` ile aynı yaklaşım: üretme
reçetesi ve çıktısı git'te, ham girdi değil.

Kullanım:
    python scripts/dersler_disa_aktar.py --har "C:/.../superprof.har"
    python scripts/dersler_disa_aktar.py --json backend/scripts/data/subjects.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.search_text import normalize_tr  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
VARSAYILAN_CIKTI = BACKEND / "data" / "dersler_v1.json"
ORTU = BACKEND / "data" / "ders_eklemeleri.json"

#: Alınacak kullanım türleri. Saf "Hobi" (rugby, curling, video oyunları,
#: moleküler yemek...) Adana'da özel ders talebi değil; elenmesi ürün kararıdır.
TUTULAN_KULLANIM = {"Okul dersi", "Mesleki eğitim", "Konservatuvar"}

#: Kaynağın kategori id'si -> bizim grup kodumuz. Süzülen kümede yalnız bu beş
#: kategori görülüyor (10=Spor, 11=Sanat, 13=Sağlık tamamen hobi tarafında).
#: Haritada olmayan bir id çıkarsa betik DURUR — sessizce varsayılana düşmek,
#: yanlış gruplanmış yüzlerce dersi fark edilmeden yüklemek demektir.
GRUP_HARITASI = {"1": "OKUL", "5": "DIL", "8": "BILISIM", "9": "MUZIK", "14": "KOCLUK"}

#: Kaynaktaki yazım hataları. Kullanılmayan anahtar UYARI üretir; aksi hâlde
#: ölü düzeltme sözlüğü birikir ve kimse hangisinin geçerli olduğunu bilmez.
DUZELTMELER = {
    "Portekkizce çeviri": "Portekizce çeviri",
}

#: "İngilizce aksan", "Almanca çeviri" gibi dil alt-becerileri. Ayrı ders
#: yapılmaz — kimse "Almanca aksan dersi" aramaz; ana dilin ALIAS'ı olurlar,
#: böylece arama isabeti korunur ama seçici 68 kalem şişmez.
DIL_ALT_BECERI = re.compile(
    r"\s+(çeviri|aksan|kelime bilgisi|sözcük bilgisi|duyduğunu anlama|"
    r"okuduğunu anlama|konuşma becerileri|yazma becerileri|dil bilgisi)\s*$",
    re.IGNORECASE,
)

#: Kaynağın alias'ları gerçek kullanıcı aramalarıdır ve içlerinde ŞEHİR adı
#: geçenler bize yaramaz: platform Adana'ya özeldir, "ingilizce ankara" bir
#: eşanlamlı değil başka bir şehrin talebidir. "en iyi" gibi pazarlama parçaları
#: da atılır. Buna karşılık "gitar dersi" / "matematik ogretmeni" KALIR — insanlar
#: gerçekten böyle arıyor.
ALIAS_GURULTU = re.compile(
    r"\b(istanbul|ankara|izmir|bursa|antalya|konya|adana|mersin|kartal|kadikoy|"
    r"besiktas|uskudar|en iyi)\b"
)

#: Grup -> seviye merdiveni. Yalnız BAŞLANGIÇ değeridir; sonrası admin verisidir.
GRUP_MERDIVEN = {
    "OKUL": ["OKUL"],
    "SINAV": ["OKUL"],
    "DIL": ["OKUL", "CEFR"],
    "BILISIM": ["SANAT"],
    "MUZIK": ["KONSERVATUVAR", "SANAT"],
    "SANAT": ["SANAT"],
    "SPOR": ["SANAT"],
    "KOCLUK": ["SANAT"],
}


def slugify(ad: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize_tr(ad)).strip("-")[:160]


def _kaynak_oku(har: Path | None, jsn: Path | None) -> list[dict]:
    if jsn:
        return json.loads(jsn.read_text(encoding="utf-8"))["data"]
    veri = json.loads(har.read_text(encoding="utf-8"))
    for giris in veri["log"]["entries"]:
        if "/api/v3/subjects/" in giris["request"]["url"]:
            govde = (giris["response"].get("content") or {}).get("text") or ""
            if govde:
                return json.loads(govde)["data"]
    raise SystemExit("HAR içinde /api/v3/subjects/ yanıtı bulunamadı.")


def _kullanim(kayit: dict) -> set[str]:
    return {p.get("name") for p in (kayit.get("related") or {}).get("proceedings") or []}


def _ham_aliaslar(kayit: dict) -> list[str]:
    cikti: list[str] = []
    for a in kayit.get("aliases") or []:
        for p in a if isinstance(a, list) else [a]:
            ad = p.get("name") if isinstance(p, dict) else p
            if isinstance(ad, str) and ad.strip():
                cikti.append(ad.strip())
    return cikti


def donustur(ham: list[dict]) -> tuple[list[dict], list[str]]:
    """(dersler, rapor satırları) döner. Saf fonksiyon: DB'ye dokunmaz."""
    rapor: list[str] = []
    kullanilan_duzeltme: set[str] = set()

    def ad_temizle(ad: str) -> str:
        ad = ad.strip()
        if ad in DUZELTMELER:
            kullanilan_duzeltme.add(ad)
            return DUZELTMELER[ad]
        return ad

    byid = {k["id"]: k for k in ham}
    secilen = [k for k in ham if _kullanim(k) & TUTULAN_KULLANIM]
    secid = {k["id"] for k in secilen}

    # 1) Dil alt-becerileri -> ana dersin alias'ı
    ek_alias: dict[str, list[str]] = {}
    govde: list[dict] = []
    for k in secilen:
        ad = ad_temizle(k["name"])
        ust = k.get("parent_id")
        if DIL_ALT_BECERI.search(ad) and ust and ust in secid:
            ek_alias.setdefault(ust, []).append(ad)
            rapor.append("ALT_BECERI_ALIAS\t%s\t-> %s" % (ad, byid[ust]["name"]))
            continue
        govde.append(k)

    # 2) Grup + slug + yetim terfisi
    dersler: dict[str, dict] = {}
    slug_sahibi: dict[str, str] = {}
    for k in govde:
        ad = ad_temizle(k["name"])
        kat = ((k.get("related") or {}).get("category") or {}).get("id")
        grup = GRUP_HARITASI.get(kat)
        if grup is None:
            raise SystemExit(
                "Bilinmeyen kategori id=%r (%s). GRUP_HARITASI güncellenmeli — "
                "varsayılana düşmek yanlış gruplanmış dersleri sessizce yükler." % (kat, ad)
            )
        ust_id = k.get("parent_id")
        if ust_id and ust_id != "0" and ust_id not in secid:
            rapor.append("KOKE_ALINDI\t%s\t(ebeveyn %s süzgeçte kaldı)" % (ad, ust_id))
            ust_id = "0"

        slug = slugify(ad)
        if slug in slug_sahibi:
            ust_ad = byid.get(k.get("parent_id"), {}).get("name", "")
            aday = slugify("%s %s" % (ust_ad, ad)) if ust_ad else slug + "-2"
            n = 2
            while aday in slug_sahibi:
                aday = "%s-%d" % (slug, n)
                n += 1
            rapor.append("SLUG_CAKISMA\t%s\t%s -> %s" % (ad, slug, aday))
            slug = aday
        slug_sahibi[slug] = k["id"]

        dersler[k["id"]] = {
            "slug": slug,
            "ad": ad,
            "_ust": None if ust_id in (None, "0") else ust_id,
            "grup": grup,
            "_kullanim": sorted(_kullanim(k) & TUTULAN_KULLANIM),
            "_alias": _ham_aliaslar(k) + ek_alias.get(k["id"], []),
        }

    for d in dersler.values():
        uid = d.pop("_ust")
        d["ust_slug"] = dersler[uid]["slug"] if uid in dersler else None

    # 3) Merdivenler + alias normalizasyonu (global tekillik)
    global_alias: dict[str, str] = {}
    cikti: list[dict] = []
    for d in sorted(dersler.values(), key=lambda x: (x["grup"], x["ad"])):
        merdiven = list(GRUP_MERDIVEN[d["grup"]])
        if "Konservatuvar" in d["_kullanim"] and "KONSERVATUVAR" not in merdiven:
            merdiven.append("KONSERVATUVAR")
        if "Okul dersi" in d["_kullanim"] and "OKUL" not in merdiven:
            merdiven.insert(0, "OKUL")

        temiz: list[str] = []
        for a in d.pop("_alias"):
            n = normalize_tr(a)
            if not n or n == normalize_tr(d["ad"]):
                continue
            if ALIAS_GURULTU.search(n):
                rapor.append("ALIAS_GURULTU	%s	(şehir/pazarlama parçası)" % a)
                continue
            sahip = global_alias.get(n)
            if sahip and sahip != d["slug"]:
                rapor.append(
                    "ALIAS_CAKISMA\t%s\t%s <-> %s (ATLANDI)" % (a, sahip, d["slug"])
                )
                continue
            global_alias[n] = d["slug"]
            if n not in temiz:
                temiz.append(n)

        d.pop("_kullanim")
        d["merdivenler"] = merdiven
        d["aliaslar"] = temiz
        cikti.append(d)

    for anahtar in DUZELTMELER:
        if anahtar not in kullanilan_duzeltme:
            rapor.append("OLU_DUZELTME\t%s\t(kaynakta yok — sözlükten sil)" % anahtar)

    return cikti, rapor


def ortuyu_birlestir(dersler: list[dict], rapor: list[str]) -> list[dict]:
    """Kendi küratörlü listemizi üstüne bindirir.

    Çakışmada ÖRTÜ KAZANIR: `fen` alias'ı bizim `Fen Bilimleri` dersimize
    aittir, çünkü bugün `tutor_subjects`'te yazılı olan değer odur.
    """
    ortu = json.loads(ORTU.read_text(encoding="utf-8"))["dersler"]
    slug_ile = {d["slug"]: d for d in dersler}
    global_alias = {a: d["slug"] for d in dersler for a in d["aliaslar"]}

    for k in ortu:
        slug = slugify(k["ad"])
        hedef = slug_ile.get(slug)
        if hedef is None:
            hedef = {
                "slug": slug,
                "ad": k["ad"],
                "ust_slug": None,
                "grup": k["grup"],
                "merdivenler": list(GRUP_MERDIVEN[k["grup"]]),
                "aliaslar": [],
            }
            slug_ile[slug] = hedef
            dersler.append(hedef)
            rapor.append("ORTUDEN_EKLENDI\t%s\t%s" % (k["ad"], slug))
        else:
            # Küratörlü ad ve grup KAZANIR: kaynağın "Fen bilimleri" yazımı
            # yerine bizim "Fen Bilimleri"miz gösterilir.
            if hedef["ad"] != k["ad"]:
                rapor.append("ORTU_ADI\t%s\t%s -> %s" % (slug, hedef["ad"], k["ad"]))
                hedef["ad"] = k["ad"]
            if hedef["grup"] != k["grup"]:
                rapor.append("ORTU_GRUBU\t%s\t%s -> %s" % (slug, hedef["grup"], k["grup"]))
                hedef["grup"] = k["grup"]
                hedef["merdivenler"] = list(GRUP_MERDIVEN[k["grup"]])
        for a in k.get("aliaslar", []):
            n = normalize_tr(a)
            sahip = global_alias.get(n)
            if sahip and sahip != slug:
                rapor.append("ALIAS_TASINDI\t%s\t%s -> %s" % (a, sahip, slug))
                oteki = slug_ile[sahip]
                oteki["aliaslar"] = [x for x in oteki["aliaslar"] if x != n]
            global_alias[n] = slug
            if n not in hedef["aliaslar"]:
                hedef["aliaslar"].append(n)
    return dersler


def main() -> None:
    ap = argparse.ArgumentParser(description="Ders taksonomisi anlık görüntüsü üretir.")
    ap.add_argument("--har", type=Path, help="Kaynak HAR dosyası")
    ap.add_argument("--json", type=Path, help="Doğrudan subjects JSON yanıtı")
    ap.add_argument("--cikti", type=Path, default=VARSAYILAN_CIKTI)
    a = ap.parse_args()
    if not a.har and not a.json:
        ap.error("--har veya --json ver.")

    dersler, rapor = donustur(_kaynak_oku(a.har, a.json))
    kaynak_sayi = len(dersler)
    dersler = ortuyu_birlestir(dersler, rapor)
    dersler.sort(key=lambda d: (d["grup"], d["ad"]))

    a.cikti.parent.mkdir(parents=True, exist_ok=True)
    a.cikti.write_text(
        json.dumps(
            {
                "_aciklama": (
                    "Türetilmiş ders taksonomisi. Kaynak: Superprof TR HAR kaydı "
                    "(süzülmüş + temizlenmiş) + backend/data/ders_eklemeleri.json. "
                    "Üreten: scripts/dersler_disa_aktar.py — elle düzenleme, betiği koş."
                ),
                "dersler": dersler,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    sayac: dict[str, int] = {}
    for satir in rapor:
        anahtar = satir.split("\t")[0]
        sayac[anahtar] = sayac.get(anahtar, 0) + 1
    print("kaynaktan: %d | örtüyle toplam: %d" % (kaynak_sayi, len(dersler)))
    print(
        "kök: %d | alt: %d | alias: %d"
        % (
            sum(1 for d in dersler if not d["ust_slug"]),
            sum(1 for d in dersler if d["ust_slug"]),
            sum(len(d["aliaslar"]) for d in dersler),
        )
    )
    for k in sorted(sayac):
        print("  %s: %d" % (k, sayac[k]))
    print("yazıldı: %s" % a.cikti)
    for satir in rapor:
        if satir.startswith(("OLU_DUZELTME", "ALIAS_CAKISMA")):
            print("  ! " + satir.replace("\t", " "))


if __name__ == "__main__":
    main()
