import { ROUTES } from "@/lib/routes";

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
}

export const STUDENT_NAV: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.demands, label: "Taleplerim", icon: "demand" },
  { to: ROUTES.learn, label: "Öğren", icon: "learn" },
  { to: ROUTES.bookings, label: "Rezervasyonlar", icon: "bookings" },
  { to: ROUTES.store, label: "Mağaza", icon: "store" },
];

export const TUTOR_NAV: NavItem[] = [
  { to: ROUTES.bookings, label: "Ders Talepleri", icon: "bookings" },
  { to: ROUTES.demands, label: "Gelen Talepler", icon: "demand" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.sellerProducts, label: "Dijital Ürünlerim", icon: "store" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  // Eğitmen de "Öğren" hub'ını görür (aralıklı tekrar, pomodoro,
  // grafik, alışkanlıklar…). Kendi kullanmadığı aracı öğrencisine
  // öneremez. Öğrenci verisine erişim açılmaz — K-6 sınırı (hiçbir admin/
  // eğitmen izni `srs_progress`/`srs_review_logs` okutmaz) yerinde durur;
  // buradaki tek değişiklik hub'ın kendi araçlarına erişimdir.
  { to: ROUTES.learn, label: "Öğren", icon: "learn" },
  { to: ROUTES.libraries, label: "Kütüphaneler", icon: "library" },
  { to: ROUTES.store, label: "Mağaza", icon: "shop" },
];

// Kütüphane operatörü: özet panel + profil + operasyon + para + mesajlar.
export const OPERATOR_NAV: NavItem[] = [
  { to: "/", label: "Panel", icon: "dashboard", end: true },
  { to: ROUTES.operatorLibrary, label: "Kütüphanem", icon: "library" },
  { to: ROUTES.operatorSessions, label: "Oturumlar & QR", icon: "tickets" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
];
