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
import * as Sentry from "@sentry/react";

let initialized = false;

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    // Ücretsiz katman 5k olay/ay; performans izlemeyi düşük tutuyoruz ki
    // kota gerçek hatalar için kalsın.
    tracesSampleRate: 0.05,
    // Kullanıcı verisi (e-posta, IP) varsayılan olarak GÖNDERİLMEZ — KVKK.
    sendDefaultPii: false,
    beforeSend(event) {
      // Token'lar URL'de taşınabiliyor (WebSocket query param'ı, kargo takip
      // linki). Sentry'ye giden adreslerden bunları ayıklıyoruz.
      if (event.request?.url) {
        event.request.url = stripSensitiveParams(event.request.url);
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) =>
          b.data?.url
            ? { ...b, data: { ...b.data, url: stripSensitiveParams(String(b.data.url)) } }
            : b
        );
      }
      return event;
    },
  });
  initialized = true;
}

const SENSITIVE_PARAMS = ["token", "access_token", "refresh_token", "code", "otp"];

/** URL'deki hassas query parametrelerini maskeler. */
export function stripSensitiveParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    let touched = false;
    for (const key of SENSITIVE_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[gizlendi]");
        touched = true;
      }
    }
    return touched ? url.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}

/** Yakalanan bir hatayı raporlar (DSN yoksa no-op). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
