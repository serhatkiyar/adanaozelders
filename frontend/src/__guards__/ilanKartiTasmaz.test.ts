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
 * GİRİŞLİ kabukta, kartın gerçek yüksekliği ölçüldü (e-posta doğrulama
 * şeridi dahil, yani en kötü hâl):
 *
 *   önce   1366x768 → kart 632px, altı 788  TAŞIYOR
 *          1280x720 → kart 608px, altı 764  TAŞIYOR
 *          1100x700 → kart 588px, altı 744  TAŞIYOR
 *
 *   sonra  1366x768 → kart 516px, altı 672  taşmıyor
 *          1280x720 → kart 516px, altı 672  taşmıyor
 *
 ## Bu nöbetçinin ASIL dersi: rotanın İKİ kabuğu var
 *
 * İlk yazımda yalnız `PublicTutorProfile` çıpalanmıştı ve nöbetçi YEŞİL
 * geçiyordu — ama kusur ekranda duruyordu. Sebep: `/egitmenler/:slug`
 * rotası `TutorProfilePage` dağıtıcısına gidiyor ve oturuma göre AYRI bir
 * bileşen basıyor:
 *
 *     anonim   → PublicTutorProfile
 *     girişli  → TutorProfile
 *
 * Düzeltme birine uygulanıp diğeri unutulmuştu; anonim tarayıcıyla yapılan
 * doğrulama da o yüzden "düzeldi" diyordu. Artık liste İKİSİNİ de kapsıyor
 * ve dağıtıcının iki dalı da ayrıca çıpalı: üçüncü bir kabuk eklenirse
 * (ya da biri listeden düşerse) bu düğüm kırılır.
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
/** Rotanın İKİ kabuğu — dağıtıcı oturuma göre birini basar. */
const KABUKLAR = ["PublicTutorProfile.tsx", "TutorProfile.tsx"] as const;

const oku = (ad: string) =>
  readFileSync(join(KOK, "src", "pages", ad), "utf8");

const DAGITICI = oku("TutorProfilePage.tsx");

/** `<aside ... className="...">` içindeki sınıf dizesi. */
function asideSinifi(kaynak: string): string {
  const i = kaynak.indexOf("<aside");
  if (i < 0) return "";
  const j = kaynak.indexOf('className="', i);
  return j < 0 ? "" : kaynak.slice(j + 11, kaynak.indexOf('"', j + 11));
}

/** Yorumları eleyen kod metni: "KALDIRILDI" notu TARİHtir, borç değil. */
function yorumsuz(kaynak: string): string {
  return kaynak
    .split(new RegExp(String.raw`
?
`))
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
}

describe("ilan sayfası · sabit kart", () => {
  it("DOLULUK: her iki kabuk ve sabit kartı gerçekten bulundu", () => {
    // Boş bir dize "içermiyor" iddialarını bedava geçirirdi.
    for (const ad of KABUKLAR) {
      const kaynak = oku(ad);
      expect(kaynak.length, `${ad} okunamadı`).toBeGreaterThan(2000);
      expect(asideSinifi(kaynak).length, `${ad} sabit kart yok`).toBeGreaterThan(20);
    }
  });

  it("dağıtıcı GERÇEKTEN iki kabuk basıyor (liste bayatlarsa kırılır)", () => {
    // Kaçırılan kusurun kökü buydu: rotanın iki dalı var ve düzeltme
    // yalnız birine uygulanmıştı.
    expect(DAGITICI).toContain("PublicTutorProfile");
    expect(DAGITICI).toContain("TutorProfile");
    // Üçüncü bir kabuk eklenirse burası da güncellenmeli.
    const basilanlar = (DAGITICI.match(/<([A-Z][A-Za-z]*) \/>/g) ?? []).length;
    expect(basilanlar, "dağıtıcı ikiden fazla kabuk basıyor").toBe(2);
  });

  it.each(KABUKLAR)(
    "%s: kart sabit, YÜKSEKLİĞİ EKRANLA SINIRLI, gerekirse kendi içinde kayar",
    (ad) => {
      // Üçü birlikte anlamlı: `sticky` tek başına taşmayı üretir, `max-h` tek
      // başına içeriği kırpar, `overflow` tek başına bir şey yapmaz.
      const sinif = asideSinifi(oku(ad));
      expect(sinif, "sticky düştü").toContain("lg:sticky");
      expect(sinif, "yükseklik sınırı yok — kart yine taşar").toMatch(
        /lg:max-h-\[calc\(100vh-/
      );
      expect(sinif, "taşma davranışı tanımsız").toContain("lg:overflow-y-auto");
    }
  );

  it.each(KABUKLAR)("%s: üst boşluk ÖLÇÜLEN değerden gelir, sabit sayıdan değil", (ad) => {
    // 7 Eyl 2026'da sözleşme değişti. Önce `top-24` gibi SABİT bir sayı
    // vardı ve doğrulama şeridi açıkken yanlış oluyordu: kart 60 piksel
    // sürüklenip ancak ondan sonra sabitleniyordu. Artık kabuk (`--yapiskan-ust`)
    // başlık+şerit yığınının GERÇEK yüksekliğini ölçüp yayınlıyor.
    //
    // İkisi de AYNI değişkenden beslenmeli: biri sabit sayıya dönerse hiza
    // sessizce bozulur ve kusur geri gelir.
    const sinif = asideSinifi(oku(ad));
    const UST = "lg:top-[calc(var(--yapiskan-ust,6rem)+";
    const SINIR = "lg:max-h-[calc(100vh-var(--yapiskan-ust,6rem)-";
    expect(sinif, "üst boşluk ölçülen değere bağlı değil").toContain(UST);
    expect(sinif, "yükseklik sınırı ölçülen değere bağlı değil").toContain(SINIR);

    // Alt pay, üst boşluktan BÜYÜK olmalı: aksi hâlde kart ekranın dibine
    // yapışır ve son satırı kırpılır.
    const ustPay = Number(sinif.split(UST)[1].split("rem")[0]);
    const altPay = Number(sinif.split(SINIR)[1].split("rem")[0]);
    expect(altPay, "alt pay üst boşluktan küçük").toBeGreaterThan(ustPay);
  });

  it("kabuklar `--yapiskan-ust` değerini GERÇEKTEN yayınlıyor", () => {
    // Değişken yayınlanmazsa yedek değer (6rem) devreye girer ve şerit açıkken
    // hiza yine bozulur. İki kabuk da ölçüp yayınlamak ZORUNDA.
    for (const kabuk of ["DashboardShell.tsx", "PublicShell.tsx"]) {
      const kaynak = readFileSync(
        join(KOK, "src", "components", kabuk),
        "utf8"
      );
      expect(kaynak, `${kabuk} değişkeni yayınlamıyor`).toContain(
        '"--yapiskan-ust"'
      );
      expect(kaynak, `${kabuk} ölçüm yapmıyor`).toContain("ResizeObserver");
    }
  });

  it.each(KABUKLAR)("%s: kart Superprof deseninde KOMPAKT kalır", (ad) => {
    // Asıl kusur "sticky" değil UZUNLUKtu: kart 632 px'ti ve 1366x768,
    // 1280x720, 1100x700 ekranlarının üçünde de taşıyordu. Ücret ve güven
    // sinyalleri AYRI BLOKLAR hâlindeydi; tek etiket/değer tablosuna
    // indirilince 516 px'e düştü.
    //
    // Bu düğüm o kararı tutar: kart ücreti kendi büyük bloğunda TEKRAR
    // basmaya kalkarsa (ya da tablo bileşeni düşerse) kırılır.
    const kaynak = oku(ad);
    expect(kaynak, "özet tablosu kullanılmıyor").toContain("<TutorOzetTablosu");
    expect(kaynak, "ayrı ücret bloğu geri gelmiş").not.toContain("Saatlik ücret");
    expect(kaynak, "dikey güven çubuğu geri gelmiş").not.toContain(
      "<TutorTrustBar"
    );
    // Avatar da küçük kaldı: `xl` (128px) kartı tek başına 128 px şişiriyordu.
    expect(kaynak, "avatar yeniden xl olmuş").not.toMatch(/size="xl"/);
  });

  it.each(KABUKLAR)(
    "%s: 'Geri dön' ilan yüzeyinden KALKTI, yalnız hata dalında DURUYOR",
    (ad) => {
      // Kapsam çıpası. Hata dalında sayfanın tek çıkışı odur; oradan da
      // kaldırmak ölü uç üretirdi (ÜK-2'deki bildirim zili dersi).
      const kod = yorumsuz(oku(ad));
      expect(
        kod.split("Geri dön").length - 1,
        "beklenen: yalnız hata dalındaki tek kopya"
      ).toBe(1);
      const hataBasi = kod.indexOf("Eğitmen bulunamadı");
      const geriDonYeri = kod.indexOf("Geri dön");
      expect(hataBasi, "hata dalı bulunamadı").toBeGreaterThan(0);
      expect(Math.abs(hataBasi - geriDonYeri)).toBeLessThan(1500);
    }
  );
});
