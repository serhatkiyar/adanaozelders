// Uygulamanın TEK route kaynağı. Bileşenlere ham string path dağıtmayın;
// her zaman buradan tüketin.
//
// İki yüzey:
//  • Public (SEO): Türkçe/anlamlı path'ler.
//  • Oturum-içi: çoğunlukla DÜZ. Kök (`/`) bir "root dispatcher"dır: anonim →
//    public Landing, oturumlu → role workspace.
//  • `/pano/*` — PANEL ŞERİDİNİN altı sayfası (kullanıcı kararı, 8 Eyl 2026).
//    Eski `/panel` öneki kaldırılmıştı ve buradaki sözleşme "önek YOKTUR"
//    diyordu; kullanıcı şeridi kurarken sekmelerin ortak bir kök altında
//    toplanmasını istedi: *"/pano yazıcak /pano/mesajlar olacak."* Önek YALNIZ
//    şeridin altı sayfasını kapsar — favoriler, ayarlar, bildirimler, takvim,
//    siparişler, öne çıkarma ve sihirbaz DÜZ kalır. Eski düz karşılıkları
//    kalıcı yönlendirme olarak yaşar (`App.tsx::LEGACY_STATIC`); bildirim
//    satırları ve gönderilmiş e-postalar hâlâ onları taşıyor.
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
  /** Okula dönüş kampanyası — manuel vitrin sayfası (kodda yaşar). */
  storeOkulaDonus: "/magaza/okula-donus",
  /** Oturumsuz kargo takibi (SMS'le paylaşılan token). */
  cargoTracking: "/kargo-takip/:token",

  // ── Yasal sayfalar (public, SEO) — içerik lib/legalContent.ts'te ──
  kvkk: "/kvkk",
  privacy: "/gizlilik-politikasi",
  terms: "/kullanim-kosullari",
  distanceSales: "/mesafeli-satis-sozlesmesi",
  refundPolicy: "/iptal-ve-iade-politikasi",
  cookiePolicy: "/cerez-politikasi",
  // Mesafeli satış sözleşmesi bu forma atıf yapar; sipariş öncesi özet niteliğindedir.
  preliminaryInfo: "/on-bilgilendirme-formu",
  /**
   * Sıralama ölçütleri — 6563 sayılı Kanun ve ETAHS Yönetmeliği aracı hizmet
   * sağlayıcının sıralama kriterlerini erişilebilir biçimde açıklamasını
   * ister. Ücretli öne çıkarma bloğu buraya bağlantı verir.
   */
  rankingCriteria: "/siralama-kriterleri",
  about: "/hakkimizda",

  // ── Blog (public, SEO) ──
  blog: "/blog",
  blogPost: "/blog/:slug",

  // ── Destek (public, SEO) — mesafeli satışta erişilebilir iletişim zorunlu ──
  faq: "/sss",
  contact: "/iletisim",

  /**
   * Eğitmen ön başvurusu (public lead formu) — sosyal medyada paylaşılan
   * hesapsız başvuru sayfası; tam kayıt /kayit'ta kalır.
   */
  tutorPreApply: "/egitmen-on-basvuru",

  // ── Kimlik & token akışları ──
  login: "/giris",
  register: "/kayit",
  forgotPassword: "/sifremi-unuttum",
  resetPassword: "/sifre-yenile",
  verifyEmail: "/e-posta-dogrula",
  /** Google girişinden dönüş. Sunucu buraya `?durum=...&git=...` ile yollar. */
  googleReturn: "/google-donus",
  /** Parolasız hesabın silme onayı (e-posta bağlantısı). */
  confirmDelete: "/hesap-silme-onayi",

  // ── Oturum-içi (DÜZ, role-adaptive) ──
  /** Rezervasyonlar (ders + kütüphane) (CLIENT). Eğitmen için sadece dersler. */
  bookings: "/pano",
  /** Kütüphane rezervasyon detayı. `tur`: `deneme` | `calisma`.
   *  Kapıda söylenecek giriş kodu URL'lenebilir olmalı — bildirimden ya da
   *  telefondan tek tıkla açılsın diye ayrı bir yol var. */
  libraryReservation: "/pano/rezervasyon/:tur/:id",
  /** Ders/talep detayı — CLIENT + TUTOR ortak. */
  lesson: "/ders-talepleri/:id",
  messages: "/pano/mesajlar",
  calendar: "/takvim",
  favorites: "/favoriler",
  questions: "/sorular",
  /** Açık talepler (ilan) — CLIENT açar, TUTOR görüp yanıtlar (rol-adaptif). */
  demands: "/talepler",
  exams: "/denemeler",
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
  balance: "/pano/bakiyem",
  leaderboard: "/liderlik",
  // Öğren bölümü (aralıklı tekrar / odak / grafik / alışkanlıklar)
  learn: "/ogren",
  deepwork: "/ogren/zamanlayici",
  grapher: "/ogren/grafik",
  habits: "/ogren/aliskanliklar",
  // Aralıklı tekrar (FSRS, İP-16). Eski SM-2 yüzeyi `/ogren/kelime-kartlari`
  // KALDIRILDI (yönlendirme bilinçli olarak yazılmadı — 404). Nöbetçi:
  // `src/flashcardsKaldirildi.test.tsx`.
  srs: "/ogren/tekrar",
  srsDeck: "/ogren/tekrar/deste/:id",
  srsStudy: "/ogren/tekrar/calis/:deckId",
  srsBrowser: "/ogren/tekrar/tarayici",
  srsStats: "/ogren/tekrar/istatistik",
  /** Hesabım — CLIENT'ta birleşik hub, TUTOR/ADMIN'de profil editörü (dağıtıcı). */
  profile: "/pano/hesabim",
  /** Profil bilgileri editörü (about/eğitim/avatar) — hub'dan erişilir. */
  profileEdit: "/pano/hesabim/profil",
  /** Teslimat adresleri (CLIENT) — mağaza + ders ortak. */
  addresses: "/adreslerim",
  settings: "/ayarlar",
  tutorListing: "/pano/ilanim",
  /**
   * İlan oluşturma sihirbazı — kayıt olan eğitmenin ilk durağı.
   * `/pano/ilanim` MEVCUT ilanın editörüdür; ikisi bilerek ayrıdır.
   * Sihirbaz şeritte değil, o yüzden `/pano` altına GİRMEZ — tek seferlik bir
   * kurulum akışıdır, panelin bir bölümü değil.
   */
  tutorOnboarding: "/ilanini-olustur",
  /** Eğitmenin ilanını öne çıkarma (reklam paketi satın alma). */
  tutorPromotion: "/ilanimi-one-cikar",
  /**
   * Eğitmenin ALDIĞI değerlendirmeler (panel sekmesi).
   *
   * Eskiden ayrı bir yüzeyi yoktu: eğitmen yorumlarını ancak kendi ilan
   * sayfasından (`TutorProfile`) görebiliyordu, yani öğrencinin gördüğü
   * ekrandan. Panel şeridi kurulurken kendi ekranına çıkarıldı.
   */
  tutorReviews: "/pano/degerlendirmeler",
  /** Dağıtıcı saha ekranı — kendi-filo teslimat turu (ADMIN + KURYE). */
  deliveryRun: "/dagitim/:id",
  /** Zimmet ekranı — paketleri araca alma (ADMIN + KURYE, F30 §3.4). */
  deliveryRunHandover: "/dagitim/:id/zimmet",
  uyeProfili: "/uyeler/:id",
  /** Operatörün kendi kütüphane profili (gör + bölüm bölüm düzenle). */
  operatorLibrary: "/kutuphanem",
  /** Operatör operasyon ekranı: QR doğrula + deneme oturumları + çalışma rez. */
  operatorSessions: "/oturumlar",

  // ── Yönetim (ADMIN, route tabanlı bilgi mimarisi) ──
  admin: "/yonetim",
  adminUsers: "/yonetim/kullanicilar",
  adminUser: "/yonetim/kullanicilar/:role/:id",
  adminTutors: "/yonetim/egitmenler",
  adminTutorApplications: "/yonetim/egitmen-basvurulari",
  adminPromotions: "/yonetim/one-cikarmalar",
  adminDiplomas: "/yonetim/diplomalar",
  adminLibraries: "/yonetim/kutuphaneler",
  adminExamCatalogs: "/yonetim/deneme-kataloglari",
  adminStoreRoot: "/yonetim/magaza",
  adminStoreProducts: "/yonetim/magaza/urunler",
  adminStoreCategories: "/yonetim/magaza/kategoriler",
  adminStoreOrders: "/yonetim/magaza/siparisler",
  adminStoreReturns: "/yonetim/magaza/iadeler",
  adminStoreCoupons: "/yonetim/magaza/kuponlar",
  /** @deprecated Stok hareketleri Envanter'e taşındı. */
  adminStoreStock: "/yonetim/magaza/stok-hareketleri",
  // Tedarikci senkronu Magaza'nin bir sekmesidir ama izinleri AYRIDIR
  // (`suppliers.*`): ayar bir sir (API token) ve "vitrin neyi otomatik
  // satar" karari tasir; urun metnini duzenleyen kisi token degistirememeli.
  adminStoreSupplier: "/yonetim/magaza/tedarikci",
  // Blog: içerik (content.*) platform geneline yazar.
  adminBlog: "/yonetim/blog",
  adminBlogNew: "/yonetim/blog/yeni",
  adminBlogEdit: "/yonetim/blog/:postId",
  // Envanter, Magaza'nin 7. sekmesi DEGIL ayri bir bolum: backend izinleri
  // (`inventory.*`) bilincli olarak `products.*`'tan ayrildi.
  adminInventory: "/yonetim/envanter",
  adminInventoryCounts: "/yonetim/envanter/sayimlar",
  adminInventoryCountDetail: "/yonetim/envanter/sayimlar/:id",
  adminInventoryDamage: "/yonetim/envanter/hasar",
  adminInventoryMovements: "/yonetim/envanter/hareketler",
  // Paketleme istasyonu — Dağıtım'dan AYRI bir bölüm: izinleri (`packing.*`)
  // `delivery.*`'tan bağımsızdır (raf başındaki operatör turu yönetmez) ve
  // sipariş "hazır" damgası artık yalnız burada, kalem kalem doğrulanarak doğar.
  adminPacking: "/yonetim/paketleme",
  adminPackingPackages: "/yonetim/paketleme/paketler",
  adminPackingPackage: "/yonetim/paketleme/paket/:id",
  adminPackingReturns: "/yonetim/paketleme/iade",
  adminDelivery: "/yonetim/dagitim",
  // Dağıtım alt sekmeleri (URL-tabanlı; index = "Bugün" operasyon kokpiti).
  adminDeliveryOrders: "/yonetim/dagitim/siparisler",
  adminDeliveryRuns: "/yonetim/dagitim/turlar",
  adminDeliveryRunDetail: "/yonetim/dagitim/turlar/:id",
  adminDeliveryPerformance: "/yonetim/dagitim/performans",
  adminDeliveryCouriers: "/yonetim/dagitim/kuryeler",
  adminDeliveryVehicles: "/yonetim/dagitim/araclar",
  adminDeliveryBoard: "/yonetim/dagitim/tahta",
  adminBookings: "/yonetim/rezervasyonlar",
  adminDemands: "/yonetim/talepler",
  adminNameChanges: "/yonetim/ad-degisiklikleri",
  adminReports: "/yonetim/moderasyon/sikayetler",
  adminAuditLogs: "/yonetim/denetim-kayitlari",
  adminOperations: "/yonetim/hata-cozme",
  adminPayouts: "/yonetim/hakedisler",
  adminAccess: "/yonetim/yetkiler",
  adminSettings: "/yonetim/ayarlar",
  /** Mağaza tepesindeki, admin tarafından yüklenen görsel carousel. */
  adminStoreHero: "/yonetim/vitrin-gorselleri",
  /** @deprecated Eski ad yalnız mevcut çağrı yerlerini kırmamak için tutulur. */
  adminAnnouncements: "/yonetim/vitrin-gorselleri",

  /** Yeni ikas-tarzı panel (geçici kök; tamamlanınca /yonetim devralınır). */
  adminNew: "/yonetim-yeni",
  adminNewProducts: "/yonetim-yeni/urunler",
  adminNewProductNew: "/yonetim-yeni/urunler/yeni",
  adminNewProductEdit: "/yonetim-yeni/urunler/:id",
  adminNewStockCounts: "/yonetim-yeni/urunler/stok-sayimi",
  adminNewStockCountDetail: "/yonetim-yeni/urunler/stok-sayimi/:id",
  adminNewStockMovements: "/yonetim-yeni/urunler/stok-hareketleri",
  adminNewInventory: "/yonetim-yeni/urunler/envanter",
  adminNewDamageEvents: "/yonetim-yeni/urunler/hasarli-stok",
  adminNewCategories: "/yonetim-yeni/urunler/kategoriler",
  adminNewReturns: "/yonetim-yeni/siparisler/iadeler",
  adminNewOrders: "/yonetim-yeni/siparisler",
  adminNewCustomers: "/yonetim-yeni/musteriler",
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
  storeOkulaDonus: PATHS.storeOkulaDonus,
  cargoTracking: (token: string) => `/kargo-takip/${token}`,

  // ── Yasal sayfalar ──
  kvkk: PATHS.kvkk,
  privacy: PATHS.privacy,
  terms: PATHS.terms,
  distanceSales: PATHS.distanceSales,
  refundPolicy: PATHS.refundPolicy,
  cookiePolicy: PATHS.cookiePolicy,
  preliminaryInfo: PATHS.preliminaryInfo,
  rankingCriteria: PATHS.rankingCriteria,
  about: PATHS.about,

  // ── Blog ──
  blog: PATHS.blog,
  blogPost: (slug: string) => `/blog/${slug}`,

  // ── Destek ──
  faq: PATHS.faq,
  contact: PATHS.contact,

  tutorPreApply: PATHS.tutorPreApply,

  // ── Kimlik & token akışları ──
  login: PATHS.login,
  register: PATHS.register,
  forgotPassword: PATHS.forgotPassword,
  resetPassword: PATHS.resetPassword,
  verifyEmail: PATHS.verifyEmail,
  googleReturn: PATHS.googleReturn,
  confirmDelete: PATHS.confirmDelete,

  // ── Oturum-içi ──
  bookings: PATHS.bookings,
  lesson: (id: string | number) => `/ders-talepleri/${id}`,
  libraryReservation: (tur: "deneme" | "calisma", id: string | number) =>
    `/pano/rezervasyon/${tur}/${id}`,
  messages: PATHS.messages,
  /** Belirli bir kişiyle/kütüphaneyle sohbeti açar (to/name + opsiyonel role). */
  messageWith: (
    counterpartId: string | number,
    name: string,
    role?: "CLIENT" | "TUTOR" | "LIBRARY"
  ) =>
    `${PATHS.messages}?to=${counterpartId}&name=${encodeURIComponent(name)}${
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
  deepwork: PATHS.deepwork,
  grapher: PATHS.grapher,
  habits: PATHS.habits,
  srs: PATHS.srs,
  srsDeck: (id: string | number) => `/ogren/tekrar/deste/${id}`,
  srsStudy: (deckId: string | number) => `/ogren/tekrar/calis/${deckId}`,
  srsBrowser: PATHS.srsBrowser,
  srsStats: PATHS.srsStats,
  profile: PATHS.profile,
  profileEdit: PATHS.profileEdit,
  addresses: PATHS.addresses,
  settings: PATHS.settings,
  tutorListing: PATHS.tutorListing,
  tutorOnboarding: PATHS.tutorOnboarding,
  tutorPromotion: PATHS.tutorPromotion,
  tutorReviews: PATHS.tutorReviews,
  deliveryRun: (id: string | number) => `/dagitim/${id}`,
  deliveryRunHandover: (id: string | number) => `/dagitim/${id}/zimmet`,
  uyeProfili: (id: string | number) => `/uyeler/${id}`,
  operatorLibrary: PATHS.operatorLibrary,
  operatorSessions: PATHS.operatorSessions,
  admin: PATHS.admin,
  adminUsers: PATHS.adminUsers,
  adminUser: (role: "admin" | "tutor" | "client", id: string | number) =>
    `/yonetim/kullanicilar/${role}/${id}`,
  adminTutors: PATHS.adminTutors,
  adminTutorApplications: PATHS.adminTutorApplications,
  adminPromotions: PATHS.adminPromotions,
  adminDiplomas: PATHS.adminDiplomas,
  adminLibraries: PATHS.adminLibraries,
  adminExamCatalogs: PATHS.adminExamCatalogs,
  adminStoreRoot: PATHS.adminStoreRoot,
  adminStoreProducts: PATHS.adminStoreProducts,
  adminStoreCategories: PATHS.adminStoreCategories,
  adminStoreOrders: PATHS.adminStoreOrders,
  adminStoreReturns: PATHS.adminStoreReturns,
  adminStoreCoupons: PATHS.adminStoreCoupons,
  adminStoreStock: PATHS.adminStoreStock,
  adminStoreSupplier: PATHS.adminStoreSupplier,
  adminBlog: PATHS.adminBlog,
  adminBlogNew: PATHS.adminBlogNew,
  adminBlogEdit: (postId: string | number) => `/yonetim/blog/${postId}`,
  adminInventory: PATHS.adminInventory,
  adminInventoryCounts: PATHS.adminInventoryCounts,
  adminInventoryDamage: PATHS.adminInventoryDamage,
  adminInventoryMovements: PATHS.adminInventoryMovements,
  adminInventoryCount: (id: string | number) => `/yonetim/envanter/sayimlar/${id}`,
  adminPacking: PATHS.adminPacking,
  adminPackingPackages: PATHS.adminPackingPackages,
  adminPackingPackage: (id: string | number) => `/yonetim/paketleme/paket/${id}`,
  adminPackingReturns: PATHS.adminPackingReturns,
  adminDelivery: PATHS.adminDelivery,
  adminDeliveryOrders: PATHS.adminDeliveryOrders,
  adminDeliveryRuns: PATHS.adminDeliveryRuns,
  adminDeliveryRun: (id: string | number) => `/yonetim/dagitim/turlar/${id}`,
  adminDeliveryPerformance: PATHS.adminDeliveryPerformance,
  adminDeliveryCouriers: PATHS.adminDeliveryCouriers,
  adminDeliveryVehicles: PATHS.adminDeliveryVehicles,
  adminDeliveryBoard: PATHS.adminDeliveryBoard,
  adminBookings: PATHS.adminBookings,
  adminDemands: PATHS.adminDemands,
  adminNameChanges: PATHS.adminNameChanges,
  adminReports: PATHS.adminReports,
  adminAuditLogs: PATHS.adminAuditLogs,
  adminOperations: PATHS.adminOperations,
  adminPayouts: PATHS.adminPayouts,
  adminAccess: PATHS.adminAccess,
  adminSettings: PATHS.adminSettings,
  adminStoreHero: PATHS.adminStoreHero,
  adminAnnouncements: PATHS.adminAnnouncements,

  adminNew: PATHS.adminNew,
  adminNewProducts: PATHS.adminNewProducts,
  adminNewProductNew: PATHS.adminNewProductNew,
  adminNewProductEdit: (id: string | number) => `/yonetim-yeni/urunler/${id}`,
  adminNewStockCounts: PATHS.adminNewStockCounts,
  adminNewStockCount: (id: string | number) => `/yonetim-yeni/urunler/stok-sayimi/${id}`,
  adminNewStockMovements: PATHS.adminNewStockMovements,
  adminNewInventory: PATHS.adminNewInventory,
  adminNewDamageEvents: PATHS.adminNewDamageEvents,
  adminNewCategories: PATHS.adminNewCategories,
  adminNewReturns: PATHS.adminNewReturns,
  adminNewOrders: PATHS.adminNewOrders,
  adminNewCustomers: PATHS.adminNewCustomers,
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
  "preliminary-info": PATHS.preliminaryInfo,
  "ranking-criteria": PATHS.rankingCriteria,
  about: PATHS.about,
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
