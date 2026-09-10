/**
 * ARAMA ADRESİ TEK KAPIDAN ÜRETİLİR — kaynak taraması.
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Bu katmandan önce query string ALTI ayrı yerde elle kuruluyordu ve sonuç
 * ölçülmüştü: ana sayfa eğitmen araması `?subject=` yazarken `useNavSearch`
 * aynı hedefe `?q=` yazıyordu. İki sözleşme, tek hedef.
 *
 * Elle kurulan bir adres HATA VERMEZ. Yanlış anahtar yazan bir link doğru
 * sayfayı açar, yalnız filtre uygulanmamış olur — kimse fark etmez. 9 Eyl
 * 2026 Türkçeleşmesi bunun canlı örneğini üretti: `StoreCategoryBar` elle
 * `?category=` yazmaya devam ediyordu ve aktif kategori artık hiç
 * koyulaşmıyordu (link çalışıyor, vurgu sessizce ölü).
 *
 * ## Neden dizin YÜRÜYÜŞÜ yok
 *
 * Bu deponun ölçülmüş dersi: taban bir dizin yürüyüşüyle kurulunca yeni
 * eklenen kaçak dosya sessizce geçiyor. Burada iki ayrı iddia var:
 *
 *   1. YÜZEYLER — adı adı sayılmış arama ekranları tek kapıyı GERÇEKTEN
 *      import ediyor (liste boşalırsa doluluk iddiası düşer).
 *   2. Yasak kalıp taraması — TÜM `src` içinde elle yazılmış arama query
 *      string'i aranır. Bu yön kör değil hedeflidir: belirli bir kötü kalıbı
 *      arar, dosya SAYISINA dayanmaz, o yüzden yeni dosya kaçamaz.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Kaynak metni testidir: davranış değil KÖKEN ölçer. Şemanın doğru adres
 * ürettiğini `lib/aramaUrl.test.ts`, sayfaların adresi koruduğunu
 * `aramaSayfaKorunur` ölçer.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const KOK = join(process.cwd(), "src");

const oku = (goreli: string) => readFileSync(join(KOK, goreli), "utf-8");

/** Yorum satırlarını atar — yorumlar bu deponun tarihini anlatıyor. */
const kodSatirlari = (kaynak: string) =>
  kaynak
    .split("\n")
    .filter((s) => {
      const k = s.trim();
      return !k.startsWith("*") && !k.startsWith("//") && !k.startsWith("/*");
    });

/** Arama adresi ÜRETEN ekranlar — hepsi tek kapıyı import etmek zorunda. */
const YUZEYLER: [string, RegExp][] = [
  /*
   * Ana sayfanın arama hapı 10 Eyl 2026'da KEŞİF KABUĞUNA taşındı: `/` ve
   * `/kutuphaneler` artık tek bir üst bar paylaşıyor (kategori değişiminde
   * ekran yeniden kurulmasın diye). Adres üretimi de hapla birlikte gitti;
   * `Landing.tsx` artık yalnız vitrin şeritlerini basıyor ve hiçbir arama
   * adresi üretmiyor — bu yüzden listeden ÇIKTI, yerine kabuk girdi.
   */
  ["components/kesif/KesifKabugu.tsx", /egitmenAramaAdresi|useAramaDurumu/],
  ["pages/Marketplace.tsx", /useAramaDurumu/],
  ["pages/PublicMarketplace.tsx", /useAramaDurumu/],
  ["pages/Libraries.tsx", /useAramaDurumu/],
  ["pages/store/StorePage.tsx", /useAramaDurumu/],
  ["pages/store/ProductDetailPage.tsx", /magazaAramaAdresi/],
  ["components/store/StoreSearch.tsx", /magazaAramaAdresi/],
  ["components/store/StoreCategoryBar.tsx", /magazaAramaAdresi/],
  ["components/EgitmenFiltreModali.tsx", /useAramaDurumu/],
  ["hooks/useNavSearch.tsx", /egitmenAramaAdresi|kutuphaneAramaAdresi/],
];

/** Sözleşmenin SAHİBİ katman — elbette `URLSearchParams` kurar. */
const KAPI = new Set([
  "lib/urlSemasi.ts",
  "lib/aramaUrl.ts",
  "lib/yerArama.ts",
  "lib/pagination.ts",
  "hooks/useAramaDurumu.ts",
  "hooks/useUrlYazici.ts",
  "hooks/useUrlDurumu.ts",
]);

describe("arama URL · tek kapı", () => {
  it("DOLULUK: sayılan yüzeyler gerçekten var ve tek kapıyı import ediyor", () => {
    // Liste boşalır ya da dosya taşınırsa bu düğüm kırılır; yoksa aşağıdaki
    // iddialar hiçbir şey ölçmeden yeşil kalırdı.
    expect(YUZEYLER.length).toBeGreaterThanOrEqual(8);
    for (const [yol, beklenen] of YUZEYLER) {
      const kaynak = oku(yol);
      expect(kaynak, `${yol} okunamadı`).toBeTruthy();
      expect(
        beklenen.test(kaynak),
        `${yol} arama adresini tek kapıdan üretmiyor (${beklenen} yok)`
      ).toBe(true);
    }
  });

  it("hiçbir yüzey `new URLSearchParams` ile arama adresi kurmuyor", () => {
    for (const [yol] of YUZEYLER) {
      // YALNIZ kod satırları: bu dosyaların yorumları eski elle-kurma
      // kusurunu ANLATIYOR ve anlatmaya devam etmeli.
      const suclu = kodSatirlari(oku(yol)).some((s) =>
        s.includes("new URLSearchParams(")
      );
      expect(suclu, `${yol} query string'i elle kuruyor — tek kapı delinmiş`).toBe(
        false
      );
    }
  });
});

/* ─── Yasak kalıp: elle yazılmış arama query string'i ────────────────────── */

/** Şemaların sahiplendiği anahtarlar (kanonik + eski). */
const ARAMA_ANAHTARLARI = [
  "ders",
  "subject",
  "ilce",
  "district",
  "mahalle",
  "sekil",
  "mode",
  "sinav",
  "exam",
  "cinsiyet",
  "gender",
  "kategori",
  "category",
  "sirala",
  "sort",
];

/**
 * Bilinçli istisnalar — her biri gerekçesiyle.
 *
 * `Landing.tsx`: schema.org `SearchAction` şablonu (`?q={search_term_string}`).
 * Google'ın beklediği şey bir ADRES değil bir ŞABLON; kodek üretemez.
 * `ShareModal.tsx` / `OrderDetailPage.tsx`: `mailto:?subject=` ve Google arama
 * bağlantısı — bizim arama şemamızla ilgisi yok, adaş.
 * Admin yüzeyleri: kendi liste araçları var (`adminUserQuery`), public arama
 * şemasına bağlı değiller.
 */
const ISTISNALAR = new Set([
  "pages/Landing.tsx",
  "components/ShareModal.tsx",
  "pages/store/OrderDetailPage.tsx",
  "components/admin/ProductPicker.tsx",
]);

function tsDosyalari(dizin: string, biriktir: string[] = [], onek = ""): string[] {
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    const goreli = onek ? `${onek}/${ad}` : ad;
    if (statSync(tam).isDirectory()) {
      if (ad === "__guards__" || ad === "node_modules") continue;
      tsDosyalari(tam, biriktir, goreli);
    } else if (/\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad)) {
      biriktir.push(goreli);
    }
  }
  return biriktir;
}

describe("arama URL · elle yazılmış query string yok", () => {
  const dosyalar = tsDosyalari(KOK);

  it("tarama gerçekten dosya görüyor", () => {
    // Yürüyüş bozulursa (yol değişikliği, filtre hatası) aşağıdaki iddia
    // sıfır dosya üzerinde yeşil kalırdı.
    expect(dosyalar.length).toBeGreaterThan(200);
  });

  it("hiçbir dosya `?<arama anahtarı>=` dizesini elle kurmuyor", () => {
    // Yalnız KOD satırları — yorumlar tarihi anlatıyor ve anlatmaya devam
    // etmeli. `?anahtar=${...}` ya da `?anahtar=` + değişken kalıbı aranır.
    const kalip = new RegExp(`[?](${ARAMA_ANAHTARLARI.join("|")})=[$][{]`);
    const suclular: string[] = [];

    for (const yol of dosyalar) {
      if (KAPI.has(yol) || ISTISNALAR.has(yol)) continue;
      for (const satir of kodSatirlari(oku(yol))) {
        if (kalip.test(satir)) suclular.push(`${yol} -> ${satir.trim()}`);
      }
    }

    expect(
      suclular,
      `Arama adresi elle kurulmuş. Tek kapı: lib/aramaUrl.ts\n${suclular.join("\n")}`
    ).toEqual([]);
  });
});
