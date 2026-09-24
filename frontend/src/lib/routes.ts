// Uygulamanın TEK route kaynağı. Bileşenlere ham string path dağıtmayın;
// her zaman buradan tüketin.
//
// İki yüzey:
//  • Public (SEO): Türkçe/anlamlı path'ler.
//  • Oturum-içi: çoğunlukla DÜZ. Kök (`/`) bir "root dispatcher"dır: anonim →
//    public Landing, oturumlu → role workspace.
//  • Panel şeridinin sekmeleri de DÜZDÜR (`/takvim`, `/mesajlar`, `/ayarlar`
//    …); panonun kendisi `/genel-bakis`tir (22 Eyl 2026'ya kadar `/pano`;
//    kullanıcı kararı, 22 Eyl 2026).
//    8–22 Eyl 2026 arasında sekmeler `/pano/*` altındaydı; o adresler kalıcı
//    yönlendirme olarak yaşar (`App.tsx::LEGACY_STATIC`) — bildirim satırları
//    ve gönderilmiş e-postalar hâlâ onları taşıyor.
//
// `PATHS`  = react-router `path` desenleri (`:param` dahil) — `<Route path>` için.
// `ROUTES` = gezinme/`Link` için URL üreticileri; statikler PATHS'ten türer
//            (tek kaynak, literal drift yok), param'lılar fonksiyondur.

/** Ders sayfası adresinin sabit eki (sunucu: `core/seo_adres.py::DERS_EKI`). */
export const DERS_EKI = "ozel-ders";

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
  /**
   * Panonun kökü — rol dağıtıcısı (`App.tsx::BookingsHome`): eğitmene
   * `TutorDashboard`, öğrenciye `OgrenciPano` (Modül 4, 18 Eyl 2026).
   */
  bookings: "/genel-bakis",
  /**
   * Öğrencinin birleşik rezervasyon listesi (ders + deneme + çalışma alanı).
   * Modül 4'e kadar `/pano`nun kendisiydi; pano öğrenciye açılınca liste
   * şeridin ikinci sekmesine taşındı.
   */
  reservations: "/dersler",
  /** Kütüphane rezervasyon detayı. `tur`: `deneme` | `calisma`.
   *  Kapıda söylenecek giriş kodu URL'lenebilir olmalı — bildirimden ya da
   *  telefondan tek tıkla açılsın diye ayrı bir yol var. */
  libraryReservation: "/rezervasyon/:tur/:id",
  /** Ders/talep detayı — CLIENT + TUTOR ortak. */
  lesson: "/ders-talepleri/:id",
  /** Canlı ders odası (Zoom Video SDK). Kabuk DIŞINDA tam ekran; giriş ve
   *  çıkış tam sayfa yüklemesiyle yapılır (bkz. `lib/tamSayfaGezinme.ts`). */
  canliDers: "/canli-ders/:id",
  messages: "/mesajlar",
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
  /** Kütüphane operatörünün kazanç & ödeme bakiyesi. Öğretmenin ayrı kazanç
   *  ekranı yok; cüzdanı üst bardadır (23 Eyl 2026). */
  balance: "/bakiyem",
  /**
   * Eğitmen takvimi — saat ızgarası, izin ekleme (Modül 7). `calendar` ile
   * AYNI adres: `/takvim` rol dağıtıcısıdır (`App.tsx::TakvimDispatcher`).
   */
  tutorCalendar: "/takvim",
  /** Eğitmen analizleri — genel bakış ve başarı hedefleri (Modül 7). */
  tutorAnalytics: "/analizler",
  /**
   * Eğitmenin öğrenci listesi (şerit sekmesi, 22 Eyl 2026). Ayrı kişi sayfası
   * (`/uyeler/:id`) 23 Eyl 2026'da kaldırıldı; eski `/uyeler/:id` ve
   * `/ogrenciler/:id` adresleri `App.tsx`te bu listeye yönlenir.
   */
  tutorStudents: "/ogrenciler",
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
  profile: "/hesabim",
  /** Profil bilgileri editörü (about/eğitim/avatar) — hub'dan erişilir. */
  profileEdit: "/hesabim/profil",
  /** Teslimat adresleri (CLIENT) — mağaza + ders ortak. */
  addresses: "/adreslerim",
  /**
   * Ayarlar — her rolde hesap ayarları (`Settings`). 23 Eyl 2026'ya kadar
   * öğrenciye kartlı hesap merkezi (`AccountHub`) açılıyordu.
   */
  settings: "/ayarlar",
  /** Hesap ayarları sayfasının (`Settings`) her rolde açılan adresi. */
  accountSettings: "/ayarlar/hesap",
  tutorListing: "/profil",
  /**
   * İlan oluşturma sihirbazı — kayıt olan eğitmenin ilk durağı.
   * `/profil` MEVCUT ilanın editörüdür ("Profilim" sekmesi); ikisi bilerek ayrıdır. Sihirbaz
   * şeritte değil — tek seferlik bir kurulum akışıdır, panelin bir bölümü değil.
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
  tutorReviews: "/degerlendirmeler",
  /** Dağıtıcı saha ekranı — kendi-filo teslimat turu (ADMIN + KURYE). */
  deliveryRun: "/dagitim/:id",
  /** Zimmet ekranı — paketleri araca alma (ADMIN + KURYE, F30 §3.4). */
  deliveryRunHandover: "/dagitim/:id/zimmet",
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
  adminNewDefinitions: "/yonetim-yeni/urunler/tanimlamalar",
  adminNewCategories: "/yonetim-yeni/urunler/kategoriler",
  adminNewSuppliers: "/yonetim-yeni/urunler/tedarikciler",
  adminNewReturns: "/yonetim-yeni/siparisler/iadeler",
  adminNewCustomer: "/yonetim-yeni/musteriler/:role/:id",
  adminNewOrders: "/yonetim-yeni/siparisler",
  adminNewOrderDetail: "/yonetim-yeni/siparisler/:id",
  adminNewCustomers: "/yonetim-yeni/musteriler",
  adminNewGeneralSettings: "/yonetim-yeni/ayarlar/genel",
  adminNewStaffPermissions: "/yonetim-yeni/ayarlar/personel-yetkiler",
  adminNewOperations: "/yonetim-yeni/ayarlar/hata-cozme",
  adminNewPacking: "/yonetim-yeni/paketleme",
  adminNewPackingPackages: "/yonetim-yeni/paketleme/paketler",
  adminNewPackingPackage: "/yonetim-yeni/paketleme/paket/:id",
  adminNewPackingReturns: "/yonetim-yeni/paketleme/geri-donus",
  adminNewDelivery: "/yonetim-yeni/dagitim",
  adminNewDeliveryOrders: "/yonetim-yeni/dagitim/siparisler",
  adminNewDeliveryRuns: "/yonetim-yeni/dagitim/turlar",
  adminNewDeliveryRunDetail: "/yonetim-yeni/dagitim/turlar/:id",
  adminNewDeliveryCouriers: "/yonetim-yeni/dagitim/kuryeler",
  adminNewDeliveryVehicles: "/yonetim-yeni/dagitim/araclar",
  adminNewDeliveryPerformance: "/yonetim-yeni/dagitim/performans",
  adminNewDeliveryBoard: "/yonetim-yeni/dagitim/tahta",
  adminNewTutors: "/yonetim-yeni/egitmenler",
  adminNewTutorApplications: "/yonetim-yeni/egitmenler/on-basvurular",
  adminNewTutorDiplomas: "/yonetim-yeni/egitmenler/diplomalar",
  adminNewTutorPromotions: "/yonetim-yeni/egitmenler/one-cikarmalar",
  adminNewLibraries: "/yonetim-yeni/kutuphaneler",
  adminNewExamCatalogs: "/yonetim-yeni/kutuphaneler/deneme-kataloglari",
  adminNewBookings: "/yonetim-yeni/rezervasyonlar",
  adminNewDemands: "/yonetim-yeni/talepler",
  adminNewReports: "/yonetim-yeni/moderasyon/sikayetler",
  adminNewNameChanges: "/yonetim-yeni/moderasyon/ad-degisiklikleri",
  adminNewPayouts: "/yonetim-yeni/finans/hakedisler",
  adminNewBlog: "/yonetim-yeni/pazarlama/blog",
  adminNewBlogNew: "/yonetim-yeni/pazarlama/blog/yeni",
  adminNewBlogEdit: "/yonetim-yeni/pazarlama/blog/:postId",
  adminNewAuditLogs: "/yonetim-yeni/ayarlar/denetim-kayitlari",
  adminNewCoupons: "/yonetim-yeni/indirimler/kuponlar",

  // ── Kök SEO adresleri (Modül 6) ──
  // Alan adı zaten "adanaozelders.com.tr": önek YOK. Bu iki desen rota
  // tablosunun EN SONUNDA, 404'ten hemen önce durur; React Router statik
  // parçayı dinamik parçadan önce eşlediği için mevcut hiçbir rotayı gölgelemez.
  // Hangi adresin ne olduğunu sunucu söyler (`GET /seo/sayfa`); kök adlar
  // sunucuda rezervedir (`backend/core/seo_adres.py::REZERVE_ADLAR`).
  /** İlan (`/lgs-yks-matematik-seyhan`) ya da ders sayfası (`/matematik-ozel-ders`). */
  kokAdres: "/:kokSlug",
  /** İlçe + ders sayfası (`/seyhan/matematik-ozel-ders`). */
  ilceDersSayfasi: "/:ilce/:dersSayfasi",
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
  reservations: PATHS.reservations,
  lesson: (id: string | number) => `/ders-talepleri/${id}`,
  canliDers: (id: string | number) => `/canli-ders/${id}`,
  libraryReservation: (tur: "deneme" | "calisma", id: string | number) =>
    `/rezervasyon/${tur}/${id}`,
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
  tutorCalendar: PATHS.tutorCalendar,
  tutorAnalytics: PATHS.tutorAnalytics,
  tutorStudents: PATHS.tutorStudents,
  /** Takvimi, ders teklif penceresi bu öğrenci seçili açılacak şekilde açar. */
  dersPlanla: (clientId: number) => `${PATHS.tutorCalendar}?ogrenci=${clientId}`,
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
  accountSettings: PATHS.accountSettings,
  tutorListing: PATHS.tutorListing,
  tutorOnboarding: PATHS.tutorOnboarding,
  tutorPromotion: PATHS.tutorPromotion,
  tutorReviews: PATHS.tutorReviews,
  deliveryRun: (id: string | number) => `/dagitim/${id}`,
  deliveryRunHandover: (id: string | number) => `/dagitim/${id}/zimmet`,
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
  adminNewDefinitions: PATHS.adminNewDefinitions,
  adminNewCategories: PATHS.adminNewCategories,
  adminNewSuppliers: PATHS.adminNewSuppliers,
  adminNewReturns: PATHS.adminNewReturns,
  adminNewCustomer: (role: "admin" | "tutor" | "client", id: string | number) => `/yonetim-yeni/musteriler/${role}/${id}`,
  adminNewOrders: PATHS.adminNewOrders,
  adminNewOrder: (id: string | number) => `/yonetim-yeni/siparisler/${id}`,
  adminNewCustomers: PATHS.adminNewCustomers,
  adminNewGeneralSettings: PATHS.adminNewGeneralSettings,
  adminNewStaffPermissions: PATHS.adminNewStaffPermissions,
  adminNewOperations: PATHS.adminNewOperations,
  adminNewPacking: PATHS.adminNewPacking,
  adminNewPackingPackages: PATHS.adminNewPackingPackages,
  adminNewPackingPackage: (id: string | number) => `/yonetim-yeni/paketleme/paket/${id}`,
  adminNewPackingReturns: PATHS.adminNewPackingReturns,
  adminNewDelivery: PATHS.adminNewDelivery,
  adminNewDeliveryOrders: PATHS.adminNewDeliveryOrders,
  adminNewDeliveryRuns: PATHS.adminNewDeliveryRuns,
  adminNewDeliveryRun: (id: string | number) => `/yonetim-yeni/dagitim/turlar/${id}`,
  adminNewDeliveryCouriers: PATHS.adminNewDeliveryCouriers,
  adminNewDeliveryVehicles: PATHS.adminNewDeliveryVehicles,
  adminNewDeliveryPerformance: PATHS.adminNewDeliveryPerformance,
  adminNewDeliveryBoard: PATHS.adminNewDeliveryBoard,
  adminNewTutors: PATHS.adminNewTutors,
  adminNewTutorApplications: PATHS.adminNewTutorApplications,
  adminNewTutorDiplomas: PATHS.adminNewTutorDiplomas,
  adminNewTutorPromotions: PATHS.adminNewTutorPromotions,
  adminNewLibraries: PATHS.adminNewLibraries,
  adminNewExamCatalogs: PATHS.adminNewExamCatalogs,
  adminNewBookings: PATHS.adminNewBookings,
  adminNewDemands: PATHS.adminNewDemands,
  adminNewReports: PATHS.adminNewReports,
  adminNewNameChanges: PATHS.adminNewNameChanges,
  adminNewPayouts: PATHS.adminNewPayouts,
  adminNewBlog: PATHS.adminNewBlog,
  adminNewBlogNew: PATHS.adminNewBlogNew,
  adminNewBlogEdit: (postId: string | number) => `/yonetim-yeni/pazarlama/blog/${postId}`,
  adminNewAuditLogs: PATHS.adminNewAuditLogs,
  adminNewCoupons: PATHS.adminNewCoupons,

  // ── Kök SEO adresleri (Modül 6) ──
  /** İlan sayfası — sunucunun verdiği `url_slug` ile. Eğitmen linki için `ilanYolu`. */
  ilan: (urlSlug: string) => `/${urlSlug}`,
  /** Ders sayfası: `matematik` → `/matematik-ozel-ders`. */
  dersSayfasi: (dersSlug: string) => `/${dersSlug}-${DERS_EKI}`,
  /** İlçe + ders sayfası: `/seyhan/matematik-ozel-ders`. */
  ilceDersSayfasi: (ilceSlug: string, dersSlug: string) =>
    `/${ilceSlug}/${dersSlug}-${DERS_EKI}`,
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

/**
 * "Profilim" sayfasının bölümleri (24 Eyl 2026, Preply "My profile" düzeni):
 * her bölüm ayrı sekmede açılır ve kendi Kaydet'iyle yalnız kendi alanlarını
 * yazar. Adres `?bolum=` ile taşınır; tanınmayan değer ilk bölüme düşer.
 */
export const PROFILIM_BOLUMLERI = [
  "hakkinda",
  "fotograf",
  "aciklama",
  "video",
  "dersler",
  "ucret",
  "musaitlik",
  "egitim",
] as const;
export type ProfilimBolumu = (typeof PROFILIM_BOLUMLERI)[number];

export function profilimBolumu(bolum: ProfilimBolumu): string {
  return `${ROUTES.tutorListing}?bolum=${bolum}`;
}

/**
 * Eğitmenin site içi adresi — TEK kapı (Modül 6).
 *
 * İlan yayına ilk girdiğinde sunucu kök bir adres verir (`url_slug`); site
 * içindeki her eğitmen linki ona gider. Adresi olmayan (hiç yayınlanmamış)
 * eğitmende eski `/egitmenler/<isim-id>` kullanılır — o rota sayfayı açar,
 * adres doğunca da kendiliğinden yeniye yönlenir.
 */
export function ilanYolu(t: {
  id: number;
  slug?: string | null;
  url_slug?: string | null;
}): string {
  return t.url_slug ? ROUTES.ilan(t.url_slug) : ROUTES.tutor(tutorSlug(t));
}

// Eğitmen için ESKİ slug (isim-{id}); yoksa id'ye düş. Yalnız eski adres ve
// id çözümü için — gezinme linkleri `ilanYolu` kullanır.
export function tutorSlug(t: { id: number; slug?: string | null }): string {
  return t.slug ?? String(t.id);
}

// Slug ("ahmet-yilmaz-42") ya da salt id'den sayısal eğitmen id'sini çıkarır.
export function parseTutorId(slugOrId: string | undefined): number {
  if (!slugOrId) return NaN;
  const m = slugOrId.match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}
