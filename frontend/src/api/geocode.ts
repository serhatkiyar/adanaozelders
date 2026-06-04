import { apiClient } from "@/api/axios";

/**
 * Adres arama / geocode — backend proxy (`/geocode/*`) üzerinden.
 * Anahtar sunucuda durur; sağlayıcı (Google Places New / Nominatim) backend'de seçilir.
 * Çağrılar typeahead/seçim gibi imperatif olduğundan react-query yerine doğrudan
 * axios instance ile yapılır (kural: API çağrıları axios instance üzerinden).
 */

export interface GeocodeSuggestion {
  id: string;
  label: string;
  /** Yalnız Nominatim fallback'inde dolu; Google'da null → details çağrısı gerekir. */
  lat: number | null;
  lng: number | null;
}

export interface GeocodeDetails {
  lat: number;
  lng: number;
  address: string;
}

/** Yeni bir autocomplete oturum token'ı üret (Google maliyetini tek oturumda toplar). */
export function newGeocodeSession(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function geocodeAutocomplete(
  q: string,
  session?: string,
): Promise<GeocodeSuggestion[]> {
  const { data } = await apiClient.get<GeocodeSuggestion[]>("/geocode/autocomplete", {
    params: { q, session },
  });
  return data;
}

export async function geocodeDetails(
  placeId: string,
  session?: string,
): Promise<GeocodeDetails> {
  const { data } = await apiClient.get<GeocodeDetails>("/geocode/details", {
    params: { place_id: placeId, session },
  });
  return data;
}

/** Serbest metin ("Ara"/Enter) → tek en iyi koordinat (Geocoding). Kapı no'lu
 *  sokak adresleri için; bulunamazsa null. */
export async function geocodeForward(q: string): Promise<GeocodeDetails | null> {
  try {
    const { data } = await apiClient.get<GeocodeDetails>("/geocode/forward", {
      params: { q },
    });
    return data;
  } catch {
    return null;
  }
}

export async function geocodeReverse(lat: number, lng: number): Promise<string | null> {
  const { data } = await apiClient.get<{ address: string | null }>("/geocode/reverse", {
    params: { lat, lng },
  });
  return data?.address ?? null;
}
