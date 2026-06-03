// Uygulamanın TEK route kaynağı. Bileşenlere ham string path dağıtmayın;
// her zaman buradan tüketin.
//
// İki yüzey:
//  • Public (SEO): Türkçe/anlamlı path'ler.
//  • Oturum-içi: DÜZ (flat) — `/panel` öneki YOKTUR. Kök (`/`) bir
//    "root dispatcher"dır: anonim → public Landing, oturumlu → role workspace.
//
// `PATHS`  = react-router `path` desenleri (`:param` dahil) — `<Route path>` için.
// `ROUTES` = gezinme/`Link` için URL üreticileri; statikler PATHS'ten türer
//            (tek kaynak, literal drift yok), param'lılar fonksiyondur.

export const PATHS = {
  // ── Public (SEO) ──
  home: "/",
  tutors: "/egitmenler",
  /** Eğitmen profili — slug ("ahmet-yilmaz-42") veya salt id. */
  tutor: "/egitmenler/:slug",

  // ── Kimlik & token akışları ──
  login: "/giris",
  register: "/kayit",
  forgotPassword: "/sifremi-unuttum",
  resetPassword: "/sifre-yenile",
  verifyEmail: "/e-posta-dogrula",

  // ── Oturum-içi (DÜZ, role-adaptive) ──
  /** Ders talepleri listesi (CLIENT). */
  bookings: "/ders-talepleri",
  /** Ders/talep detayı — CLIENT + TUTOR ortak. */
  lesson: "/ders-talepleri/:id",
  messages: "/mesajlar",
  calendar: "/takvim",
  favorites: "/favoriler",
  questions: "/sorular",
  exams: "/denemeler",
  tasks: "/gorevler",
  leaderboard: "/liderlik",
  // Öğren bölümü (kelime kartları / SRS / odak / grafik / alışkanlıklar)
  learn: "/ogren",
  flashcards: "/ogren/kelime-kartlari",
  flashcardDeck: "/ogren/kelime-kartlari/:id",
  deepwork: "/ogren/zamanlayici",
  grapher: "/ogren/grafik",
  habits: "/ogren/aliskanliklar",
  profile: "/hesabim",
  settings: "/ayarlar",
  tutorListing: "/ilan-ayarlari",
  studentProfile: "/ogrenciler/:id",
} as const;

export const ROUTES = {
  // ── Public ──
  home: PATHS.home,
  tutors: PATHS.tutors,
  /** Eğitmen profili — slug ("ahmet-yilmaz-42") veya salt id verilebilir. */
  tutor: (slugOrId: string | number) => `/egitmenler/${slugOrId}`,

  // ── Kimlik & token akışları ──
  login: PATHS.login,
  register: PATHS.register,
  forgotPassword: PATHS.forgotPassword,
  resetPassword: PATHS.resetPassword,
  verifyEmail: PATHS.verifyEmail,

  // ── Oturum-içi ──
  bookings: PATHS.bookings,
  lesson: (id: string | number) => `/ders-talepleri/${id}`,
  messages: PATHS.messages,
  /** Belirli bir kişiyle sohbeti açar (mesajlaşma sayfası to/name query'siyle). */
  messageWith: (counterpartId: string | number, name: string) =>
    `/mesajlar?to=${counterpartId}&name=${encodeURIComponent(name)}`,
  calendar: PATHS.calendar,
  favorites: PATHS.favorites,
  questions: PATHS.questions,
  exams: PATHS.exams,
  tasks: PATHS.tasks,
  leaderboard: PATHS.leaderboard,
  learn: PATHS.learn,
  flashcards: PATHS.flashcards,
  flashcardDeck: (id: string | number) => `/ogren/kelime-kartlari/${id}`,
  deepwork: PATHS.deepwork,
  grapher: PATHS.grapher,
  habits: PATHS.habits,
  profile: PATHS.profile,
  settings: PATHS.settings,
  tutorListing: PATHS.tutorListing,
  studentProfile: (id: string | number) => `/ogrenciler/${id}`,
} as const;

// Eğitmen için kanonik slug. Backend `slug` döner (isim-soyisim-{id}); yoksa id'ye düş.
export function tutorSlug(t: { id: number; slug?: string | null }): string {
  return t.slug ?? String(t.id);
}

// Slug ("ahmet-yilmaz-42") ya da salt id'den sayısal eğitmen id'sini çıkarır.
export function parseTutorId(slugOrId: string | undefined): number {
  if (!slugOrId) return NaN;
  const m = slugOrId.match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}
