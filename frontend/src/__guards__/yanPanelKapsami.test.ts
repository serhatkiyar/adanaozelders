/**
 * Özel dersin yan paneli KENDİ İŞİNİ taşır — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * "Kütüphaneler" ve "Mağaza" özel dersin yan panelinden çıktı. Panel kişinin
 * kendi işini taşır: favorileri, mesajları, rezervasyonları, ilanı, bakiyesi.
 * Kütüphaneler ve Mağaza ise ayrı KEŞİF yüzeyleridir; onları buraya koymak
 * paneli bir site haritasına çeviriyordu.
 *
 * ## Bu nöbetçinin ASIL iddiası — ÖLÜ UÇ DEĞİL, TAŞINMA
 *
 * Bir girişi kaldırmak, hedefi erişilemez bırakmadığı sürece doğrudur. Bu
 * oturumda tam tersi bir kusur yaşandı: bildirim zili kaldırıldı ve
 * `/bildirimler` hiçbir menüde kalmadı (ÜK-2). Bu yüzden burada iki iddia
 * BİRLİKTE duruyor: menülerde yoklar, ama kategori çubuğunda varlar.
 *
 * Kaldırılan sayfa, rota ya da mağazanın kendi gezinmesi DEĞİL — yalnız iki
 * menü girdisi.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK/VERİ sözleşmesi testidir: menü dizilerini ve kategori kataloğunu
 * okur. "Ekranda görünüyor" iddiası değildir; kategori çubuğunun gerçek DOM
 * kanıtı `bolumDondurma.test.tsx` A bölümündedir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OPERATOR_NAV,
  TUTOR_NAV,
  TUTOR_PANO_SEKMELERI,
  UYE_NAV,
} from "@/lib/nav";
import { ROUTES } from "@/lib/routes";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

/** `CATEGORIES` dışa aktarılmıyor; katalog kaynaktan okunur. Yalnız bir test
 *  için `export` eklemek üretim modülünün yüzeyini genişletirdi. */
const KATEGORI_KAYNAGI = readFileSync(
  join(KOK, "src", "components", "CategoryBar.tsx"),
  "utf8"
);

/*
 * Eğitmen tarafı 8 Eyl 2026'da İKİ YÜZEYE bölündü: gezinme avatar menüsünden
 * panel şeridine (`TUTOR_PANO_SEKMELERI`) taşındı, menüde yalnız şeride
 * girmeyenler kaldı. Bu nöbetçinin iddiası ("Kütüphaneler ve Mağaza özel
 * dersin yan panelinde DEĞİL") yüzeye değil KAPSAMA aittir — o yüzden iki
 * yüzeyin birleşimi üzerinden ölçülür. Yalnız menüye bakmak, girdinin şeride
 * kaçmasına sessizce izin verirdi.
 */
const OZEL_DERS_MENULERI: [string, typeof UYE_NAV][] = [
  ["UYE_NAV", UYE_NAV],
  ["TUTOR (menü + şerit)", [...TUTOR_NAV, ...TUTOR_PANO_SEKMELERI]],
];

describe("yan panel · kapsam", () => {
  it("DOLULUK: menüler gerçekten dolu ve kendi işini taşıyor", () => {
    // Boş bir menü, aşağıdaki "içermiyor" iddialarını bedava geçirirdi.
    for (const [ad, nav] of OZEL_DERS_MENULERI) {
      expect(nav.length, `${ad} boş`).toBeGreaterThanOrEqual(3);
      expect(nav.some((i) => i.to === ROUTES.messages), `${ad} Mesajlar yok`).toBe(true);
      expect(nav.some((i) => i.to === ROUTES.favorites), `${ad} Favorilerim yok`).toBe(true);
    }
    // Kaldırılan iki hedefin rotası hâlâ tanımlı — silinen şey menü girdisi.
    expect(ROUTES.libraries).toBeTruthy();
    expect(ROUTES.store).toBeTruthy();
  });

  it.each(OZEL_DERS_MENULERI)("%s Kütüphaneler ve Mağaza taşımıyor", (_ad, nav) => {
    expect(nav.some((i) => i.to === ROUTES.libraries)).toBe(false);
    expect(nav.some((i) => i.to === ROUTES.store)).toBe(false);
  });

  it("operatör menüsü etkilenmedi (kendi kütüphanesi ayrı bir şey)", () => {
    // Kapsam sınırı: "Kütüphanem" operatörün KENDİ işidir, keşif yüzeyi değil.
    expect(OPERATOR_NAV.some((i) => i.to === ROUTES.operatorLibrary)).toBe(true);
    expect(OPERATOR_NAV.some((i) => i.to === ROUTES.libraries)).toBe(false);
  });

  it("ÖLÜ UÇ YOK: ikisinin de kategori çubuğunda girişi duruyor", () => {
    // Asıl iddia bu. Menüden çıkan hedefe başka bir yerden gidilebildiği
    // kanıtlanmadan kaldırma doğru sayılmaz.
    expect(KATEGORI_KAYNAGI).toContain("to: ROUTES.libraries");
    expect(KATEGORI_KAYNAGI).toContain("to: ROUTES.store");
    // DOLULUK: katalog gerçekten okundu (boş dosya da yukarıyı geçemesin).
    expect(KATEGORI_KAYNAGI).toContain("CATEGORIES");
    expect(KATEGORI_KAYNAGI.length).toBeGreaterThan(1000);
  });
});
