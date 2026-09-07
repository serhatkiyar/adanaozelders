/**
 * Eğitmen ilan sayfası: sabit kart ekrandan taşmaz — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * *"Yandaki sticky eğitmen kartı ekranda tam gözükmüyor, ekrana göre sığması
 * gerekmez mi? Kartın tamamını görmek için sayfada en aşağı kaydırıyorum."*
 *
 * Kusur şuydu: kart `sticky top-24` idi ama yüksekliği SINIRSIZDI. Kart
 * viewport'tan uzun olduğunda alt kısmı (fiyat ve "Ders Talep Et" düğmesi)
 * ekranın dışında kalıyor ve sabitlendiği için sayfa kaydırılsa bile
 * gelmiyordu. Yani sayfanın en önemli düğmesi bazı ekranlarda görünmüyordu.
 *
 * Çözüm: kartın yüksekliği ekranla sınırlandı ve gerekirse KENDİ İÇİNDE
 * kayıyor. Kart kısa kaldığında hiçbir şey değişmez.
 *
 * Aynı turda "← Geri dön" bağlantısı da kaldırıldı: tarayıcının kendi geri
 * düğmesi zaten var ve bu satır kartı bir satır aşağı itiyordu.
 *
 * ## Gerçek Chrome ölçümü (kanıt)
 *
 *   ekran 620px → kart 508px, altı 611 (taşmıyor), kendi içinde KAYABİLİR
 *   ekran 768px → kart 620px, altı 723 (taşmıyor), kaymaya gerek YOK
 *   ekran 900px → kart 620px, altı 723 (taşmıyor), kaymaya gerek YOK
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir. jsdom düzen hesaplamaz; "kart ekrana sığıyor"
 * iddiasının davranış kanıtı yukarıdaki Chrome ölçümüdür. Buradaki iş, üç
 * sınıfın (sticky + yükseklik sınırı + taşma davranışı) BİRLİKTE durmasını
 * sağlamak: biri düşerse kusur sessizce geri gelir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);
const KAYNAK = readFileSync(
  join(KOK, "src", "pages", "PublicTutorProfile.tsx"),
  "utf8"
);

/** `<aside ... className="...">` içindeki sınıf dizesi. */
function asideSinifi(): string {
  const i = KAYNAK.indexOf("<aside");
  if (i < 0) return "";
  const j = KAYNAK.indexOf('className="', i);
  return j < 0 ? "" : KAYNAK.slice(j + 11, KAYNAK.indexOf('"', j + 11));
}

describe("ilan sayfası · sabit kart", () => {
  it("DOLULUK: sayfa ve sabit kart gerçekten bulundu", () => {
    // Boş bir dize aşağıdaki tüm `toContain` iddialarını çökertirdi ama
    // "içermiyor" iddialarını bedava geçirirdi.
    expect(KAYNAK.length).toBeGreaterThan(2000);
    expect(asideSinifi().length).toBeGreaterThan(20);
  });

  it("kart sabit, YÜKSEKLİĞİ EKRANLA SINIRLI ve gerekirse kendi içinde kayar", () => {
    // Üçü birlikte anlamlı: `sticky` tek başına taşmayı üretir, `max-h` tek
    // başına içeriği kırpar, `overflow` tek başına bir şey yapmaz.
    const sinif = asideSinifi();
    expect(sinif, "sticky düştü").toContain("lg:sticky");
    expect(sinif, "yükseklik sınırı yok — kart yine taşar").toMatch(
      /lg:max-h-\[calc\(100vh-/
    );
    expect(sinif, "taşma davranışı tanımsız").toContain("lg:overflow-y-auto");
  });

  it("kartın üst boşluğu ile yükseklik sınırı TUTARLI", () => {
    // `top-24` (6rem) ile başlayan kart `100vh - 7rem` ile sınırlıysa altta
    // 1rem pay kalır. Sınır üst boşluktan KÜÇÜK olursa kart yine taşar.
    const sinif = asideSinifi();
    const ust = sinif.match(/lg:top-(\d+)/);
    const sinir = sinif.match(/lg:max-h-\[calc\(100vh-(\d+)rem\)\]/);
    expect(ust, "üst boşluk okunamadı").toBeTruthy();
    expect(sinir, "yükseklik sınırı okunamadı").toBeTruthy();
    const ustRem = Number(ust![1]) / 4; // Tailwind ölçeği: 24 => 6rem
    expect(Number(sinir![1])).toBeGreaterThan(ustRem);
  });

  it("'Geri dön' ilan sayfasından KALKTI ama hata ekranında DURUYOR", () => {
    // Kapsam çıpası. Hata ekranında sayfanın tek çıkışı odur; oradan da
    // kaldırmak ölü uç üretirdi (ÜK-2'deki bildirim zili dersi).
    // Yorumlar elenir: "KALDIRILDI" notu ifadeyi anıyor ve o TARİHtir,
    // borç değil. (Aynı tuzağa bu oturumda bir kez düşüldü.)
    const kod = KAYNAK.split(new RegExp(String.raw`\r?\n`))
      .filter((satir) => {
        const k = satir.trim();
        return !(
          k.startsWith("//") ||
          k.startsWith("*") ||
          k.startsWith("/*") ||
          k.startsWith("{/*")
        );
      })
      .join(String.fromCharCode(10));
    const geriDonSayisi = kod.split("Geri dön").length - 1;
    expect(geriDonSayisi, "beklenen: yalnız hata ekranındaki tek kopya").toBe(1);

    // O tek kopya gerçekten HATA dalında mı: "Eğitmen bulunamadı" ile aynı
    // blokta olmalı.
    const hataBasi = kod.indexOf("Eğitmen bulunamadı");
    const geriDonYeri = kod.indexOf("Geri dön");
    expect(hataBasi, "hata dalı bulunamadı").toBeGreaterThan(0);
    expect(Math.abs(hataBasi - geriDonYeri)).toBeLessThan(1500);
  });
});
