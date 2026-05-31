import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

// role_id'ye göre asimetrik ana sayfa yönlendirmesi.
// Admin/Tutor nötr panele; öğrenci ise giriş sonrası landing (ana keşif
// ekranı: arama + kategoriler + son görüntülenen ilanlar) görür.
export function roleHome(roleId: number | null | undefined): string {
  switch (roleId) {
    case ROLE_IDS.ADMIN:
      return ROUTES.panel;
    case ROLE_IDS.TUTOR:
      return ROUTES.panel;
    case ROLE_IDS.CLIENT:
      return ROUTES.home;
    default:
      return ROUTES.login;
  }
}
