import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { addBookmark } from "@/api/bookmarks";
import { addLibraryBookmark } from "@/api/libraryBookmarks";
import { niyetiAl } from "@/lib/bekleyenNiyet";
import { alisverisYapabilir } from "@/lib/roles";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

/**
 * Giriş tamamlanınca GLOBAL niyetleri uygular (App'te mount).
 *
 * Buraya yalnız kendi UI yüzeyi olmayan, saf API çağrısına inen niyetler
 * girer — bugün tek örnek `favori`. "Ders talebi" ya da "kütüphane
 * rezervasyonu" *"şu sayfanın penceresini aç"* demektir; onlar kendi
 * sayfalarında `useBekleyenNiyet` ile tüketilir.
 *
 * ## `niyetiAl("favori")` — tip kapsamı KRİTİK
 *
 * Koşulsuz tüketen bir uygulayıcı, sayfanın beklettiği niyeti yerdi:
 * kullanıcı "Ders Talep Et"e basar, giriş yapar, hiçbir şey olmaz, hata da
 * görünmez. ÜK-6'da ölçülen sessiz kaybın birebir tekrarı.
 *
 * Bugün tek global tip olduğu için gövde `switch`siz. İkinci bir global niyet
 * eklendiğinde `niyetiAl("favori", "yeni")` yazılacak, dönen tip birleşime
 * dönüşecek ve `niyet.hedef` erişimi DERLEME hatası verecek — yeni dalı
 * yazmayı unutmak imkânsız.
 *
 * Alışveriş rollerinde (üye + eğitmen) çalışır — ÜK-6. Eğitmen kapısı
 * unutulursa kusur SESSİZ olur: niyet tüketilmiştir, kalp dolmaz ve kullanıcı
 * neden olmadığını göremez. Admin/operatör/kuryede niyet düşer (sunucu 403
 * dönerdi).
 *
 * PUT uçları idempotent — zaten favorideyse sorun çıkmaz.
 */
export function NiyetUygulayici() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const niyet = niyetiAl("favori"); // yalnız `favori`yi tüketir
    if (!niyet || !alisverisYapabilir(user.role_id)) return;

    void (async () => {
      try {
        if (niyet.hedef === "egitmen") {
          await addBookmark(niyet.id);
          await queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
        } else {
          await addLibraryBookmark(niyet.id);
          await queryClient.invalidateQueries({
            queryKey: ["library-bookmarks"],
          });
        }
        toast.success("Favorilere eklendi");
      } catch {
        /* best-effort: uygulanamazsa kullanıcı kalbe yeniden tıklayabilir */
      }
    })();
  }, [user, queryClient]);

  return null;
}
