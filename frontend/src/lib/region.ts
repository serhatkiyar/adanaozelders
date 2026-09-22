const COUNTRY_LABELS = new Set(["türkiye", "turkey"]);

/** Uzun adresten kısa "bölge" etiketi türetir (kart/hero için).
 *
 * Adres genelde geocode'dan (Nominatim/Google) küçükten büyüğe gelir:
 * "Reşatbey, Çukurova, Adana, 01170, Türkiye". Posta kodu + ülke atılır, son iki
 * anlamlı parça (ilçe, il) alınıp **il önce** gelecek şekilde birleştirilir →
 * "Adana · Çukurova". Çözümlenemezse null. Saf fonksiyon (Vitest'li). */
export function shortRegion(address?: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !/^\d+$/.test(p)) // posta kodu vb. salt sayıyı at
    .filter((p) => !COUNTRY_LABELS.has(p.toLocaleLowerCase("tr")));

  if (parts.length === 0) return null;
  const lastTwo = parts.slice(-2);
  if (lastTwo.length === 2) lastTwo.reverse(); // il · ilçe
  return lastTwo.join(" · ");
}

/** Kart/hero kısa bölge etiketi. Yapısal il/ilçe varsa "İl · İlçe"; yoksa eski
 * kayıtlar için tam adresten türetir (shortRegion). Hiçbiri yoksa null. */
export function regionLabel(
  city?: string | null,
  district?: string | null,
  fallbackAddress?: string | null
): string | null {
  const structured = [city, district]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" · ");
  return structured || shortRegion(fallbackAddress);
}
