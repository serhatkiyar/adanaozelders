import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

// Mağazada ALICI olabilen roller. Eğitmen kendi oturumuyla alışveriş yapar;
// backend onu bir `Client` yansımasına ("gölge") çevirir — bkz.
// docs/egitmen-alici-sozlesme.md. Bu liste TEK KAYNAKTIR: alıcı yüzeylerinde
// çıplak `role_id === ROLE_IDS.CLIENT` karşılaştırması yapılmaz.
//
// Kapsam yalnız MAĞAZADIR: ders rezervasyonu, kütüphane ve talepler hâlâ
// öğrenciye özeldir ve bu yardımcıyı kullanmaz.
export const ALISVERIS_ROLLERI: readonly number[] = [
  ROLE_IDS.CLIENT,
  ROLE_IDS.TUTOR,
];

export function alisverisYapabilir(roleId: number | null | undefined): boolean {
  return roleId != null && ALISVERIS_ROLLERI.includes(roleId);
}

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
