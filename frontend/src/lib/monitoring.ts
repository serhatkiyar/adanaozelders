/**
 * Hata izleme (Sentry) — opt-in.
 *
 * `VITE_SENTRY_DSN` verilmezse tamamen no-op: geliştirmede dış hesap gerekmez,
 * backend'deki `SENTRY_DSN` deseniyle aynı (core/observability.py).
 *
 * Neden gerekli: bu uygulamada tek koruma `ErrorBoundary`'ydi ve o da yalnız
 * `console.error` yapıyordu. Yani bir kullanıcının ödeme ekranında beyaz ekran
 * görmesini, o kişi size ulaşmadıkça ÖĞRENEMİYORDUNUZ.
 */
import { PATHS } from "./routes";

type SentryModule = typeof import("@sentry/react");

let sentry: SentryModule | null = null;
let initialized = false;

/**
 * Sentry KOŞULLU ve DİNAMİK yüklenir (statik import değil).
 *
 * Sebep ölçüldü: statik import'ta SDK giriş paketine giriyor ve DSN
 * verilmemiş olsa bile — yani geliştirmede ve DSN girilene kadar üretimde —
 * her ziyaretçi onu indiriyordu. Dinamik import'ta Vite ayrı bir chunk üretir;
 * DSN yoksa o chunk'a hiç istek gitmez, varsa da ilk boyamayı bloklamaz.
 *
 * Bedeli: SDK yüklenene kadar geçen birkaç yüz ms içindeki hatalar
 * yakalanmaz. Kabul edildi — bu penceredeki hatalar neredeyse tamamen
 * modül yükleme hatalarıdır ve zaten Sentry'ye de ulaşamazlardı.
 */
export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;
  initialized = true;
  void import("@sentry/react").then((Sentry) => {
    sentry = Sentry;
    _init(Sentry, dsn);
  });
}

function _init(Sentry: SentryModule, dsn: string): void {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    // Ücretsiz katman 5k olay/ay; performans izlemeyi düşük tutuyoruz ki
    // kota gerçek hatalar için kalsın.
    tracesSampleRate: 0.05,
    // Kullanıcı verisi (e-posta, IP) varsayılan olarak GÖNDERİLMEZ — KVKK.
    sendDefaultPii: false,
    beforeSend(event) {
      istegiTemizle(event);
      izleriTemizle(event);
      return event;
    },
    /**
     * `beforeSend` YALNIZ hata olaylarına uygulanır (SDK `isErrorEvent` ile ayırır); performans/transaction
     * olayları bu kancaya düşer. `httpContext` entegrasyonu ise her olay tipinde `request.url` ve
     * `request.headers.Referer` doldurur, ayrıca segment span'ine `url.full` / `http.request.header.referer`
     * yazar. Temizlik iki kancada da çalışmazsa token'lar örneklenen transaction'larla sızardı.
     */
    beforeSendTransaction(event) {
      istegiTemizle(event);
      // Breadcrumb'lar olay tipinden bağımsız eklenir: transaction da `?token=` taşıyan xhr/gezinme izi taşır.
      izleriTemizle(event);
      spanVerisiniTemizle(event.contexts?.trace?.data);
      for (const span of event.spans ?? []) spanVerisiniTemizle(span.data);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      return yonetimTiklamasiniMaskele(breadcrumb, window.location.pathname);
    },
  });
}

/** Span/iz verisinde adres taşıyan anahtarlar — `httpContext` ve fetch/xhr izleme bunları ham yazar. */
const SPAN_ADRES_ANAHTARLARI = ["url", "http.url", "url.full", "http.query", "http.fragment", "http.request.header.referer"];

/**
 * Bir span'in (ya da kök iz bağlamının) `data` sözlüğündeki adres alanlarını temizler. `browserTracing`
 * entegrasyonu bugün kurulu değil; `tracesSampleRate` ayarı onu davet ettiği için temizlik şimdiden bağlanır.
 */
export function spanVerisiniTemizle(veri: unknown): void {
  if (!veri || typeof veri !== "object") return;
  const sozluk = veri as Record<string, unknown>;
  for (const anahtar of SPAN_ADRES_ANAHTARLARI) {
    const deger = sozluk[anahtar];
    if (typeof deger === "string") sozluk[anahtar] = stripSensitiveParams(deger);
  }
}

/**
 * Breadcrumb `data` alanlarındaki adresleri temizler. Adres taşıyan alanlar: `url` (xhr/fetch) ve
 * `from`/`to` (gezinme). Hem hata hem transaction kancasından çağrılır — breadcrumb'lar her iki olay
 * tipine de eklenir.
 */
export function izleriTemizle(event: { breadcrumbs?: { data?: Record<string, unknown> }[] }): void {
  if (!event.breadcrumbs) return;
  event.breadcrumbs = event.breadcrumbs.map((b) => {
    if (!b.data) return b;
    const veri = { ...b.data };
    let dokunuldu = false;
    for (const anahtar of ["url", "from", "to"] as const) {
      if (typeof veri[anahtar] === "string") {
        veri[anahtar] = stripSensitiveParams(veri[anahtar]);
        dokunuldu = true;
      }
    }
    return dokunuldu ? { ...b, data: veri } : b;
  });
}

/**
 * Sentry olayının `request` gövdesini temizler: adres, `Referer` başlığı ve sorgu dizesi. Hata ve
 * transaction kancalarının ORTAK yardımcısıdır — biri eklenip diğeri unutulursa sızıntı doğar.
 */
export function istegiTemizle(event: { request?: { url?: string; headers?: Record<string, unknown>; query_string?: unknown } }): void {
  const istek = event.request;
  if (!istek) return;
  // Token'lar URL'de taşınabiliyor (WebSocket query param'ı, kargo takip linki, doğrulama bağlantısı).
  if (istek.url) istek.url = stripSensitiveParams(istek.url);
  // `httpContext` `Referer`ı `document.referrer`dan doldurur; başlık adı ve sorgu biçimi SDK'ya göre değişir.
  if (istek.headers) istek.headers = refererBasliklariniTemizle(istek.headers);
  if (istek.query_string != null) istek.query_string = sorguyuTemizle(istek.query_string);
}

/** `/yonetim` ve `/yonetim-yeni` (ve alt yolları) — `/yonetimsel` gibi yalnız önek paylaşan yollar EŞLEŞMEZ. */
export function yonetimYoluMu(pathname: string): boolean {
  return /^\/yonetim(-yeni)?(\/|$)/.test(pathname);
}

/**
 * Yönetim yollarındaki tıklama izlerini PII'dan arındırır.
 *
 * Sentry'nin DOM serileştiricisi breadcrumb metnine `aria-label`, `title`, `name`, `alt` gibi öznitelikleri
 * koyar; yönetim ekranlarında bunlar aday/müşteri adı, e-posta ya da belge dosya adı taşıyabilir. Eleman
 * bazlı `aria-labelledby` düzeltmeleri ilk savunma, bu ise MERKEZİ savunmadır: yalnız `ui.click` ve yalnız
 * yönetim yollarında mesaj sabitlenir ve seçici/metin taşıyabilecek `data` alanları düşürülür.
 * Gezinme/http/hata izleri ile public sayfaların tıklama izleri OLDUĞU GİBİ kalır.
 */
export const YONETIM_TIKLAMA_MESAJI = "[yönetim etkileşimi]";
export function yonetimTiklamasiniMaskele<T extends { category?: string; message?: string; data?: Record<string, unknown> }>(
  breadcrumb: T,
  pathname: string
): T {
  // `ui.click` ve `ui.input` — ikisinin de mesajı `htmlTreeAsString` çıktısıdır (aria-label/title/name/alt taşır).
  if (!breadcrumb.category?.startsWith("ui.") || !yonetimYoluMu(pathname)) return breadcrumb;
  const { data: _dusurulen, ...kalan } = breadcrumb;
  return { ...(kalan as T), message: YONETIM_TIKLAMA_MESAJI };
}

const SENSITIVE_PARAMS = ["token", "access_token", "refresh_token", "code", "otp"];
/**
 * Yolun KENDİSİNDE yetki taşıyan public rotalar: `/kargo-takip/:token` (SMS'le paylaşılan, oturumsuz sipariş
 * erişimi) ve `/magaza/liste/:token`. Bu adreslerde sorgu maskesi hiçbir şey yakalamaz; token yol segmentidir.
 * Desenler `PATHS`ten türetilir — yeni bir `:token` rotası eklendiğinde kapsam kendiliğinden genişler.
 */
const YOL_TOKENI_DESENLERI: RegExp[] = (Object.values(PATHS) as unknown[])
  .filter((yol): yol is string => typeof yol === "string" && yol.includes("/:token"))
  .map((yol) => new RegExp(`^(${yol.slice(0, yol.indexOf(":token"))})[^/]+`));
/** S3/Azure/GCS imza alanları — YALNIZ URL'de bir imza belirteci varken temizlenir (`expires` tek başına kanıt değil). */
const S3_IMZA_PARAMS = ["signature", "awsaccesskeyid", "googleaccessid", "sig", "se", "sp", "expires"];
/** Presigned kanıtı sayılan alanlar — AWS SigV4/SigV2 yanında Azure SAS (`sig`) ve GCS (`GoogleAccessId`). */
const IMZA_BELIRTECLERI = ["x-amz-signature", "x-goog-signature", "signature", "awsaccesskeyid", "sig", "googleaccessid"];
/** İmzalı adres önekleri — AWS SigV4 ve GCS V4. */
const IMZA_ONEKLERI = ["x-amz-", "x-goog-"];
/** Presigned adreste dosya adını taşıyabilen yanıt alanları. */
const PRESIGNED_EK_PARAMS = ["response-content-disposition", "response-content-type"];
const GIZLENDI = "[gizlendi]";
/** Presigned adreslerde nesne yolu da dosya adı/klasör taşır: telemetriye giden kopyada yol maskelenir. */
export const OZEL_DOSYA_YOLU = "/[özel-dosya]";

/** İmza belirteci = presigned kanıtı. `expires` tek başına kanıt DEĞİLDİR. */
export function imzaBelirteciVarMi(adlar: string[]): boolean {
  return adlar.some((a) => IMZA_BELIRTECLERI.includes(a.toLowerCase()));
}
/** Bir sorgu anahtarı maskelenmeli mi? (`ad` büyük/küçük harf fark etmez.) */
export function hassasSorguAnahtariMi(ad: string, imzaBelirteciVar: boolean): boolean {
  const k = ad.toLowerCase();
  return (
    SENSITIVE_PARAMS.includes(k) ||
    IMZA_ONEKLERI.some((o) => k.startsWith(o)) ||
    (imzaBelirteciVar && (S3_IMZA_PARAMS.includes(k) || PRESIGNED_EK_PARAMS.includes(k)))
  );
}
/** Presigned adres mi? (Yol/parça da maskelenir.) */
export function presignedMi(adlar: string[]): boolean {
  return imzaBelirteciVarMi(adlar) || adlar.some((a) => IMZA_ONEKLERI.some((o) => a.toLowerCase().startsWith(o)));
}

/**
 * Sentry `request.headers` içinden YALNIZ `referer`/`referrer` başlıklarını (her harf varyasyonunda)
 * temizler; diğer başlıklar ve özgün anahtar yazımı korunur.
 */
export function refererBasliklariniTemizle<T extends Record<string, unknown>>(headers: T): T {
  let dokunuldu = false;
  const cikti: Record<string, unknown> = { ...headers };
  for (const [anahtar, deger] of Object.entries(headers)) {
    const ad = anahtar.toLowerCase();
    if (ad !== "referer" && ad !== "referrer") continue;
    // Dize dışı bir değer (dizi ya da beklenmedik tip) fail-open bırakılmaz: okumadan maskelenir.
    const temiz =
      typeof deger === "string"
        ? stripSensitiveParams(deger)
        : Array.isArray(deger)
          ? deger.map((d) => (typeof d === "string" ? stripSensitiveParams(d) : GIZLENDI))
          : deger == null
            ? deger
            : GIZLENDI;
    if (temiz !== deger) {
      cikti[anahtar] = temiz;
      dokunuldu = true;
    }
  }
  return dokunuldu ? (cikti as T) : headers;
}

/** Bir sorgu değerini (dize, dizi ya da bilinmeyen tip) maskeler — değer asla `String(...)` ile açılmaz. */
function degeriMaskele(deger: unknown): unknown {
  return Array.isArray(deger) ? deger.map(() => GIZLENDI) : GIZLENDI;
}

/**
 * Sentry `request.query_string` üç biçimde gelebilir: dize (`"a=1"` ya da `"?a=1"`), kayıt nesnesi ve
 * `[ad, değer]` çiftleri dizisi. Üçünde de hassas anahtarlar büyük/küçük harf bağımsız maskelenir;
 * zararsız alanların değerleri ve veri YAPISI korunur.
 */
export function sorguyuTemizle(query: unknown): unknown {
  if (typeof query === "string") {
    const soruIsaretli = query.startsWith("?");
    // Ayrıştırma için tek bir `?` ile normalleştirilir; çıktı girdinin biçimini korur (çift `??` üretmez).
    const temiz = stripSensitiveParams(`https://x.invalid/?${soruIsaretli ? query.slice(1) : query}`);
    const sorgu = temiz.includes("?") ? temiz.slice(temiz.indexOf("?") + 1) : "";
    return soruIsaretli ? `?${sorgu}` : sorgu;
  }
  if (Array.isArray(query)) {
    const adlar = query.map((c) => (Array.isArray(c) ? String(c[0] ?? "") : ""));
    const imza = imzaBelirteciVarMi(adlar);
    return query.map((cift) =>
      Array.isArray(cift) && hassasSorguAnahtariMi(String(cift[0] ?? ""), imza) ? [cift[0], degeriMaskele(cift[1])] : cift,
    );
  }
  if (query && typeof query === "object") {
    const kayit = query as Record<string, unknown>;
    const adlar = Object.keys(kayit);
    const imza = imzaBelirteciVarMi(adlar);
    let dokunuldu = false;
    const cikti: Record<string, unknown> = { ...kayit };
    for (const ad of adlar) {
      if (hassasSorguAnahtariMi(ad, imza)) {
        cikti[ad] = degeriMaskele(kayit[ad]);
        dokunuldu = true;
      }
    }
    return dokunuldu ? cikti : query;
  }
  return query;
}

/**
 * Telemetriye (Sentry) giden adreslerden hassas alanları maskeler.
 *
 * İki aile:
 *  - Oturum/doğrulama belirteçleri (`token`, `code`, `otp` …) — WebSocket query'si, kargo takip ve doğrulama
 *    bağlantıları bunları URL'de taşıyabiliyor.
 *  - Presigned (imzalı) özel dosya adresleri — `X-Amz-*` ailesi ve S3 uyumlu `Signature`/`AWSAccessKeyId`.
 *    Bunlarda yalnız query değil NESNE YOLU da hassastır (aday belgesinin dosya adı): yol da maskelenir.
 *
 * Parametre adları büyük/küçük harften bağımsız eşleşir. Sıradan bir `?expires=` (sayfalama/uygulama alanı)
 * tek başına maskelenmez — yalnız yanında bir imza belirteci varken.
 *
 * Dönen değer YALNIZ telemetri kopyasıdır; kullanıcının gerçek bağlantısı değişmez.
 */
export function stripSensitiveParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const anahtarlar = [...url.searchParams.keys()];
    const imzaBelirteciVar = imzaBelirteciVarMi(anahtarlar);
    const presigned = presignedMi(anahtarlar);
    let touched = false;
    // URL içi kimlik bilgisi (`user:pass@host`) her koşulda düşer: adres telemetriye giderken kimlik taşımamalı.
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      touched = true;
    }
    for (const desen of YOL_TOKENI_DESENLERI) {
      const maskeli = url.pathname.replace(desen, `$1${GIZLENDI}`);
      if (maskeli !== url.pathname) {
        url.pathname = maskeli;
        touched = true;
      }
    }
    for (const key of anahtarlar) {
      if (hassasSorguAnahtariMi(key, imzaBelirteciVar)) {
        url.searchParams.set(key, GIZLENDI);
        touched = true;
      }
    }
    if (presigned) {
      // Host/protokol kalır (hangi depo olduğu teknik olarak yararlı); nesne anahtarı ve dosya adı kalmaz.
      url.pathname = OZEL_DOSYA_YOLU;
      // Parça (fragment) da dosya adı taşıyabilir; imzalı adreste hiçbir yol bilgisi bırakılmaz.
      url.hash = "";
      touched = true;
    }
    if (!touched) return rawUrl;
    // Göreli girdi göreli döner: `from`/`to` gezinme izleri gereksizce mutlak adrese dönüşmesin.
    return /^[a-z][a-z0-9+.-]*:|^\/\//i.test(rawUrl) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Ayrıştırılamayan girdi (ör. `window` olmayan bağlam): fail-open değil, kaba filtreyle son çare.
    return /(token|otp|signature|awsaccesskeyid|googleaccessid|x-amz-|x-goog-|[?&](sig|code)=|\/kargo-takip\/)/i.test(rawUrl)
      ? "[gizlendi-url]"
      : rawUrl;
  }
}

/** Yakalanan bir hatayı raporlar (DSN yoksa no-op). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  // SDK henüz yüklenmemişse (veya DSN yoksa) sessizce geç: hata raporlamanın
  // kendisi uygulamayı düşürmemeli.
  sentry?.captureException(error, context ? { extra: context } : undefined);
}
