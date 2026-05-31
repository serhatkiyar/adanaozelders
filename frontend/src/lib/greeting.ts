// Günün saatine göre Türkçe selamlama + ad yardımcıları.
// Hem giriş "hoş geldin" toast'ında hem landing kişisel hero'sunda kullanılır.

export function timeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return "İyi geceler";
  if (h < 12) return "Günaydın";
  if (h < 18) return "İyi günler";
  return "İyi akşamlar";
}

export function firstNameOf(fullName?: string | null): string {
  return (fullName ?? "").trim().split(/\s+/)[0] || "";
}

// Bu cihazda daha önce karşılanan kullanıcı id'leri — "ilk kez mi giriyor?"
// ayrımı için. İlk girişte "Aramıza hoş geldin", sonrakilerde "Tekrar hoş geldin".
const GREETED_KEY = "greeted_user_ids";

function readGreeted(): number[] {
  try {
    const raw = localStorage.getItem(GREETED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isFirstGreeting(userId: number): boolean {
  return !readGreeted().includes(userId);
}

export function markGreeted(userId: number): void {
  try {
    const ids = readGreeted();
    if (!ids.includes(userId)) {
      ids.push(userId);
      localStorage.setItem(GREETED_KEY, JSON.stringify(ids));
    }
  } catch {
    // storage erişilemez — sessizce geç.
  }
}

// Girişte gösterilecek tam karşılama metni (saat + ad + ilk/tekrar).
export function buildWelcome(userId: number, fullName?: string | null): string {
  const first = isFirstGreeting(userId);
  markGreeted(userId);
  const tail = first ? "Aramıza hoş geldin." : "Tekrar hoş geldin.";
  return `${timeGreeting()}, ${firstNameOf(fullName)}! ${tail}`;
}
