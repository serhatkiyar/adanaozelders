// Google encoded polyline (precision 5) çözücü — VROOM/OSRM rota geometrisi
// için. Bağımlılık eklemeye değmeyecek kadar küçük; saf ve Vitest'li.

/** Encoded polyline5 → [lat, lng] listesi. Geçersiz girdide o ana kadarki
 *  noktaları döner (kısmi çizim, patlama yok). */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) return points;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Saniyeyi "1 sa 25 dk" / "45 dk" biçiminde yazar. */
export function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} dk`;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

/** ETA'yı yerel saat "14:32" olarak yazar. */
export function formatEta(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
