import { useAuthStore } from "@/store/authStore";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import TutorProfile from "@/pages/TutorProfile";

// Tek kanonik eğitmen profili (/egitmenler/:slug). Oturuma göre shell seçer:
//  • anonim    → public profil (kayıt/giriş CTA'lı)
//  • giriş'li  → panel chrome + rezervasyon/mesaj akışı
export default function TutorProfilePage() {
  const token = useAuthStore((s) => s.token);
  return token ? <TutorProfile /> : <PublicTutorProfile />;
}
