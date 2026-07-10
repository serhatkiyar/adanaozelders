/** Anonim ziyaretçinin favori niyeti — kalbe tıklayınca giriş modalı açılır,
 * niyet sessionStorage'da bekler; giriş tamamlanınca uygulanır (PendingFavoriteApplier).
 * sessionStorage bilinçli: niyet sekmeyle birlikte ölür, hesaplar arası taşınmaz. */

export type PendingFavorite = { type: "tutor" | "library"; id: number };

const KEY = "pending_favorite";

export function setPendingFavorite(p: PendingFavorite): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage kapalıysa (gizli mod vb.) niyetsiz devam — giriş yine açılır */
  }
}

/** Oku ve TEMİZLE (tek kullanımlık). Bozuk/eksik kayıtta null. */
export function takePendingFavorite(): PendingFavorite | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw == null) return null;
    sessionStorage.removeItem(KEY);
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ((parsed as PendingFavorite).type === "tutor" ||
        (parsed as PendingFavorite).type === "library") &&
      typeof (parsed as PendingFavorite).id === "number"
    ) {
      return parsed as PendingFavorite;
    }
    return null;
  } catch {
    return null;
  }
}
