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

// Returns a Tabler icon class name for the given amenity slug
export function amenityTiClass(slug: string): string {
  const tablerMap: Record<string, string> = {
    wifi: "wifi",
    sessiz_alan: "volume-off",
    grup_calisma: "users",
    bireysel_kabin: "user",
    kafeterya: "coffee",
    otopark: "car",
    priz: "plug",
    klima: "snowflake",
    yemekhane: "restaurant",
    kutuphane: "books",
    "7_24": "clock",
    fotokopi: "printer",
    erisilebilir: "accessibility",
  };
  const base = tablerMap[slug] ?? slug.replace(/_/g, "-");
  return `ti ti-${base}`;

}
