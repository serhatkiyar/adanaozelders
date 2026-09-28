import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

/**
 * PANEL SEKMELERİNİN ÖN YÜKLENMESİ.
 *
 * Sorun (ölçüm, 28 Eyl 2026): React Router gezinmeyi `startTransition`
 * içinde yapar. Tembel sayfanın parçası henüz inmemişse React eski ekranı
 * tutar; ne Suspense yedeği ne de şeritteki aktif sekme çizgisi değişir.
 * Yavaş ağda (Fast 4G) her sekmenin İLK açılışında 190–610 ms hiçbir geri
 * bildirim yoktu; ikinci açılışlar 5–30 ms.
 *
 * Çözüm: şeritteki sekmelerin parçalarını boşta ve imleç/odak/dokunuşta
 * önceden indirmek. `App.tsx`teki `lazy()` çağrıları AYNI yükleyici
 * fonksiyonlarını kullanır; böylece ön yükleme ile rota kesin aynı parçayı
 * ister (import dizgesi iki yerde kopyalanmaz).
 */
export type SayfaYukleyici = () => Promise<unknown>;

export const panelSayfaYukleyicileri = {
  TutorDashboard: () => import("@/pages/TutorDashboard"),
  TutorSettings: () => import("@/pages/TutorSettings"),
  TutorCalendar: () => import("@/pages/TutorCalendar"),
  TutorAnalytics: () => import("@/pages/TutorAnalytics"),
  TutorStudents: () => import("@/pages/TutorStudents"),
  OgrenciPano: () => import("@/pages/OgrenciPano"),
  Reservations: () => import("@/pages/Reservations"),
  Messages: () => import("@/pages/Messages"),
  Settings: () => import("@/pages/Settings"),
} as const;

const Y = panelSayfaYukleyicileri;

/**
 * Şeritteki bir sekme adresinin, verilen rol için açacağı sayfanın
 * yükleyicileri. Rol dağıtıcı adresler (`/genel-bakis`, `/takvim`,
 * `/dersler`) `App.tsx`teki dağıtıcılarla aynı dalı izler. Tanınmayan adres
 * boş liste döner (ön yükleme yapılmaz, davranış değişmez).
 */
export function sekmeYukleyicileri(
  yol: string,
  rolId: number | null | undefined
): SayfaYukleyici[] {
  const egitmen = rolId === ROLE_IDS.TUTOR;
  const ogrenci = rolId === ROLE_IDS.CLIENT;
  switch (yol) {
    case ROUTES.bookings:
      if (egitmen) return [Y.TutorDashboard];
      if (ogrenci) return [Y.OgrenciPano];
      return [];
    case ROUTES.tutorCalendar:
      // Öğrenci `/takvim`de `/dersler?sekme=takvim`e yönlenir.
      if (egitmen) return [Y.TutorCalendar];
      if (ogrenci) return [Y.Reservations];
      return [];
    case ROUTES.reservations:
      return ogrenci ? [Y.Reservations] : [];
    case ROUTES.messages:
      return [Y.Messages];
    case ROUTES.settings:
      return [Y.Settings];
    case ROUTES.tutorListing:
      return egitmen ? [Y.TutorSettings] : [];
    case ROUTES.tutorStudents:
      return egitmen ? [Y.TutorStudents] : [];
    case ROUTES.tutorAnalytics:
      return egitmen ? [Y.TutorAnalytics] : [];
    default:
      return [];
  }
}

const baslatilan = new Set<SayfaYukleyici>();

/**
 * Yükleyiciyi oturum boyunca bir kez çalıştırır. Başarısız indirme sessizce
 * yutulur ve kayıt silinir: rota kendi `lazy()` çağrısıyla yeniden dener,
 * sonraki ön yükleme de tekrar deneyebilir.
 */
export function birKezYukle(yukleyici: SayfaYukleyici): void {
  if (baslatilan.has(yukleyici)) return;
  baslatilan.add(yukleyici);
  yukleyici().catch(() => {
    baslatilan.delete(yukleyici);
  });
}

export function sekmeyiOnYukle(
  yol: string,
  rolId: number | null | undefined
): void {
  for (const y of sekmeYukleyicileri(yol, rolId)) birKezYukle(y);
}
