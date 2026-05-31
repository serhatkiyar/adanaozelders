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
  | "trophy";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: NavIcon;
}

export const STUDENT_NAV: NavItem[] = [
  { to: "/student/favorites", label: "Favorilerim", icon: "favorites" },
  { to: "/messages", label: "Mesajlar", icon: "messages" },
  { to: "/student/questions", label: "Sorularım", icon: "questions" },
  { to: "/student/exams", label: "Denemelerim", icon: "exams" },
  { to: "/student/demands", label: "Taleplerim", icon: "demand" },
  { to: "/student/bookings", label: "Rezervasyonlarım", icon: "bookings" },
  { to: "/calendar", label: "Takvim", icon: "bookings" },
  { to: "/leaderboard", label: "Liderlik", icon: "trophy" },
];

export const TUTOR_NAV: NavItem[] = [
  { to: "/tutor", label: "Panel", end: true, icon: "dashboard" },
  { to: "/tutor/demands", label: "Talepler", icon: "demand" },
  { to: "/messages", label: "Mesajlar", icon: "messages" },
  { to: "/tutor/questions", label: "Sorular", icon: "questions" },
  { to: "/tutor/settings", label: "İlan Ayarları", icon: "listing" },
  { to: "/calendar", label: "Takvim", icon: "bookings" },
  { to: "/leaderboard", label: "Liderlik", icon: "trophy" },
];
