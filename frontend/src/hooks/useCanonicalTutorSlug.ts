import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ilanYolu } from "@/lib/routes";

/**
 * Eğitmen sayfası kanonik adreste değilse oraya `replace` ile geçer.
 *
 * Kanonik adres `ilanYolu`dur: ilan yayına girmişse kök ilan adresi
 * (`/lgs-yks-matematik-seyhan`, Modül 6), girmemişse eski
 * `/egitmenler/<isim-id>`. Eski adresten (`/egitmenler/dilan-4`,
 * `/egitmenler/4`) gelen kullanıcı ve paylaşılmış bağlantı yeni adrese
 * taşınır; sorgu dizesi korunur. Üretimde aynı yönlendirmeyi sunucu 301 ile
 * zaten yapar (`backend/services/on_cizim.py`); bu kanca SPA içi gezinme ve
 * yerel geliştirme içindir.
 */
export function useCanonicalTutorSlug(
  tutor: { id: number; slug?: string | null; url_slug?: string | null } | undefined
) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!tutor) return;
    const hedef = ilanYolu(tutor);
    if (pathname !== hedef) navigate(hedef + search, { replace: true });
  }, [tutor, pathname, search, navigate]);
}
