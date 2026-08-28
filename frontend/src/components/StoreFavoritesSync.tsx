import { useEffect, useRef } from "react";
import { listFavorites, addFavorite } from "@/api/store";
import { useAuthStore } from "@/store/authStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { alisverisYapabilir } from "@/lib/roles";

/** Girişte mağaza favorilerini sunucuyla birleştirir (App'te mount).
 * Anonimken kalplenenler sunucuya itilir, sunucudakiler yerele indirilir —
 * cihazlar arası tek liste. Kullanıcı başına bir kez çalışır (oturum boyunca). */
export function StoreFavoritesSync() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const syncedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!token || !user || !alisverisYapabilir(user.role_id)) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current === user.id) return;
    syncedFor.current = user.id;

    void (async () => {
      try {
        const server = await listFavorites();
        const local = useFavoritesStore.getState().items;
        const serverIds = new Set(server.map((p) => p.id));
        const localOnly = local.filter((p) => !serverIds.has(p.id));
        // Anonimken eklenenleri hesaba taşı (PUT idempotent, best-effort).
        await Promise.allSettled(localOnly.map((p) => addFavorite(p.id)));
        useFavoritesStore.getState().setAll([...localOnly, ...server]);
      } catch {
        /* offline vb. — yerel liste olduğu gibi kalır, sonraki girişte dener */
      }
    })();
  }, [token, user]);

  return null;
}
