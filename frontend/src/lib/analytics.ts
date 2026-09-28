/**
 * Ziyaretçi analitiği — opt-in ve ÇEREZSİZ.
 *
 * `VITE_ANALYTICS_SCRIPT_URL` verilmezse tamamen no-op: geliştirmede dış hesap
 * gerekmez (`monitoring.ts` ve backend'deki `core/mail`/`core/payments` ile aynı
 * sağlayıcı-bağımsız desen).
 *
 * Neden gerekli: lansman gününün verisi geri dönülmez. Hangi sayfadan gelindiği,
 * hangi aramanın sonuçsuz kaldığı, checkout'un nerede terk edildiği — bunlar o
 * gün ölçülmezse bir daha ölçülemez.
 *
 * ── İki bilinçli karar ──
 *
 * 1. **Çerezsiz sağlayıcı** (Umami/Plausible). Çerez kullanan bir analitik,
 *    KVKK/ePrivacy uyarınca açık rıza ister ve siteye bir çerez onay bandı
 *    eklemek zorunda kalırdık (bkz. ekspertiz raporu §6). Çerezsiz ölçüm bu
 *    zorunluluğu tamamen ortadan kaldırır.
 *
 * 2. **Kendi alan adımızdan (first-party) servis**. Script doğrudan sağlayıcı
 *    alan adından yüklenmez; Caddy `/istatistik/*` yolunu analitik sunucusuna
 *    proxy'ler. İki kazanç: (a) CSP'deki `script-src 'self'` bozulmaz — üçüncü
 *    taraf bir host'a izin vermek, XSS savunmasında açtığımız ilk delik olurdu;
 *    (b) reklam engelleyiciler bilinen analitik alan adlarını engeller, kendi
 *    yolumuz engellenmez (ölçüm yanlılığı azalır).
 */

import { cerezTercihi } from "@/lib/cerezOnayi";

const SCRIPT_ID = "site-analytics";

function config() {
  return {
    src: import.meta.env.VITE_ANALYTICS_SCRIPT_URL as string | undefined,
    websiteId: import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined,
  };
}

/* ── Google Analytics 4 ve Meta Pixel (26 Eyl 2026, kurucu kararı) ──
 *
 * İkisi de yalnız ID verilince yüklenir (`VITE_GA_ID`, `VITE_META_PIXEL_ID`);
 * verilmezse no-op. Satır içi script yoktur (CSP `script-src` yalnız iki
 * sağlayıcının alan adına izin verir): `gtag`/`fbq` kuyrukları burada, kendi
 * paketimizde kurulur, sağlayıcı script'i sonra yüklenip kuyruğu işler.
 * Sayfa görüntülemesi SPA'da `trackPageview` ile, sorgu dizesi olmadan
 * gönderilir (URL'de token taşınabiliyor). */

type Kuyruk = ((...args: unknown[]) => void) & { queue?: unknown[]; q?: unknown[] };
type Pencere = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: Kuyruk & { callMethod?: (...a: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };
  _fbq?: unknown;
};

function reklamConfig() {
  return {
    gaId: import.meta.env.VITE_GA_ID as string | undefined,
    pixelId: import.meta.env.VITE_META_PIXEL_ID as string | undefined,
    clarityId: import.meta.env.VITE_CLARITY_ID as string | undefined,
  };
}

function scriptEkle(id: string, src: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement("script");
  el.id = id;
  el.async = true;
  el.src = src;
  document.head.appendChild(el);
}

function initGoogleAnalytics(gaId: string): void {
  const w = window as Pencere;
  if (w.gtag) return;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // gtag.js `arguments` nesnesini bekler; dizi göndermek yok sayılır.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  // Sayfa görüntülemesini `trackPageview` gönderir (SPA).
  w.gtag("config", gaId, { send_page_view: false });
  scriptEkle("ga4", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`);
}

function initMetaPixel(pixelId: string): void {
  const w = window as Pencere;
  if (w.fbq) return;
  // eslint-disable-next-line prefer-const
  let fbq: NonNullable<Pencere["fbq"]>;
  fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as NonNullable<Pencere["fbq"]>;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  w.fbq = fbq;
  w._fbq = fbq;
  fbq("init", pixelId);
  scriptEkle("meta-pixel", "https://connect.facebook.net/en_US/fbevents.js");
}

function initClarity(clarityId: string): void {
  const w = window as Pencere & { clarity?: Kuyruk };
  if (w.clarity) return;
  const clarity = function (...args: unknown[]) {
    (clarity.q = clarity.q || []).push(args);
  } as Kuyruk;
  w.clarity = clarity;
  scriptEkle("ms-clarity", `https://www.clarity.ms/tag/${encodeURIComponent(clarityId)}`);
}

/** GA4, Meta Pixel ve Clarity'yi yükler — yalnız çerez onayından sonra
 *  (`components/CerezBandi.tsx`, `lib/cerezOnayi.ts`). Her etiket yalnız bir kez kurulur. */
export function reklamEtiketleriniBaslat(): void {
  const { gaId, pixelId, clarityId } = reklamConfig();
  if (gaId) initGoogleAnalytics(gaId);
  if (pixelId) initMetaPixel(pixelId);
  if (clarityId) initClarity(clarityId);
  // Sayfa görüntülemesi burada GÖNDERİLMEZ: açılışta `AnalyticsTracker` ilk
  // sayfayı zaten bildirir (burada da göndermek her açılışı çift sayıyordu).
  // Onay sayfa açıkken verilirse bulunulan sayfayı `CerezBandi` bildirir.
}

/** Analitik script'ini bir kez yükler. Ayar yoksa hiçbir şey yapmaz.
 *  Çerezli etiketler (GA4/Pixel/Clarity) yalnız daha önce onay verilmişse. */
export function initAnalytics(): void {
  if (cerezTercihi() === "kabul") reklamEtiketleriniBaslat();

  const { src, websiteId } = config();
  if (!src || document.getElementById(SCRIPT_ID)) return;

  const el = document.createElement("script");
  el.id = SCRIPT_ID;
  el.defer = true;
  el.src = src;
  if (websiteId) el.dataset.websiteId = websiteId;
  // Sayfa görüntülemelerini KENDİMİZ bildiriyoruz: bu bir SPA ve sağlayıcının
  // otomatik takibi history API'sini dinlese bile, kanonik yolu (parametresiz)
  // göndermek bizim elimizde olmalı — arama sorguları ve token'lar adres
  // çubuğunda taşınabiliyor.
  el.dataset.autoTrack = "false";
  document.head.appendChild(el);
}

/**
 * Bir sayfa görüntülemesi bildirir.
 *
 * Adres **sorgu dizesi olmadan** gönderilir: takip token'ı, e-posta doğrulama
 * token'ı ve şifre sıfırlama token'ı URL'de taşınıyor (`?token=`), bunların
 * analitik sunucusunda birikmesi tek başına bir güvenlik olayı olurdu. Aynı
 * gerekçe `monitoring.ts::stripSensitiveParams` içinde de var.
 */
export function trackPageview(path: string): void {
  const clean = path.split("?")[0].split("#")[0];
  const w = window as Pencere;
  const { gaId, pixelId } = reklamConfig();
  if (gaId && w.gtag) {
    w.gtag("event", "page_view", {
      page_path: clean,
      page_location: window.location.origin + clean,
      page_title: document.title,
    });
  }
  if (pixelId && w.fbq) w.fbq("track", "PageView");

  const { src } = config();
  if (!src) return;
  const umami = (window as unknown as { umami?: { track: (payload: unknown) => void } })
    .umami;
  if (!umami?.track) return;
  umami.track({ url: clean, title: document.title });
}
