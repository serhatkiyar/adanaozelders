import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addBookmark } from "@/api/bookmarks";
import { addLibraryBookmark } from "@/api/libraryBookmarks";
import { takePendingFavorite } from "@/lib/pendingFavorite";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";

/** Anonim tıklanan kalbin niyetini giriş tamamlanınca uygular (App'te mount).
 * Yalnız CLIENT'ta çalışır; eğitmen/admin girişinde niyet sessizce düşer.
 * PUT uçları idempotent — zaten favorideyse sorun çıkmaz. */
export function PendingFavoriteApplier() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const pending = takePendingFavorite(); // tek kullanımlık — burada tüketilir
    if (!pending || user.role_id !== ROLE_IDS.CLIENT) return;

    void (async () => {
      try {
        if (pending.type === "tutor") {
          await addBookmark(pending.id);
          await queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
        } else {
          await addLibraryBookmark(pending.id);
          await queryClient.invalidateQueries({ queryKey: ["library-bookmarks"] });
        }
        toast.success("Favorilere eklendi");
      } catch {
        /* best-effort: uygulanamazsa kullanıcı kalbe yeniden tıklayabilir */
      }
    })();
  }, [user, queryClient]);

  return null;
}
