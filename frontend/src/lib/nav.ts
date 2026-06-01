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
  | "tasks";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: NavIcon;
}

export const STUDENT_NAV: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.questions, label: "Sorularım", icon: "questions" },
  { to: ROUTES.exams, label: "Denemelerim", icon: "exams" },
  { to: ROUTES.learn, label: "Öğren", icon: "learn" },
  { to: ROUTES.tasks, label: "Görevlerim", icon: "tasks" },
  { to: ROUTES.bookings, label: "Ders Taleplerim", icon: "bookings" },
  { to: ROUTES.calendar, label: "Takvim", icon: "calendar" },
];

export const TUTOR_NAV: NavItem[] = [
  { to: ROUTES.panel, label: "Anasayfa", end: true, icon: "dashboard" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  { to: ROUTES.questions, label: "Sorularım", icon: "questions" },
  { to: ROUTES.tasks, label: "Görevlerim", icon: "tasks" },
  { to: ROUTES.tutorListing, label: "İlan Ayarları", icon: "listing" },
  { to: ROUTES.calendar, label: "Takvim", icon: "calendar" },
];
