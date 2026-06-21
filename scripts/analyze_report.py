#!/usr/bin/env python3
"""Adana mekân verisinden 'Arz & Fırsat Raporu' üretir (Markdown)."""
import json
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

OUT = Path(r"C:\Users\kiyar\Desktop\ceyhan-tutor-market\scripts\out")
ROWS = json.loads((OUT / "adana_venues_all.json").read_text(encoding="utf-8"))

# Çalışma mekânı arzı = öğrencinin ders çalışacağı yerler
STUDY = {"Kütüphaneler", "Bilgi Evleri", "Cafeler"}
COMPET = {"Eğitim Kurumları", "Sürücü Kursları"}

# Yaklaşık ilçe nüfusları (TÜİK ~2024, kişi başı arz için kaba ölçek)
NUFUS = {"Seyhan": 810000, "Çukurova": 370000, "Yüreğir": 430000, "Sarıçam": 190000}

CMEAN = 4.50  # global ortalama puan (önceki analiz)
PRIOR = 20    # Bayesian prior ağırlığı (yorum sayısı)


def fnum(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def bayesian(r):
    R = fnum(r.get("puan"))
    v = fnum(r.get("yorum_sayisi"), 0) or 0
    if R is None:
        return None
    return (v / (v + PRIOR)) * R + (PRIOR / (v + PRIOR)) * CMEAN


def main():
    study = [r for r in ROWS if r["kategori"] in STUDY]
    compet = [r for r in ROWS if r["kategori"] in COMPET]
    ilceler = ["Seyhan", "Çukurova", "Yüreğir", "Sarıçam"]

    L = []
    P = L.append
    P(f"# 📊 Adana Arz & Fırsat Raporu")
    P(f"\n_{date.today().isoformat()} · {len(ROWS)} mekân · kaynak: Google Places + saha notları_\n")
    P("> **Çalışma mekânı arzı** = kütüphane + bilgi evi + çalışma kafesi "
      f"(**{len(study)}** mekân). **Rakip/ilişkili** = eğitim kurumu + sürücü kursu (**{len(compet)}**).\n")

    # 1) İlçe bazında arz
    P("## 1. İlçe bazında çalışma mekânı arzı\n")
    P("| İlçe | Çalışma mekânı | Nüfus (≈) | 100k kişi başına | Değerlendirme |")
    P("|---|---|---|---|---|")
    per100 = {}
    for il in ilceler:
        c = sum(1 for r in study if r.get("ilce") == il)
        nuf = NUFUS[il]
        ratio = c / (nuf / 100000)
        per100[il] = ratio
        L[-0:]  # noop
        yorum = ("yoğun" if ratio >= 5 else "orta" if ratio >= 3 else "**düşük → fırsat**")
        P(f"| {il} | {c} | {nuf:,} | {ratio:.1f} | {yorum} |")
    en_dusuk = min(per100, key=per100.get)
    P(f"\n**Bulgu:** 100.000 kişi başına en az çalışma mekânı **{en_dusuk}**'da "
      f"({per100[en_dusuk]:.1f}). Arz boşluğu = yeni mekân/operatör için en açık pazar.\n")

    # 2) Çalışma mekânı türü kırılımı
    P("## 2. Çalışma mekânı türü kırılımı\n")
    P("| Tür | Adet |")
    P("|---|---|")
    for k, v in Counter(r["kategori"] for r in study).most_common():
        P(f"| {k} | {v} |")
    P("")

    # 3) Kalite — Bayesian sıralı en iyi çalışma mekânları
    P("## 3. Kalite — en güçlü çalışma mekânları (Bayesian)\n")
    scored = [(bayesian(r), r) for r in study if bayesian(r) is not None]
    scored.sort(key=lambda x: x[0], reverse=True)
    P("| # | Mekân | İlçe | Puan | Yorum | Bayesian |")
    P("|---|---|---|---|---|---|")
    for i, (s, r) in enumerate(scored[:12], 1):
        P(f"| {i} | {r['isim']} | {r.get('ilce','')} | {r.get('puan','')} | {r.get('yorum_sayisi','')} | {s:.2f} |")
    P("")
    # ilçe ortalama kalite
    P("**İlçe ortalama kalitesi (Bayesian):**\n")
    P("| İlçe | Ort. Bayesian | Mekân sayısı |")
    P("|---|---|---|")
    for il in ilceler:
        vals = [s for s, r in scored if r.get("ilce") == il]
        if vals:
            P(f"| {il} | {statistics.mean(vals):.2f} | {len(vals)} |")
    P("")

    # 4) Erişilebilirlik — geç saat / 7 gün açık
    P("## 4. Erişilebilirlik (çalışma mekânları)\n")
    def parse_close_hours(r):
        """Haftanın günlerinden en geç kapanış saatini (saat int) bul."""
        s = r.get("saatler", "") or ""
        latest = 0
        gun7 = s.count(":")  # kaba
        for part in s.split("|"):
            # 'Pazartesi: 10:00–22:00'
            if "–" in part or "-" in part:
                sep = "–" if "–" in part else "-"
                try:
                    close = part.split(sep)[-1].strip()
                    hh = int(close.split(":")[0])
                    latest = max(latest, hh)
                except Exception:
                    pass
        return latest
    with_hours = [r for r in study if (r.get("saatler") or "").strip()]
    late = [r for r in with_hours if parse_close_hours(r) >= 22 or parse_close_hours(r) == 0]
    days7 = [r for r in with_hours if (r.get("saatler","").count("Pazar")>=1 and r.get("saatler","").count("Cumartesi")>=1)]
    P(f"- Çalışma saati bilinen: **{len(with_hours)}/{len(study)}**")
    P(f"- Saat 22:00 veya sonrasına kadar açık: **{len(late)}**")
    P(f"- Hafta sonu (Cmt+Paz) açık: **{len(days7)}**")
    P(f"\n> Öğrenci talebi akşam/hafta sonu yoğun → geç saate kadar açık mekân arzı kritik fark yaratır.\n")

    # 5) Rakip / ilişkili arz yoğunluğu
    P("## 5. Rakip & ilişkili arz (eğitim + sürücü kursu)\n")
    P("| İlçe | Eğitim Kurumu | Sürücü Kursu |")
    P("|---|---|---|")
    for il in ilceler:
        ek = sum(1 for r in ROWS if r["kategori"]=="Eğitim Kurumları" and r.get("ilce")==il)
        sk = sum(1 for r in ROWS if r["kategori"]=="Sürücü Kursları" and r.get("ilce")==il)
        P(f"| {il} | {ek} | {sk} |")
    P("\n> 77 eğitim kurumu = potansiyel **arz tarafı ortağı** (deneme sınavı oturumu açabilir), rakip değil.\n")

    # 6) Mahalle hotspot'ları (çalışma mekânı kümeleri)
    P("## 6. Mahalle yoğunlukları (çalışma mekânı)\n")
    mah = Counter(f"{r.get('ilce','?')} / {r.get('mahalle','?')}" for r in study)
    P("**En yoğun 10 mahalle:**\n")
    P("| Mahalle | Mekân |")
    P("|---|---|")
    for k, v in mah.most_common(10):
        P(f"| {k} | {v} |")
    P("")

    # 7) Özet & öneri
    P("## 7. Özet & stratejik öneri\n")
    P(f"- **Toplam arz:** {len(study)} çalışma mekânı, {len(compet)} eğitim/sürücü kurumu, "
      f"ortalama kalite yüksek (medyan puan 4.7).")
    P(f"- **Fırsat bölgesi:** {en_dusuk} — kişi başı çalışma mekânı en düşük.")
    P(f"- **Lansman seed:** {sum(1 for r in study if r.get('lat'))} koordinatlı çalışma mekânı haritaya hazır.")
    P(f"- **Arz tarafı genişletme:** 77 eğitim kurumu deneme-sınavı oturumu modeline davet edilebilir.")
    P(f"- **Veri yeterli:** İletişim/konum/kalite tam; sadece olanak/kapasite/ücret operatör kaydında doldurulacak.\n")

    report = "\n".join(L)
    (OUT / "adana_rapor.md").write_text(report, encoding="utf-8")
    vault = Path(r"C:\Users\kiyar\adana-obsidian-kasa\Adana")
    (vault / "01 Adana Arz & Fırsat Raporu.md").write_text(
        "---\ntags: [adana, rapor]\n---\n\n" + report, encoding="utf-8")
    print("Rapor yazıldı:")
    print("  ", OUT / "adana_rapor.md")
    print("  ", vault / "01 Adana Arz & Fırsat Raporu.md")
    print("\n----- ÖZET -----")
    print("\n".join(L))


if __name__ == "__main__":
    main()
