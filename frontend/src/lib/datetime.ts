const dtf = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const tf = new Intl.DateTimeFormat("tr-TR", { timeStyle: "short" });

const df = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDf = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
});

// ISO string -> "20 Mart 2026"
export function formatDate(iso: string): string {
  return df.format(new Date(iso));
}

// ISO string -> "25 May 2026 14:30"
export function formatDateTime(iso: string): string {
  return dtf.format(new Date(iso));
}

// Aralık: "25 May 2026 14:30 – 15:30"
export function formatRange(startIso: string, endIso: string): string {
  return `${dtf.format(new Date(startIso))} – ${tf.format(new Date(endIso))}`;
}

// datetime-local input ("YYYY-MM-DDTHH:mm") -> timezone-aware ISO (UTC, "Z").
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

// ── Türkiye saati (sabit UTC+3, DST yok — backend APP_UTC_OFFSET_HOURS=3) ──
// Rezervasyon saatleri TARAYICI saat diliminden BAĞIMSIZ olarak Türkiye duvar-saati
// kabul edilir. Böylece backend'in sabit UTC+3 müsaitlik kontrolüyle birebir uyumludur
// ve UTC+3 olmayan tarayıcılarda saat kayması olmaz.

// "YYYY-MM-DDTHH:mm" (Türkiye duvar-saati) -> UTC ISO ("Z"). Tarayıcı tz'inden bağımsız.
export function istanbulInputToIso(value: string): string {
  return new Date(`${value}:00+03:00`).toISOString();
}

// Şu anın Türkiye saatiyle "YYYY-MM-DD" tarihi + saat/dakika (geçmiş kontrolleri için).
export function istanbulNow(): { dateStr: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // bazı motorlarda gece yarısı 24 döner
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute: parseInt(get("minute"), 10),
  };
}

// Türkiye duvar-saati "HH:MM". Kütüphane/operatör yüzeylerinde randevu saati
// TARAYICI saatinden bağımsız olmalıdır: tz'i UTC olan bir cihazda 14:00'lık
// rezervasyon "11:00" görünürse operatör kapıda yanlış saati söyler.
const istanbulTf = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatIstanbulTime(iso: string): string {
  return istanbulTf.format(new Date(iso));
}

// Türkiye tarihi: "17 Eylül Perşembe" — tarayıcı saat diliminden bağımsız.
const istanbulGunDf = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "numeric",
  month: "long",
  weekday: "long",
});

export function formatIstanbulDay(iso: string): string {
  return istanbulGunDf.format(new Date(iso));
}

// Sohbet listesi için kısa zaman: bugünse "14:30", değilse "20 Mar".
export function formatChatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? tf.format(d) : shortDf.format(d);
}

// Ortalama yanıt süresi: saniye -> "~5 dk", "~2 saat", "~3 gün" (yaklaşık).
// Çok kısa süreler "~1 dk"ya yuvarlanır; null/negatif/geçersizde "—".
export function formatResponseTime(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 3600) return `~${Math.max(1, Math.round(seconds / 60))} dk`;
  if (seconds < 86_400) return `~${Math.round(seconds / 3600)} saat`;
  return `~${Math.round(seconds / 86_400)} gün`;
}

// Son görülme: ISO -> "az önce", "5 dk önce", "2 saat önce", "3 gün önce", sonra tarih.
export function formatLastSeen(iso?: string | null): string {
  if (!iso) return "Hiç görülmedi";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 90) return "az önce aktifti";
  if (sec < 3600) return `${Math.floor(sec / 60)} dk önce aktifti`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} saat önce aktifti`;
  if (sec < 7 * 86_400) return `${Math.floor(sec / 86_400)} gün önce aktifti`;
  return `son görülme ${formatDate(iso)}`;
}
