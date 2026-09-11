import type { ThemeConfig } from "antd";

/**
 * Sider/Menu koyu zemini — panel genelinde bu sabit üzerinden kullanılır.
 * Marka rengi DEĞİL: nötr koyu zemin (gray-900 tonu). `index.css`'te bunun
 * karşılığı bir token yok (panel dışı hiçbir yüzey koyu-nötr Sider kullanmıyor),
 * bu yüzden uydurma bir bağlama yapılmadı — sabit olduğu gibi bırakıldı.
 */
export const PANEL_SIDER_BG = "#111827";

/**
 * Panelin birincil rengi `index.css`'teki `--marka` (#FF9900, Amazon
 * turuncusu — 7 Eyl 2026 kararı) ile AYNI olmak ZORUNDADIR: panel kendi
 * değerini TUTMAZ, markaya takma addır (bkz. `index.css` "PANEL AKSANI:
 * MARKAYA TAKMA AD" bölümü). Eski değer `#C2410C` (ton 17°, "kiremit") o
 * kararın İLK, terk edilmiş taslağıydı — `index.css`'in kendi yorumu bunu
 * "fazla koyu" bulunup değiştirildi diye anlatır; panel o taslakta unutulmuş
 * kalmıştı.
 *
 * AntD `ThemeConfig` çalışma zamanında CSS değişkeni kabul etmez (türetilmiş
 * paleti kendi hesaplar) ve jsdom'da zaten `--marka` boş gelir — bu yüzden
 * `getComputedStyle` okuması yerine değer burada SABİT tutulur. Sapma sessiz
 * kalmaz: `src/__guards__/panelMarkaRengi.test.ts` bu sabiti her koşuda
 * `index.css`'teki gerçek `--marka` ile karşılaştırır ve uyuşmazsa hangi
 * dosyanın güncellenmesi gerektiğini söyleyen bir mesajla kırmızıya döner.
 */
const MARKA = "#FF9900"; // index.css → --marka: 255 153 0

/**
 * `index.css` kuralı: dolgu PARLAK, üstündeki yazı KOYU (`--marka-fg`).
 * AntD birincil düğmenin varsayılan yazı rengi BEYAZdır ve `MARKA` üstünde
 * beyaz yazı yalnızca 2,1 kontrast verir (eşik 4,5) — kural sessizce
 * çiğnenir. `colorTextLightSolid` bunu `--marka-fg`ye bağlayarak AntD'nin
 * birincil düğmesini de aynı kurala tabi kılar. Aynı nöbetçi bu değeri de
 * sınar.
 */
const MARKA_USTU_YAZI = "#2B1000"; // index.css → --marka-fg: 43 16 0

/** Panelin TEK renk/ölçü kaynağı. Başka dosyada renk sabiti yazılmaz. */
export const panelTheme: ThemeConfig = {
  token: {
    colorPrimary: MARKA,
    colorTextLightSolid: MARKA_USTU_YAZI,
    borderRadius: 8,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: { siderBg: PANEL_SIDER_BG, headerBg: "#ffffff" },
    Menu: { darkItemBg: PANEL_SIDER_BG, darkItemSelectedBg: "#1f2937" },
  },
};
