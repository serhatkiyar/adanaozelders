import { useAuthStore } from "@/store/authStore";
import PublicMarketplace from "@/pages/PublicMarketplace";
import Marketplace from "@/pages/Marketplace";

// Tek kanonik eğitmen arama/listeleme (/egitmenler). Oturuma göre shell seçer:
//  • anonim   → public marketplace (kayıt CTA'lı)
//  • giriş'li → panel chrome'lu marketplace (rol bazlı nav)
export default function MarketplacePage() {
  const token = useAuthStore((s) => s.token);
  return token ? <Marketplace /> : <PublicMarketplace />;
}
