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

const SCRIPT_ID = "site-analytics";

function config() {
  return {
    src: import.meta.env.VITE_ANALYTICS_SCRIPT_URL as string | undefined,
    websiteId: import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined,
  };
}

/** Analitik script'ini bir kez yükler. Ayar yoksa hiçbir şey yapmaz. */
export function initAnalytics(): void {
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
  const { src } = config();
  if (!src) return;
  const umami = (window as unknown as { umami?: { track: (payload: unknown) => void } })
    .umami;
  if (!umami?.track) return;
  const clean = path.split("?")[0].split("#")[0];
  umami.track({ url: clean, title: document.title });
}
