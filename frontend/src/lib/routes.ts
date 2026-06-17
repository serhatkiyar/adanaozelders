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
  /** Kütüphane / etüt merkezi kataloğu (harita + liste). */
  libraries: "/kutuphaneler",
  /** Kütüphane profili — slug veya salt id. */
  library: "/kutuphaneler/:slug",
  /** Self-servis "kütüphaneni listele" kaydı (public). */
  libraryRegister: "/kutuphane-kayit",

  // ── Yasal sayfalar (public, SEO) — içerik lib/legalContent.ts'te ──
  kvkk: "/kvkk",
  privacy: "/gizlilik-politikasi",
  terms: "/kullanim-kosullari",
  distanceSales: "/mesafeli-satis-sozlesmesi",
  refundPolicy: "/iptal-ve-iade-politikasi",
  cookiePolicy: "/cerez-politikasi",

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
  /** Öğrencinin deneme oturumu biletleri (QR). */
  tickets: "/biletlerim",
  tasks: "/gorevler",
  /** Kazanç & ödeme bakiyesi (TUTOR + LIBRARY_OPERATOR). */
  balance: "/bakiyem",
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
  libraries: PATHS.libraries,
  /** Kütüphane profili — slug veya salt id. */
  library: (slugOrId: string | number) => `/kutuphaneler/${slugOrId}`,
  libraryRegister: PATHS.libraryRegister,

  // ── Yasal sayfalar ──
  kvkk: PATHS.kvkk,
  privacy: PATHS.privacy,
  terms: PATHS.terms,
  distanceSales: PATHS.distanceSales,
  refundPolicy: PATHS.refundPolicy,
  cookiePolicy: PATHS.cookiePolicy,

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
  tickets: PATHS.tickets,
  tasks: PATHS.tasks,
  balance: PATHS.balance,
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

// Yasal belge id'si (lib/legalContent.ts) → URL. LegalPage kenar gezinmesi ve
// footer bu eşlemeden üretilir; yeni belge eklerken buraya da ekleyin.
export const LEGAL_ROUTES = {
  kvkk: PATHS.kvkk,
  privacy: PATHS.privacy,
  terms: PATHS.terms,
  "distance-sales": PATHS.distanceSales,
  refund: PATHS.refundPolicy,
  cookies: PATHS.cookiePolicy,
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
