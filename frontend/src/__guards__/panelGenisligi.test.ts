/**
 * PANEL GENİŞLİĞİ — adlandırılmış sınıf zorunluluğu (kullanıcı kararı, 8 Eyl 2026).
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Panel şeridinin altı sekmesinde BEŞ farklı içerik genişliği vardı ve hiçbiri
 * bir kurala bağlı değildi:
 *
 *   Pano 768 · Mesajlarım 1536 · İlanım 672 · Değerlendirmeler 768 ·
 *   Bakiyem 1024 · Hesabım 672
 *
 * ("Hesabım" aynı gün şeritten çıktı — bkz. `panoSeridi.test.tsx`.)
 *
 * Şerit ve üst bar sabit 1536 kalırken içerik sekme değiştikçe zıplıyordu; en
 * dar ile en geniş arasında 2.3 kat fark vardı. Kullanıcı: *"ilanım, ders
 * rezervasyonları falan gibi yerlerde sayfa genişliğinde bir standart yok gibi
 * görünüyor."*
 *
 * ## Neden "hepsi aynı olsun" DEĞİL
 *
 * Taranan altı tasarım sisteminin hiçbiri tek sabit genişlik dayatmıyor —
 * Atlassian üç grid (fixed-wide 1296 / fixed-narrow 864 / fluid), GitLab üç
 * genişlik (990 / 1280 / full), Wix "layout intents", Polaris `narrowWidth` ve
 * `fullWidth` prop'ları, GOV.UK 1020 + iki-bölü-üç metin sütunu. Farklı
 * genişlik meşrudur; ölçülen kusur farkın KURALSIZ olmasıdır.
 *
 * Bu yüzden test "aynı sayı" aramaz. Aradığı şey: **şeritteki her sayfa,
 * `DashboardShell`'in adlandırılmış genişlik sınıflarından birine ait mi.**
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Kaynak sözleşmesi: sayfanın `DashboardShell` çağrısında `genislik` prop'u
 * geçtiğini (ya da tam-genişlik için `flush` olduğunu) okur. Piksel ölçmez —
 * jsdom yerleşim hesaplamaz, `max-w-*` sınıfının gerçek genişliği ancak
 * tarayıcıda görülür. Karşılığında iddia sağlamdır: bir sayfa kendi kafasına
 * göre `max-w-4xl` yazamaz, çünkü sınıf listesi tek kaynaktan gelir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PANEL_GENISLIKLERI } from "@/components/DashboardShell";
import { TUTOR_PANO_SEKMELERI } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

const oku = (...parcalar: string[]) =>
  readFileSync(join(KOK, "src", ...parcalar), "utf8");

/** Şerit sekmesi → onu çizen sayfa dosyası. */
const SEKME_SAYFALARI: { rota: string; dosya: string[]; etiket: string }[] = [
  { rota: ROUTES.bookings, dosya: ["pages", "TutorDashboard.tsx"], etiket: "Pano" },
  { rota: ROUTES.messages, dosya: ["pages", "Messages.tsx"], etiket: "Mesajlarım" },
  { rota: ROUTES.tutorListing, dosya: ["pages", "TutorSettings.tsx"], etiket: "İlanım" },
  { rota: ROUTES.tutorReviews, dosya: ["pages", "TutorReviews.tsx"], etiket: "Değerlendirmeler" },
];

describe("panel genişliği · adlandırılmış sınıf", () => {
  it("DOLULUK: sınıf listesi gerçekten dolu ve Tailwind sınıfı taşıyor", () => {
    // Bu olmadan aşağıdaki iddialar BOŞ bir sözlükle de geçerdi.
    const anahtarlar = Object.keys(PANEL_GENISLIKLERI);
    expect(anahtarlar.sort()).toEqual(["dar", "orta"]);
    for (const [ad, sinif] of Object.entries(PANEL_GENISLIKLERI)) {
      expect(sinif, `${ad} max-w taşımıyor`).toMatch(/\bmax-w-\w+\b/);
      expect(sinif, `${ad} ortalanmıyor`).toContain("mx-auto");
    }
  });

  it("eşleme tablosu şeridin TAMAMINI kapsar", () => {
    // Şeride yeni bir sekme eklenirse bu test önce konuşur: sayfası
    // listelenmeden genişlik kuralına giremez.
    const seritte = TUTOR_PANO_SEKMELERI.map((s) => s.to).sort();
    const listede = SEKME_SAYFALARI.map((s) => s.rota).sort();
    expect(listede).toEqual(seritte);
  });

  it.each(SEKME_SAYFALARI)(
    "$etiket sayfası adlandırılmış bir genişliğe bağlı",
    ({ dosya, etiket }) => {
      const kaynak = oku(...dosya);
      const adliGenislik = /genislik=["{]/.test(kaynak);
      // Tam genişlik ayrı bir eksen: `flush` kabuğu kenardan kenara açar
      // (mesajlaşma). O da bilinçli bir seçimdir, keyfi bir `max-w` değil.
      const tamGenislik = /\bflush\b/.test(kaynak);
      expect(
        adliGenislik || tamGenislik,
        `${etiket}: ne \`genislik\` ne \`flush\` geçiyor — genişliği kurala bağlı değil`
      ).toBe(true);
    }
  );

  it("şerit sayfaları kendi başına `max-w-*` YAZMAZ", () => {
    /*
     * Asıl kaçış yolu bu: sayfa `genislik="orta"` geçip içeride yine
     * `mx-auto max-w-2xl` yazarsa kural kâğıt üstünde kalır, gerçek genişliği
     * yine sayfa belirler. Kabuk zaten sarmalıyor; sayfanın kendi sınırı
     * olmamalı.
     *
     * `flush` sayfalar (mesajlaşma) muaf: orada yerleşimi sayfa kurar ve
     * sohbet akışının kendi okunabilirlik sınırı vardır.
     */
    const ihlaller: string[] = [];
    for (const { dosya, etiket } of SEKME_SAYFALARI) {
      const kaynak = oku(...dosya);
      if (/\bflush\b/.test(kaynak)) continue;
      for (const m of kaynak.matchAll(/mx-auto[^"'`]*\bmax-w-[\w[\]]+/g)) {
        ihlaller.push(`${etiket}: ${m[0]}`);
      }
    }
    expect(
      ihlaller,
      "sayfa kabuğun genişliğini kendi `max-w`iyle eziyor"
    ).toEqual([]);
  });
});
