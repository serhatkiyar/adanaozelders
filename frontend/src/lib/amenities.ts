// Kütüphane olanak (amenity) etiketleri — slug ↔ okunur Türkçe + emoji.
export const AMENITY_LABELS: Record<string, { label: string; icon: string }> = {
  wifi: { label: "Wi-Fi", icon: "📶" },
  sessiz_alan: { label: "Sessiz Alan", icon: "🤫" },
  grup_calisma: { label: "Grup Çalışma", icon: "👥" },
  bireysel_kabin: { label: "Bireysel Kabin", icon: "🪑" },
  kafeterya: { label: "Kafeterya", icon: "☕" },
  otopark: { label: "Otopark", icon: "🅿️" },
  priz: { label: "Priz / Şarj", icon: "🔌" },
  klima: { label: "Klima", icon: "❄️" },
  yemekhane: { label: "Yemekhane", icon: "🍽️" },
  kutuphane: { label: "Kitaplık", icon: "📚" },
  "7_24": { label: "7/24 Açık", icon: "🌙" },
};

export const AMENITY_OPTIONS = Object.keys(AMENITY_LABELS);

export function amenityLabel(slug: string): string {
  return AMENITY_LABELS[slug]?.label ?? slug;
}

export function amenityIcon(slug: string): string {
  return AMENITY_LABELS[slug]?.icon ?? "•";
}
