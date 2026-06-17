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
  | "wallet";

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
  { to: ROUTES.questions, label: "Sorularım", icon: "questions" },
  { to: ROUTES.exams, label: "Denemelerim", icon: "exams" },
  { to: ROUTES.libraries, label: "Kütüphaneler", icon: "library" },
  { to: ROUTES.tickets, label: "Biletlerim", icon: "tickets" },
  { to: ROUTES.learn, label: "Öğren", icon: "learn" },
  { to: ROUTES.tasks, label: "Görevlerim", icon: "tasks" },
  { to: ROUTES.habits, label: "Alışkanlıklar", icon: "habit" },
  { to: ROUTES.bookings, label: "Ders Taleplerim", icon: "bookings" },
  { to: ROUTES.calendar, label: "Takvim", icon: "calendar" },
];

export const TUTOR_NAV: NavItem[] = [
  { to: ROUTES.home, label: "Anasayfa", end: true, icon: "dashboard" },
  { to: ROUTES.bookings, label: "Ders Talepleri", icon: "bookings" },
  { to: ROUTES.demands, label: "Gelen Talepler", icon: "demand" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.questions, label: "Sorularım", icon: "questions" },
  { to: ROUTES.tasks, label: "Görevlerim", icon: "tasks" },
  { to: ROUTES.habits, label: "Alışkanlıklar", icon: "habit" },
  { to: ROUTES.libraries, label: "Kütüphaneler", icon: "library" },
  { to: ROUTES.tutorListing, label: "İlan Ayarları", icon: "listing" },
  { to: ROUTES.calendar, label: "Takvim", icon: "calendar" },
];
