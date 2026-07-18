import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

// Tüm roller kök (`/`) workspace'inden başlar; `RootDispatcher` orada role göre
// uygun ekranı (Admin/Tutor dashboard ya da öğrenci keşif Landing'i) render eder.
export function roleHome(roleId: number | null | undefined): string {
  switch (roleId) {
    case ROLE_IDS.ADMIN:
    case ROLE_IDS.TUTOR:
    case ROLE_IDS.CLIENT:
    case ROLE_IDS.LIBRARY_OPERATOR:
    case ROLE_IDS.COURIER:
      return ROUTES.home;
    default:
      return ROUTES.login;
  }
}
