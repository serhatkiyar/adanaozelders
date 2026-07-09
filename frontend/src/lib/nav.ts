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
  | "store";

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
];

export const TUTOR_NAV: NavItem[] = [
  { to: ROUTES.bookings, label: "Ders Talepleri", icon: "bookings" },
  { to: ROUTES.demands, label: "Gelen Talepler", icon: "demand" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.sellerProducts, label: "Dijital Ürünlerim", icon: "store" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.libraries, label: "Kütüphaneler", icon: "library" },
];

// Kütüphane operatörü: özet panel + profil + operasyon + para + mesajlar.
export const OPERATOR_NAV: NavItem[] = [
  { to: "/", label: "Panel", icon: "dashboard", end: true },
  { to: ROUTES.operatorLibrary, label: "Kütüphanem", icon: "library" },
  { to: ROUTES.operatorSessions, label: "Oturumlar & QR", icon: "tickets" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
];
