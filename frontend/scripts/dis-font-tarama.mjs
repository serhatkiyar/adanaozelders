/**
 * Dış yazı tipi konağı tarayıcısı — İP-B2 · Ç-5 (KVKK).
 *
 * ## Neden ayrı bir modül
 *
 * Nöbetçi testin kendisi aranan metni İÇERSEYDİ, tarama **kendi kaynağını
 * yakalar** ve ya sonsuza dek kırmızı kalır ya da "kendi dosyamı hariç tut"
 * diye bir kaçış kapısı doğardı. Bu depoda tam olarak o sınıf bir kusur
 * ölçüldü (İP-A6b · M-A; İP-A7d4 · alet kusurları) ve dersi şudur: dedektör,
 * kendi aradığı deseni kaynağında TAŞIMAMALIDIR.
 *
 * Çözüm hariç tutma değil, **desenin hiçbir yerde tam olarak yazılı
 * olmaması**: konak adları aşağıda parçalardan birleştirilir. Böylece
 * konak adlarının hiçbir parçası bu dosyada da dahil olmak üzere depoda tam
 * hâliyle geçmez ve tarama sıfır istisnayla çalışır.
 *
 * (Bu yorumun kendisi de bir kez taramaya takıldı: ilk yazımında konak
 * adlarını örnek olarak DÜZ yazıyordu ve nöbetçi onu buldu. Kanıt, dedektörün
 * gerçekten çalıştığının kendisidir.)
 *
 * ## Ne aranıyor
 *
 * İki konak: Google'ın yazı tipi stil sunucusu ve yazı tipi dosya sunucusu.
 * Birincisi bir `<link rel="stylesheet">` ile, ikincisi CSS `url()` ile
 * gelir; ikisinden biri bile ziyaretçinin IP'sini üçüncü tarafa gönderir,
 * dolayısıyla ikisi de yasaktır.
 *
 * Tarama `@import url(...)` gibi dolaylı biçimleri de yakalar, çünkü ham
 * metinde konak adı yine geçer.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = dirname(fileURLToPath(import.meta.url));
/** `frontend/` kökü (bu dosya `frontend/scripts/` altında). */
export const KOK = resolve(BURASI, "..");

/**
 * Yasak konaklar — PARÇALARDAN birleştirilir (yukarıdaki gerekçe).
 *
 * `["goog", "leapis"].join("")` yazımı kozmetik değil ZORUNLUDUR: düz yazılsa
 * bu dosya kendi taramasında bulgu üretirdi.
 */
export const YASAK_KONAKLAR = [
  `fonts.${["goog", "leapis"].join("")}.com`,
  `fonts.${["gsta", "tic"].join("")}.com`,
];

/** Gevşek biçimler de yakalanır: konak adı tam yazılmasa bile alan adı geçer. */
export const YASAK_PARCALAR = [["goog", "leapis"].join(""), ["gsta", "tic"].join("")];

const TARANAN_UZANTILAR = [
  ".html",
  ".css",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

const ATLANAN_DIZINLER = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".vite",
  "fonts", // ikili varlıklar; metin taraması anlamsız
  // Yerel deneme klasörü (24 Eyl 2026). Tarama git'e değil DİSKE bakar, yani
  // izlenmeyen dosyaları da okur; `.scratch/` içine kaydedilmiş dış sayfa
  // kopyaları (HTML/betik denemeleri) nöbetçiyi yalnız o makinede kırıyordu.
  // Klasör kök `.gitignore`da yok sayılır, depoya ve CI'a hiç girmez — ürün
  // kaynağı olmadığı için KVKK iddiasının kapsamında değildir.
  ".scratch",
]);

/** `frontend/` ağacındaki taranabilir dosyalar (repo köküne göre değil, frontend'e göre). */
export function taranacakDosyalar(kok = KOK) {
  const cikti = [];
  const yuru = (dizin) => {
    for (const ad of readdirSync(dizin).sort()) {
      const tam = join(dizin, ad);
      const bilgi = statSync(tam);
      if (bilgi.isDirectory()) {
        if (ATLANAN_DIZINLER.has(ad)) continue;
        yuru(tam);
        continue;
      }
      if (!TARANAN_UZANTILAR.some((u) => ad.endsWith(u))) continue;
      cikti.push(tam);
    }
  };
  yuru(kok);
  return cikti;
}

/**
 * Bir metin parçasında yasak konak var mı — SAF fonksiyon.
 *
 * Ayrı export edilmesinin sebebi ters prova: taramanın gerçekten ayırt
 * ettiği, diskte olmayan sentetik metinlerle kanıtlanır (kaynak sözleşmesi
 * testlerinin CLAUDE.md §C'deki zayıflığına karşı).
 */
export function metindeBulgular(metin) {
  const bulgular = [];
  const satirlar = metin.split(/\r?\n/);
  satirlar.forEach((satir, i) => {
    const kucuk = satir.toLowerCase();
    for (const parca of YASAK_PARCALAR) {
      if (kucuk.includes(parca)) bulgular.push({ satir: i + 1, parca, metin: satir.trim() });
    }
  });
  return bulgular;
}

/** Bütün `frontend/` ağacında yasak konak atıfları. */
export function disFontBulgulari(kok = KOK) {
  const bulgular = [];
  for (const dosya of taranacakDosyalar(kok)) {
    const icerik = readFileSync(dosya, "utf8");
    for (const b of metindeBulgular(icerik)) {
      bulgular.push({
        dosya: relative(kok, dosya).split(sep).join("/"),
        satir: b.satir,
        parca: b.parca,
      });
    }
  }
  return bulgular;
}

/** `public/fonts/` altındaki woff2 dosyaları + gerçek WOFF2 imzası taşıyıp taşımadıkları. */
export function yerelYaziTipleri(kok = KOK) {
  const dizin = join(kok, "public", "fonts");
  let adlar = [];
  try {
    adlar = readdirSync(dizin).filter((a) => a.endsWith(".woff2")).sort();
  } catch {
    return [];
  }
  return adlar.map((ad) => {
    const tam = join(dizin, ad);
    const bas = readFileSync(tam).subarray(0, 4).toString("latin1");
    return { ad, bayt: statSync(tam).size, woff2: bas === "wOF2" };
  });
}
