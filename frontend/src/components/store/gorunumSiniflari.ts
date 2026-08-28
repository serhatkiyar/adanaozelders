/**
 * ── Küratörlü görünüm preset'leri: enum → Tailwind sınıfı (TEK doğruluk kaynağı) ──
 *
 * Backend allowlist'iyle sözleşme: `services/store_merchandising_puck.py::
 * GORUNUM_SECENEKLERI`. Editör canvas'ı ve public render AYNI haritayı
 * kullanır; `gorunum` yokken dönen varsayılanlar bugünkü görünümü birebir
 * verir — eski kayıtlar piksel piksel aynı kalır.
 *
 * Serbest renk/px bilinçli YOK (kilitli karar): editör markanın ölçülmüş
 * kontrast/boşluk garantilerini bozamaz; seçenekler bu dosyada büyür.
 */

export interface BlokGorunumu {
  hiza?: "sol" | "orta";
  zemin?: "beyaz" | "yumusak" | "vurgu";
  bosluk?: "dar" | "normal" | "genis";
  /** Yalnız IMAGE_CARD_GRID. */
  kolon?: "2" | "3" | "4";
  /** Yalnız BANNER. */
  boy?: "ince" | "normal";
}

export function gorunumOku(config: Record<string, unknown>): BlokGorunumu {
  const raw = config?.gorunum;
  return raw && typeof raw === "object" ? (raw as BlokGorunumu) : {};
}

/** Bölüm sarmalayıcısı: zemin + EK dikey boşluk. Varsayılan (ayar yok) = boş
 *  sınıf → bugünkü görünüm birebir. "dar" da bilinçli olarak boş: bloklar
 *  arası ritim zaten sayfa kabuğundan gelir, dar = ek boşluk yok demektir. */
export function bolumSinifi(g: BlokGorunumu): string {
  const zemin =
    g.zemin === "yumusak" ? "bg-slate-50" : g.zemin === "vurgu" ? "bg-indigo-50/60" : "";
  const bosluk = g.bosluk === "normal" ? "py-4" : g.bosluk === "genis" ? "py-10" : "";
  return `${zemin} ${bosluk}`.trim();
}

/** Bölüm başlığı/açıklaması hizası. */
export function hizaSinifi(g: BlokGorunumu): string {
  return g.hiza === "orta" ? "text-center" : "";
}

/** IMAGE_CARD_GRID kolon sayısı (masaüstü). Varsayılan bugünkü 4'lü ızgara. */
export function kolonSinifi(g: BlokGorunumu): string {
  if (g.kolon === "2") return "grid-cols-2 md:grid-cols-2";
  if (g.kolon === "3") return "grid-cols-2 md:grid-cols-3";
  return "grid-cols-2 md:grid-cols-4";
}

/** BANNER yüksekliği. Varsayılan bugünkü 520px tavan. */
export function bannerBoySinifi(g: BlokGorunumu): string {
  return g.boy === "ince" ? "max-h-[280px]" : "max-h-[520px]";
}

/**
 * Zengin metin tipografisi (RICH_TEXT `content_html`). Sunucuda sanitize
 * edilmiş HTML'e uygulanır; inline `text-align` stili sanitizer'dan geçer ve
 * burada ezilmez.
 */
export const ZENGIN_METIN_SINIFI = [
  "mt-3 text-[15px] leading-relaxed text-slate-600",
  "[&_p]:mt-3 [&_p:first-child]:mt-0",
  "[&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-slate-900",
  "[&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-900",
  "[&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-slate-900",
  "[&_a]:font-medium [&_a]:text-slate-900 [&_a]:underline [&_a]:underline-offset-2",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1",
  "[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic",
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]",
  "[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-6 [&_hr]:border-slate-200",
].join(" ");
