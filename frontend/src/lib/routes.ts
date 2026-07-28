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
  /** Mağaza katalogu (D&R tarzı; public). */
  store: "/magaza",
  /** Ürün detayı — slug veya salt id. */
  storeProduct: "/magaza/urun/:slug",
  /** Satıcı (eğitmen) mağaza vitrini. */
  storeSeller: "/magaza/satici/:tutorId",
  /** Sepet (public; ödeme için giriş gerekir). */
  storeCart: "/magaza/sepet",
  /** Favoriler (public; localStorage tabanlı wishlist). */
  storeFavorites: "/magaza/favoriler",
  /** Ödeme/checkout (CLIENT). */
  storeCheckout: "/magaza/odeme",
  /** Paylaşılan koleksiyon (public). */
  storeCollectionShared: "/magaza/liste/:token",
  /** Oturumsuz kargo takibi (SMS'le paylaşılan token). */
  cargoTracking: "/kargo-takip/:token",

  // ── Yasal sayfalar (public, SEO) — içerik lib/legalContent.ts'te ──
  kvkk: "/kvkk",
  privacy: "/gizlilik-politikasi",
  terms: "/kullanim-kosullari",
  distanceSales: "/mesafeli-satis-sozlesmesi",
  refundPolicy: "/iptal-ve-iade-politikasi",
  cookiePolicy: "/cerez-politikasi",

  // ── Destek (public, SEO) — mesafeli satışta erişilebilir iletişim zorunlu ──
  faq: "/sss",
  contact: "/iletisim",

  // ── Kimlik & token akışları ──
  login: "/giris",
  register: "/kayit",
  forgotPassword: "/sifremi-unuttum",
  resetPassword: "/sifre-yenile",
  verifyEmail: "/e-posta-dogrula",

  // ── Oturum-içi (DÜZ, role-adaptive) ──
  /** Rezervasyonlar (Ders + Biletler) (CLIENT). Eğitmen için sadece dersler. */
  bookings: "/rezervasyonlar",
  /** Ders/talep detayı — CLIENT + TUTOR ortak. */
  lesson: "/ders-talepleri/:id",
  messages: "/mesajlar",
  calendar: "/takvim",
  favorites: "/favoriler",
  questions: "/sorular",
  /** Açık talepler (ilan) — CLIENT açar, TUTOR görüp yanıtlar (rol-adaptif). */
  demands: "/talepler",
  exams: "/denemeler",
  /** Öğrencinin deneme oturumu biletleri (QR). */
  tasks: "/gorevler",
  /** Bildirimler gelen kutusu (tüm roller). */
  notifications: "/bildirimler",
  /** Mesaj Merkezi — Mesajlar + Bildirimler tek çatıda (kenar çubuklu). */
  messageCenter: "/mesaj-merkezi",
  /** Mağaza siparişlerim (CLIENT). */
  orders: "/siparislerim",
  /** Sipariş detayı (CLIENT). */
  orderDetail: "/siparislerim/:id",
  /** Eğitmenin dijital ürünleri (TUTOR). */
  sellerProducts: "/dijital-urunlerim",
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
  /** Hesabım — CLIENT'ta birleşik hub, TUTOR/ADMIN'de profil editörü (dağıtıcı). */
  profile: "/hesabim",
  /** Profil bilgileri editörü (about/eğitim/avatar) — hub'dan erişilir. */
  profileEdit: "/hesabim/profil",
  /** Teslimat adresleri (CLIENT) — mağaza + ders ortak. */
  addresses: "/adreslerim",
  settings: "/ayarlar",
  tutorListing: "/ilan-ayarlari",
  /** Dağıtıcı saha ekranı — kendi-filo teslimat turu (ADMIN). */
  deliveryRun: "/dagitim/:id",
  studentProfile: "/ogrenciler/:id",
  /** Operatörün kendi kütüphane profili (gör + bölüm bölüm düzenle). */
  operatorLibrary: "/kutuphanem",
  /** Operatör operasyon ekranı: QR doğrula + deneme oturumları + çalışma rez. */
  operatorSessions: "/oturumlar",

  // ── Yönetim (ADMIN, route tabanlı bilgi mimarisi) ──
  admin: "/yonetim",
  adminUsers: "/yonetim/kullanicilar",
  adminUser: "/yonetim/kullanicilar/:role/:id",
  adminTutors: "/yonetim/egitmenler",
  adminDiplomas: "/yonetim/diplomalar",
  adminLibraries: "/yonetim/kutuphaneler",
  adminExamCatalogs: "/yonetim/deneme-kataloglari",
  adminStoreProducts: "/yonetim/magaza/urunler",
  adminStoreCategories: "/yonetim/magaza/kategoriler",
  adminStoreOrders: "/yonetim/magaza/siparisler",
  adminStoreReturns: "/yonetim/magaza/iadeler",
  adminStoreCoupons: "/yonetim/magaza/kuponlar",
  adminDelivery: "/yonetim/dagitim",
  adminBookings: "/yonetim/rezervasyonlar",
  adminDemands: "/yonetim/talepler",
  adminNameChanges: "/yonetim/ad-degisiklikleri",
  adminReports: "/yonetim/moderasyon/sikayetler",
  adminAuditLogs: "/yonetim/denetim-kayitlari",
  adminAccess: "/yonetim/yetkiler",
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
  store: PATHS.store,
  /** Ürün detayı — slug veya salt id. */
  storeProduct: (slugOrId: string | number) => `/magaza/urun/${slugOrId}`,
  storeSeller: (tutorId: number) => `/magaza/satici/${tutorId}`,
  storeCart: PATHS.storeCart,
  storeFavorites: PATHS.storeFavorites,
  storeCheckout: PATHS.storeCheckout,
  storeCollectionShared: (token: string) => `/magaza/liste/${token}`,
  cargoTracking: (token: string) => `/kargo-takip/${token}`,

  // ── Yasal sayfalar ──
  kvkk: PATHS.kvkk,
  privacy: PATHS.privacy,
  terms: PATHS.terms,
  distanceSales: PATHS.distanceSales,
  refundPolicy: PATHS.refundPolicy,
  cookiePolicy: PATHS.cookiePolicy,

  // ── Destek ──
  faq: PATHS.faq,
  contact: PATHS.contact,

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
  /** Belirli bir kişiyle/kütüphaneyle sohbeti açar (to/name + opsiyonel role). */
  messageWith: (
    counterpartId: string | number,
    name: string,
    role?: "CLIENT" | "TUTOR" | "LIBRARY"
  ) =>
    `/mesajlar?to=${counterpartId}&name=${encodeURIComponent(name)}${
      role ? `&role=${role}` : ""
    }`,
  calendar: PATHS.calendar,
  favorites: PATHS.favorites,
  questions: PATHS.questions,
  demands: PATHS.demands,
  exams: PATHS.exams,
  tasks: PATHS.tasks,
  notifications: PATHS.notifications,
  messageCenter: PATHS.messageCenter,
  orders: PATHS.orders,
  orderDetail: (id: string | number) => `/siparislerim/${id}`,
  sellerProducts: PATHS.sellerProducts,
  balance: PATHS.balance,
  leaderboard: PATHS.leaderboard,
  learn: PATHS.learn,
  flashcards: PATHS.flashcards,
  flashcardDeck: (id: string | number) => `/ogren/kelime-kartlari/${id}`,
  deepwork: PATHS.deepwork,
  grapher: PATHS.grapher,
  habits: PATHS.habits,
  profile: PATHS.profile,
  profileEdit: PATHS.profileEdit,
  addresses: PATHS.addresses,
  settings: PATHS.settings,
  tutorListing: PATHS.tutorListing,
  deliveryRun: (id: string | number) => `/dagitim/${id}`,
  studentProfile: (id: string | number) => `/ogrenciler/${id}`,
  operatorLibrary: PATHS.operatorLibrary,
  operatorSessions: PATHS.operatorSessions,
  admin: PATHS.admin,
  adminUsers: PATHS.adminUsers,
  adminUser: (role: "admin" | "tutor" | "client", id: string | number) =>
    `/yonetim/kullanicilar/${role}/${id}`,
  adminTutors: PATHS.adminTutors,
  adminDiplomas: PATHS.adminDiplomas,
  adminLibraries: PATHS.adminLibraries,
  adminExamCatalogs: PATHS.adminExamCatalogs,
  adminStoreProducts: PATHS.adminStoreProducts,
  adminStoreCategories: PATHS.adminStoreCategories,
  adminStoreOrders: PATHS.adminStoreOrders,
  adminStoreReturns: PATHS.adminStoreReturns,
  adminStoreCoupons: PATHS.adminStoreCoupons,
  adminDelivery: PATHS.adminDelivery,
  adminBookings: PATHS.adminBookings,
  adminDemands: PATHS.adminDemands,
  adminNameChanges: PATHS.adminNameChanges,
  adminReports: PATHS.adminReports,
  adminAuditLogs: PATHS.adminAuditLogs,
  adminAccess: PATHS.adminAccess,
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
