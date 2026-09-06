import { ROUTES } from "@/lib/routes";
import { KUTUPHANELER_ACIK, OGREN_ACIK, TALEPLER_ACIK } from "@/lib/ozellikBayraklari";

export type NavIcon =
  | "favorites"
  | "questions"
  | "bookings"
  | "dashboard"
  | "listing"
  | "search"
  | "messages"
  | "exams"
  | "demand"
  | "calendar"
  | "trophy"
  | "learn"
  | "tasks"
  | "habit"
  | "library"
  | "tickets"
  | "wallet"
  | "store"
  | "shop";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: NavIcon;
  /**
   * Bölüm donduruldu (bkz. `lib/ozellikBayraklari.ts`). Girdi menüde GÖRÜNÜR
   * kalır ama bağlantı değildir, klavyeyle odaklanamaz ve "Yakında" rozeti
   * taşır. Menüyü çizen her yüzey (`DashboardHeader` üst bar + yan menü) bu
   * alanı okumak ZORUNDADIR; okumayan yüzey donmuş bölüme tıklatır.
   */
  yakinda?: boolean;
}

/**
 * Öğren TAM GİZLENİR, "Yakında" rozetiyle DURMAZ (5 Eyl 2026).
 *
 * Kütüphaneler'den farkı bilinçli: Kütüphaneler yakında gelecek bir bölüm ve
 * rozet bir vaat. Öğren ise lansman hikâyesinin dışına alındı — vaat etmediğimiz
 * bir şeyi menüde tutmak kullanıcıya boş bir söz verir.
 */
export const STUDENT_NAV: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  ...(TALEPLER_ACIK
    ? [{ to: ROUTES.demands, label: "Taleplerim", icon: "demand" } as NavItem]
    : []),
  ...(OGREN_ACIK
    ? [{ to: ROUTES.learn, label: "Öğren", icon: "learn" } as NavItem]
    : []),
  { to: ROUTES.bookings, label: "Rezervasyonlar", icon: "bookings" },
  { to: ROUTES.store, label: "Mağaza", icon: "store" },
];

export const TUTOR_NAV: NavItem[] = [
  // İlan, eğitmenin platformdaki tek ürünü — üst gezinmede yeri olmaması
  // eğitmeni onu hesap menüsünün altında aramaya zorluyordu.
  { to: ROUTES.tutorListing, label: "İlanım", icon: "tickets" },
  { to: ROUTES.bookings, label: "Ders Talepleri", icon: "bookings" },
  ...(TALEPLER_ACIK
    ? [{ to: ROUTES.demands, label: "Gelen Talepler", icon: "demand" } as NavItem]
    : []),
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  // Eğitmen de "Öğren" hub'ını görür (aralıklı tekrar, pomodoro,
  // grafik, alışkanlıklar…). Kendi kullanmadığı aracı öğrencisine
  // öneremez. Öğrenci verisine erişim açılmaz — K-6 sınırı (hiçbir admin/
  // eğitmen izni `srs_progress`/`srs_review_logs` okutmaz) yerinde durur;
  // buradaki tek değişiklik hub'ın kendi araçlarına erişimdir.
  ...(OGREN_ACIK
    ? [{ to: ROUTES.learn, label: "Öğren", icon: "learn" } as NavItem]
    : []),
  { to: ROUTES.libraries, label: "Kütüphaneler", icon: "library", yakinda: !KUTUPHANELER_ACIK },
  { to: ROUTES.store, label: "Mağaza", icon: "shop" },
];

// Kütüphane operatörü: özet panel + profil + operasyon + para + mesajlar.
export const OPERATOR_NAV: NavItem[] = [
  { to: "/", label: "Panel", icon: "dashboard", end: true },
  { to: ROUTES.operatorLibrary, label: "Kütüphanem", icon: "library" },
  { to: ROUTES.operatorSessions, label: "Oturumlar", icon: "tickets" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
];

/**
 * Role göre üst bar navigasyonu — **ortak sayfaların tek kaynağı**.
 *
 * Bildirimler, Liderlik, Ayarlar, Profil, Görevler, Öğren ve Takvim
 * role-agnostiktir: her rol girebilir. Nav seçimi bu yedi sayfada tek tek
 * kopyalanmıştı ve hiçbiri `LIBRARY_OPERATOR`'ı tanımıyordu — operatör
 * bildirimlerine girdiğinde nav çubuğu ya BOŞ kalıyor ya da öğrenci menüsü
 * çıkıyordu; panele dönmek için logoya ya da tarayıcı geri tuşuna basmak
 * gerekiyordu (ölçüm §1.4, §6.1/7).
 *
 * Yeni rol eklendiğinde de tek yer değişsin diye dal burada durur; sayfalar
 * yalnız `navForRole(user?.role_id)` çağırır. ADMIN bilinçli olarak
 * `undefined` alır: admin yüzeyi kendi kabuğunu (`/yonetim`) kullanır ve
 * buradaki rol menülerinden hiçbiri ona ait değildir.
 */
export function navForRole(roleId: number | undefined | null): NavItem[] | undefined {
  switch (roleId) {
    case 2:
      return TUTOR_NAV;
    case 3:
      return STUDENT_NAV;
    case 4:
      return OPERATOR_NAV;
    default:
      return undefined;
  }
}
