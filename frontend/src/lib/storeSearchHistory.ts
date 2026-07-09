// Mağaza arama geçmişi (localStorage). Kullanıcı bir metin araması yürüttüğünde
// terim saklanır; arama çubuğu boşken tekrar odaklanınca "Son aramalar" gösterilir.
// Dedupe (tr, büyük/küçük duyarsız) + en yeni başta + kapak (MAX).

const KEY = "store_search_history";
const MAX = 8;

/** (saf) Yeni terimi geçmişin başına ekler, tekrarı temizler, MAX'e kırpar. */
export function mergeSearchHistory(
  history: string[],
  term: string,
  max = MAX
): string[] {
  const t = term.trim();
  if (!t) return history.slice(0, max);
  const lower = t.toLocaleLowerCase("tr");
  return [t, ...history.filter((x) => x.toLocaleLowerCase("tr") !== lower)].slice(0, max);
}

function save(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* localStorage yoksa/dolu ise sessizce geç */
  }
}

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addSearchHistory(term: string): string[] {
  const next = mergeSearchHistory(getSearchHistory(), term);
  save(next);
  return next;
}

export function removeSearchHistory(term: string): string[] {
  const next = getSearchHistory().filter((x) => x !== term);
  save(next);
  return next;
}

export function clearSearchHistory(): string[] {
  save([]);
  return [];
}
