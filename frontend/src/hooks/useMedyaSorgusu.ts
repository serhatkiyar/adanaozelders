import { useEffect, useState } from "react";

/**
 * `matchMedia` sarmalayıcısı — "şu an mobil mi" sorusunun TEK cevabı.
 *
 * ## Neden CSS yetmedi
 *
 * Duyarlı tasarımın varsayılan aracı CSS'tir (`md:hidden`) ve bu dosya onun
 * yerine geçmez. Ama iki dalın ikisi de DOM'a basıldığında ödenen bir bedel
 * var: ana sayfada arama hapının mobil (kompakt) ve masaüstü (üç bölmeli)
 * hâlleri AYNI `htmlFor` kimliklerini taşır. İkisi birden mount edilirse
 * belgede çift kimlik doğar; etiket-girdi bağı belirsizleşir ve
 * `__guards__/aramaHapiBaslik.test.tsx`in `getByText` iddiaları çoklu
 * eşleşmeden düşer. Yani burada seçim görünürlük değil MONTAJ meselesidir.
 *
 * ## Sunucu/prerender ve test davranışı
 *
 * `matchMedia` yoksa (prerender, eski jsdom) `false` döner — yani masaüstü
 * dalı. Bu bilinçli: `/` bir prerender/SEO hedefi ve masaüstü dalı içeriğin
 * tamamını taşır. `test-setup.ts` de bir `matchMedia` shim'i kurduğu için
 * jsdom testleri de masaüstü dalını görür; mevcut nöbetçiler bugünkü yolu
 * ölçmeye devam eder.
 *
 * İlk render'da `false` dönüp `useEffect`te düzeltmek yerine değer DOĞRUDAN
 * `useState` başlatıcısında okunur: aksi hâlde telefonda önce masaüstü hapı
 * bir kare boyunca çizilir ve göz onu yanıp sönme olarak görür.
 */
export function useMedyaSorgusu(sorgu: string): boolean {
  const [eslesiyor, setEslesiyor] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(sorgu).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(sorgu);
    const uyarla = () => setEslesiyor(mql.matches);
    uyarla();
    // Safari 13 ve altı `addEventListener` tanımıyor; `addListener` mirası
    // orada tek yol. Tip tarafında `unknown` üzerinden geçiliyor çünkü
    // `MediaQueryList` tipi eski API'yi artık bildirmiyor.
    if (mql.addEventListener) {
      mql.addEventListener("change", uyarla);
      return () => mql.removeEventListener("change", uyarla);
    }
    const eski = mql as unknown as {
      addListener: (f: () => void) => void;
      removeListener: (f: () => void) => void;
    };
    eski.addListener(uyarla);
    return () => eski.removeListener(uyarla);
  }, [sorgu]);

  return eslesiyor;
}

/**
 * Tailwind `md` kırılma noktası (768px) ile AYNI eşik.
 *
 * Sayı burada elle yazılıdır ve bu bir borçtur: Tailwind config'i değişirse
 * bu ikisi sessizce ayrışır. Bugün ayrışmıyor (`tailwind.config.js` `screens`
 * override etmiyor, yani varsayılan 768px yürürlükte) ve tek bir sayıyı iki
 * yerde tutmak, config'i çalışma zamanına taşımaktan ucuz.
 */
export function useMobil(): boolean {
  return useMedyaSorgusu("(max-width: 767.98px)");
}
