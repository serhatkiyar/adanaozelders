// Uygulamanın TEK route kaynağı. Bileşenlere ham string path dağıtmayın;
// her zaman buradan tüketin. Public yüzey Türkçe/SEO dostu, oturum içi yüzey
// nötr `/panel` altında role-adaptive'tir.

export const ROUTES = {
  // ── Public (SEO) ──
  home: "/",
  tutors: "/egitmenler",
  /** Eğitmen profili — slug ("ahmet-yilmaz-42") veya salt id verilebilir. */
  tutor: (slugOrId: string | number) => `/egitmenler/${slugOrId}`,

  // ── Kimlik & token akışları ──
  login: "/giris",
  register: "/kayit",
  forgotPassword: "/sifremi-unuttum",
  resetPassword: "/sifre-yenile",
  verifyEmail: "/e-posta-dogrula",

  // ── Panel (oturum içi, role-adaptive) ──
  panel: "/panel",
  bookings: "/panel/rezervasyonlar",
  lesson: (id: string | number) => `/panel/rezervasyonlar/${id}`,
  messages: "/panel/mesajlar",
  /** Belirli bir kişiyle sohbeti açar (mesajlaşma sayfası to/name query'siyle). */
  messageWith: (counterpartId: string | number, name: string) =>
    `/panel/mesajlar?to=${counterpartId}&name=${encodeURIComponent(name)}`,
  calendar: "/panel/takvim",
  favorites: "/panel/favoriler",
  questions: "/panel/sorular",
  exams: "/panel/denemeler",
  leaderboard: "/panel/liderlik",
  // Öğren bölümü (kelime kartları / SRS)
  learn: "/panel/ogren",
  flashcards: "/panel/ogren/kelime-kartlari",
  flashcardDeck: (id: string | number) => `/panel/ogren/kelime-kartlari/${id}`,
  profile: "/panel/profil",
  settings: "/panel/ayarlar",
  tutorListing: "/panel/ilan",
  studentProfile: (id: string | number) => `/panel/ogrenciler/${id}`,
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
