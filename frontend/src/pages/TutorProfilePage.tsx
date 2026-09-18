import { useAuthStore } from "@/store/authStore";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import TutorProfile from "@/pages/TutorProfile";
import type { IlanSayfasiVerisi } from "@/api/seo";

// Tek eğitmen profili. İki adresten açılır:
//  • kök ilan adresi (`/lgs-yks-matematik-seyhan`, Modül 6) — `KokAdres`
//    sunucunun çözdüğü `tutorId` + SEO verisini verir;
//  • eski `/egitmenler/:slug` — id slug'dan çözülür, ilan adresi varsa sayfa
//    oraya `replace` ile geçer (`useCanonicalTutorSlug`).
// Oturuma göre shell seçer:
//  • anonim    → public profil (kayıt/giriş CTA'lı)
//  • giriş'li  → panel chrome + rezervasyon/mesaj akışı
export default function TutorProfilePage({
  tutorId,
  ilanSeo,
}: {
  tutorId?: number;
  ilanSeo?: IlanSayfasiVerisi;
} = {}) {
  const token = useAuthStore((s) => s.token);
  return token ? (
    <TutorProfile tutorId={tutorId} ilanSeo={ilanSeo} />
  ) : (
    <PublicTutorProfile tutorId={tutorId} ilanSeo={ilanSeo} />
  );
}
