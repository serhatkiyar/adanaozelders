import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addBookmark } from "@/api/bookmarks";
import { addLibraryBookmark } from "@/api/libraryBookmarks";
import { takePendingFavorite } from "@/lib/pendingFavorite";
import { alisverisYapabilir } from "@/lib/roles";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

/** Anonim tıklanan kalbin niyetini giriş tamamlanınca uygular (App'te mount).
 *
 * Alışveriş rollerinde (üye + eğitmen) çalışır — ÜK-6. Eğitmen kapısı
 * unutulursa kusur SESSİZ olur: niyet `takePendingFavorite` ile zaten
 * tüketilmiştir, kalp dolmaz ve kullanıcı neden olmadığını göremez.
 * Admin/operatör/kuryede niyet düşer (sunucu 403 dönerdi).
 *
 * PUT uçları idempotent — zaten favorideyse sorun çıkmaz. */
export function PendingFavoriteApplier() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const pending = takePendingFavorite(); // tek kullanımlık — burada tüketilir
    if (!pending || !alisverisYapabilir(user.role_id)) return;

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
