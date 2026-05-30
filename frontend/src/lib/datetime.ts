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

// Sohbet listesi için kısa zaman: bugünse "14:30", değilse "20 Mar".
export function formatChatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? tf.format(d) : shortDf.format(d);
}

// Son görülme: ISO -> "az önce", "5 dk önce", "2 saat önce", "3 gün önce", sonra tarih.
export function formatLastSeen(iso?: string | null): string {
  if (!iso) return "Hiç görülmedi";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 90) return "az önce aktifti";
  if (sec < 3600) return `${Math.floor(sec / 60)} dk önce aktifti`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} saat önce aktifti`;
  if (sec < 7 * 86_400) return `${Math.floor(sec / 86_400)} gün önce aktifti`;
  return `son görülme ${formatDate(iso)}`;
}
