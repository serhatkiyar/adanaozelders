import { ROUTES } from "@/lib/routes";

export type AdminNavGroup = "Platform" | "Eğitim" | "Ticaret" | "Operasyon" | "Güvenlik";

export interface AdminNavItem {
  label: string;
  shortLabel?: string;
  to: string;
  group: AdminNavGroup;
  description: string;
  icon: "overview" | "users" | "education" | "library" | "exam" | "store" | "inventory" | "delivery" | "booking" | "moderation" | "audit" | "access" | "settings" | "announcement";
  /** Birden fazla kod verilirse HERHANGİ BİRİ yeter (ör. Mağaza: katalog VEYA içerik yetkisi). */
  requiredPermission?: string | string[];
  end?: boolean;
  badge?: "open-reports";
  /**
   * `G` dizisinden sonra basılan harf (İP-B1 · docs/tasarim-dili.md §4.4).
   *
   * Yalnız en sık kullanılan alanlara verilir; her öğeye kısayol vermek
   * hatırlanabilirliği yok eder. Harf TÜRKÇE etiketten türetilir ve tekilliği
   * `adminNavigation.test.ts`te sınanır — iki alan aynı harfi alırsa dizinin
   * hangisine gideceği yazım sırasına bağlı olurdu.
   */
  kisayol?: string;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    label: "Hakedişler",
    to: ROUTES.adminPayouts,
    group: "Ticaret",
    description:
      "Öğretmen ve kütüphanelere ödenecek tutarlar. Ödemeyi bankadan yapıp buraya kaydedin.",
    icon: "store",
    requiredPermission: "payments.view",
  },
  {
    label: "Genel Bakış",
    kisayol: "G",
    to: ROUTES.admin,
    group: "Platform",
    description: "Platform sağlığı, bekleyen işler ve temel kullanıcı metrikleri.",
    icon: "overview",
    end: true,
    requiredPermission: "dashboard.view",
  },
  {
    label: "Kullanıcılar",
    kisayol: "K",
    to: ROUTES.adminUsers,
    group: "Platform",
    description: "Yönetici, öğretmen ve öğrenci hesaplarını görüntüleyin.",
    icon: "users",
    requiredPermission: "users.view",
  },
  {
    label: "Ayarlar",
    kisayol: "A",
    to: ROUTES.adminSettings,
    group: "Platform",
    description: "Ödeme kolu kapıları ve özellik bayrakları.",
    icon: "settings",
    requiredPermission: "settings.view",
  },
  {
    label: "Öğretmen İlanları",
    kisayol: "T",
    shortLabel: "Öğretmenler",
    to: ROUTES.adminTutors,
    group: "Eğitim",
    description: "Öğretmen başvurularını onaylayın, reddedin veya askıya alın.",
    icon: "education",
    requiredPermission: "tutors.view",
  },
  {
    label: "Öğretmen Başvuruları",
    shortLabel: "Başvurular",
    to: ROUTES.adminTutorApplications,
    group: "Eğitim",
    description: "Ön başvuru formundan gelen adaylar; arama ve sonuç takibi.",
    icon: "education",
    requiredPermission: "tutors.view",
  },
  {
    label: "Öne Çıkarmalar",
    shortLabel: "Öne çıkarma",
    to: ROUTES.adminPromotions,
    group: "Ticaret",
    description: "Öğretmenlerin satın aldığı reklam paketleri; iptal ve iade.",
    icon: "education",
    requiredPermission: "promotions.view",
  },
  {
    label: "Diploma Doğrulama",
    shortLabel: "Diplomalar",
    to: ROUTES.adminDiplomas,
    group: "Eğitim",
    description: "Öğretmen belgelerini e-Devlet kayıtlarıyla doğrulayın.",
    icon: "education",
    requiredPermission: "tutors.view",
  },
  {
    label: "Rezervasyonlar",
    kisayol: "R",
    to: ROUTES.adminBookings,
    group: "Eğitim",
    description: "Ders rezervasyonlarını ve ihtilaf durumlarını yönetin.",
    icon: "booking",
    requiredPermission: "bookings.view",
  },
  {
    label: "Öğrenci Talepleri",
    shortLabel: "Talepler",
    to: ROUTES.adminDemands,
    group: "Eğitim",
    description: "Öğrencilerin açtığı ders taleplerini ve öğretmen yanıtlarını inceleyin.",
    icon: "booking",
    requiredPermission: "demands.view",
  },
  {
    label: "Blog",
    to: ROUTES.adminBlog,
    group: "Platform",
    description: "SEO ve rehber içerikleri: yazı oluşturun, düzenleyin ve yayımlayın.",
    icon: "announcement",
    requiredPermission: "content.view",
  },
  {
    label: "Kütüphaneler",
    kisayol: "L",
    to: ROUTES.adminLibraries,
    group: "Operasyon",
    description: "Kütüphane profilleri, operatörler ve ödeme ayarları.",
    icon: "library",
    requiredPermission: "libraries.view",
  },
  {
    label: "Deneme Katalogları",
    shortLabel: "Deneme Katalogları",
    to: ROUTES.adminExamCatalogs,
    group: "Operasyon",
    description: "Deneme sınavı kataloglarını ve cevap anahtarlarını yönetin.",
    icon: "exam",
    requiredPermission: "catalogs.view",
  },
  {
    label: "Mağaza",
    kisayol: "M",
    to: ROUTES.adminStoreRoot,
    group: "Ticaret",
    description: "Ürün kataloğu, siparişler, iadeler ve kuponlar.",
    icon: "store",
    // İçerik editörü (content.*) katalog yetkisi olmadan da Mağaza'ya girer;
    // alt-sekmeler kendi alanlarını `TAB_AREA` ile ayrıca süzer.
    requiredPermission: ["products.view", "content.view"],
  },
  {
    label: "Envanter",
    kisayol: "E",
    to: ROUTES.adminInventory,
    group: "Ticaret",
    description:
      "Stok sayımı, sayım farkının uygulanması ve hasarlı stok hareketleri. Defter salt okunur kalır; değişiklik yalnız buradan yapılır.",
    icon: "inventory",
    requiredPermission: "inventory.view",
  },
  {
    label: "Paketleme",
    kisayol: "P",
    to: ROUTES.adminPacking,
    group: "Ticaret",
    description:
      "Sipariş kutularının kalem kalem hazırlandığı istasyon: paket aç, her ürünü okut, kutuyu kapat. Sipariş ancak burada tamamlanınca dağıtıma hazır sayılır.",
    // Kendi glifi yok: ikon kümesi `AdminSidebar`'daki Record'a bağlı ve yeni
    // anahtar oraya da eklenmeyi gerektiriyor. Raf ikonu anlamca en yakını.
    icon: "inventory",
    requiredPermission: "packing.view",
  },
  {
    label: "Dağıtım",
    kisayol: "D",
    to: ROUTES.adminDelivery,
    group: "Ticaret",
    description: "Günlük turlar, hazırlık, kapasite ve kurye operasyonları.",
    icon: "delivery",
    requiredPermission: "delivery.view",
  },
  {
    label: "Ad Değişiklikleri",
    to: ROUTES.adminNameChanges,
    group: "Güvenlik",
    description: "Hesap adı ve kullanıcı adı değişikliklerini inceleyin.",
    icon: "users",
    requiredPermission: "users.view",
  },
  {
    label: "Şikâyetler",
    to: ROUTES.adminReports,
    group: "Güvenlik",
    description: "Açık şikâyetleri inceleyin ve moderasyon kararını kaydedin.",
    icon: "moderation",
    badge: "open-reports",
    requiredPermission: "reports.view",
  },
  {
    label: "Hata Çözme",
    to: ROUTES.adminOperations,
    group: "Platform",
    description:
      "Otomatik mutabakatın çözemediği para kayıtları ve tavana çarpmış bildirim işleri. Buradan para hareketi başlatılmaz; iş yeniden kuyruğa alınır.",
    icon: "audit",
    requiredPermission: "operations.view",
  },
  {
    label: "Denetim Kayıtları",
    to: ROUTES.adminAuditLogs,
    group: "Güvenlik",
    description: "Yönetim işlemlerini aktör, hedef ve aksiyon bazında inceleyin.",
    icon: "audit",
    requiredPermission: "audit.view",
  },
  {
    label: "Yetki Yönetimi",
    shortLabel: "Yetkiler",
    to: ROUTES.adminAccess,
    group: "Güvenlik",
    description: "Yönetici rollerini, izin kapsamlarını ve yönetici atamalarını yönetin.",
    icon: "access",
    requiredPermission: "admin_roles.view",
  },
];

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  "Platform",
  "Eğitim",
  "Ticaret",
  "Operasyon",
  "Güvenlik",
];

export function getAdminNavItem(pathname: string): AdminNavItem {
  if (pathname.startsWith("/yonetim/magaza/")) {
    return ADMIN_NAV_ITEMS.find((item) => item.to === ROUTES.adminStoreRoot)!;
  }

  // Fallback DİZİ SIRASINA bağlanamaz: `ADMIN_NAV_ITEMS[0]` bugün "Hakedişler"
  // (dizi sırası grup sırasıyla aynı değil), yani eşleşmeyen bir /yonetim/...
  // yolunda başlık ve breadcrumb "Hakedişler" görünüyordu. Genel Bakış'a
  // düşmek doğru: o, panelin kökü ve `end:true` olduğu için başka bir yolla
  // yanlışlıkla eşleşmez.
  const overview = ADMIN_NAV_ITEMS.find((item) => item.to === ROUTES.admin);
  return (
    ADMIN_NAV_ITEMS.find((item) =>
      item.end ? pathname === item.to : pathname.startsWith(item.to)
    ) ??
    overview ??
    ADMIN_NAV_ITEMS[0]
  );
}
