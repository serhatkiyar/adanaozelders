import type { ThemeConfig } from "antd";

/**
 * Sider/Menu koyu zemini — panel genelinde bu sabit üzerinden kullanılır.
 * Marka rengi DEĞİL: nötr koyu zemin. `index.css`'te bunun karşılığı bir
 * token yok (panel dışı hiçbir yüzey koyu-nötr Sider kullanmıyor), bu yüzden
 * uydurma bir bağlama yapılmadı — sabit olduğu gibi bırakıldı.
 *
 * Değer `docs/ikas-panel-referans.md` §7'de canlı ikas panelinden
 * `getComputedStyle` ile ölçüldü: tam siyah (#000000), eski `#111827`
 * (gray-900 tahmini) değil.
 */
export const PANEL_SIDER_BG = "#000000";

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
 * çiğnenir. Bu yüzden düğmeye ÖZEL olarak `components.Button.primaryColor`
 * ile bağlanır. Aynı nöbetçi bu değeri de sınar.
 *
 * DİKKAT — global `token.colorTextLightSolid` KULLANILMAZ. Denendi ve
 * kullanıcının bildirdiği gerçek bir kusura yol açtı: o token AntD'de "koyu
 * zemin üstündeki yazı" anlamına gelir, koyu Sider menüsünün yazı rengini de
 * kapsar; `--marka-fg` (neredeyse siyah) koyu zemine uygulanınca menü
 * yazıları GÖRÜNMEZ oldu. Kapsam düğmeyle sınırlı tutulur; ayrıca koyu
 * menünün yazı renkleri aşağıda AÇIKÇA verilir ki hiçbir global token onları
 * sessizce ele geçiremesin.
 */
const MARKA_USTU_YAZI = "#2B1000"; // index.css → --marka-fg: 43 16 0

/**
 * Koyu Sider/Menu zemini üstündeki yazı — `docs/ikas-panel-referans.md` §7'de
 * ölçülen değerler: varsayılan öğe yazısı `#ECECED`, seçili öğe yazısı
 * `#F8FAFC` (aşağıda `Menu.darkItemSelectedColor`). Eski değer
 * `rgba(255,255,255,0.85)` (AntD koyu menü varsayılanı) tahminiydi.
 */
const MENU_YAZI = "#ECECED";

/**
 * Bağlantı metni (ör. filtre penceresindeki "Filtre Ekle") — ikas'ta aksan
 * rengiyle basılır; bizde aksanın METİN varyantı `index.css` → `--marka-metin`
 * (#96430A, beyazda 6,77 kontrast). Parlak `--marka` metin olarak
 * kullanılamaz (2,1), o yüzden düğme dolgusuyla aynı değer değil.
 */
const MARKA_METIN = "#96430A"; // index.css → --marka-metin: 150 67 10
const MARKA_METIN_HOVER = "#7C3708"; // index.css → --marka-metin-hover: 124 55 8

/** Panelin TEK renk/ölçü kaynağı. Başka dosyada renk sabiti yazılmaz. */
export const panelTheme: ThemeConfig = {
  token: {
    colorPrimary: MARKA,
    // ikas referansı §7 "Tema token'ları" — canlı panelden ölçüldü.
    borderRadius: 4,
    controlHeight: 40,
    fontSize: 14,
    colorBorder: "#E3E8EF",
    // Canlı ikas ürün ekranından ölçüldü (11 Eyl 2026, getComputedStyle):
    // ikincil ayırıcı #EEF2F6 (alt bilgi üst çizgisi, görünüm anahtarı grubu
    // kenarlığı, filtre penceresi kenarlığı), hafif zemin #F8FAFC (kolon
    // ayarı düğmesi, görünüm anahtarı grubu, görselsiz ürün karesi), üçüncül
    // yazı #697586 (etkin olmayan görünüm anahtarı).
    colorBorderSecondary: "#EEF2F6",
    colorBgLayout: "#F8FAFC",
    colorTextTertiary: "#697586",
    colorText: "#121926",
    colorTextSecondary: "#4B5565",
    colorLink: MARKA_METIN,
    colorLinkHover: MARKA_METIN_HOVER,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    // `headerBg` yok: kabuğun üst barı kaldırıldı (ikas referansı §5/4).
    // `bodyBg`: içerik zemini beyaz — referans §5/5 ("gri zemin + beyaz kart"
    // yerine "düz beyaz yüzey"). Panelin TEK renk kaynağı burasıdır.
    Layout: { siderBg: PANEL_SIDER_BG, bodyBg: "#ffffff" },
    // Koyu menünün yazı renkleri AÇIKÇA verilir: global bir token bunları
    // ele geçirip koyu-üstü-koyu yaparsa menü okunamaz hale gelir (bir kez oldu).
    // Ölçüler de referans §7 "Sider" tablosundan: öğe yüksekliği 36px,
    // köşe yarıçapı 4px, `paddingInline` 10px, seçili zemin `#2E2E33`.
    Menu: {
      darkItemBg: PANEL_SIDER_BG,
      darkItemSelectedBg: "#2E2E33",
      darkItemColor: MENU_YAZI,
      darkItemHoverColor: "#ffffff",
      darkItemSelectedColor: "#F8FAFC",
      itemHeight: 36,
      itemBorderRadius: 4,
      itemPaddingInline: 10,
    },
    // Birincil düğme yazısı: "parlak dolgu + koyu yazı" kuralı YALNIZ burada.
    // Yükseklik/yarıçap global `controlHeight`/`borderRadius`tan gelir;
    // `fontWeight` ve ikincil düğmenin zemin/kenarlık/yazısı referans §7
    // "Düğmeler" tablosundan.
    Button: {
      primaryColor: MARKA_USTU_YAZI,
      fontWeight: 500,
      defaultBg: "#FFFFFF",
      defaultBorderColor: "#E3E8EF",
      defaultColor: "#121926",
    },
    // ikas'ın listesi AntD `Table` DEĞİL (div/Row/Col yapısı) — bizde
    // sıralama/sayfalama `Table`dan geldiği için bileşen kalıyor, yalnız
    // GÖRÜNÜMÜ ikas'a çekiliyor. Değerler `docs/ikas-panel-referans.md`
    // §7 "Liste — İKİNCİ TUR ÖLÇÜM" tablosundan (canlı DOM'dan ikinci turda
    // düzeltilen ölçüm; ilk tablodaki "başlık zemini yok" / "40px satır" /
    // "ince ayırıcı çizgi" iddiaları YANLIŞTI, bunlar onun yerine geçer).
    Table: {
      // Başlık satırı zemini: açık gri, AntD varsayılanı (#FAFAFA'ya yakın
      // `colorFillAlterSolid`) DEĞİL.
      headerBg: "#EEF2F6",
      headerColor: "#4B5565",
      // `borderColor` rc-table'da HEM başlığın alt çizgisini HEM veri
      // satırlarının ayırıcısını üretir (`tableBorder` tek değişken, ikisine
      // de uygulanıyor — `node_modules/antd/es/table/style/index.js`
      // doğrulandı). ikas'ta ikisi de YOK (başlık ayrımını zemin rengi
      // sağlıyor, satır ayırıcısı `border-bottom: 0.8px solid transparent`) —
      // bu yüzden tek token'la ikisi birden kapatılıyor.
      borderColor: "transparent",
      // Başlık satırı köşesi 4px — canlı ikas ölçümü (11 Eyl 2026).
      headerBorderRadius: 4,
      // Veri hücresi dolgusu: satır yüksekliği (ölçülen 69px) BURADAN,
      // sabit bir yükseklik token'ından DEĞİL doğuyor (ikas'ta da öyle).
      // Başlık hücresinin dolgusu/yüksekliği/`fontWeight`ı farklı (`0 12px`,
      // 40px, 500) ama bu token'lar başlıkla veri arasında PAYLAŞILIR —
      // başlığa özgü fark `ListePage.tsx`te `onHeaderCell` satır-içi stiliyle
      // uygulanıyor (bkz. oradaki yorum).
      cellPaddingBlock: 16,
      cellPaddingInline: 12,
    },
  },
};
