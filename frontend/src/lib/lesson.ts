// Canlı ders odası — Jitsi (API/hesap gerekmez).
export function jitsiUrl(room: string): string {
  return `https://meet.jit.si/${encodeURIComponent(room)}`;
}

// Yüzyüze ders adresini Google Haritalar'da açar (API anahtarı gerekmez).
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Derse katılım, ders saatinden 15 dk önce açılır, bitişten 30 dk sonra kapanır.
export function isLessonJoinable(startIso: string, endIso: string): boolean {
  const now = Date.now();
  const open = new Date(startIso).getTime() - 15 * 60 * 1000;
  const close = new Date(endIso).getTime() + 30 * 60 * 1000;
  return now >= open && now <= close;
}
