import { ROUTES } from "@/lib/routes";

export type AdminNavGroup = "Platform" | "Eğitim" | "Ticaret" | "Operasyon" | "Güvenlik";

export interface AdminNavItem {
  label: string;
  shortLabel?: string;
  to: string;
  group: AdminNavGroup;
  description: string;
  icon: "overview" | "users" | "education" | "library" | "exam" | "store" | "delivery" | "booking" | "moderation" | "audit" | "access" | "settings";
  requiredPermission?: string;
  end?: boolean;
  badge?: "open-reports";
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    label: "Hakedişler",
    to: ROUTES.adminPayouts,
    group: "Ticaret",
    description: "Eğitmen ve kütüphanelere ödenecek tutarlar; yapılan havaleleri kaydedin.",
    icon: "store",
    requiredPermission: "payments.view",
  },
  {
    label: "Genel Bakış",
    to: ROUTES.admin,
    group: "Platform",
    description: "Platform sağlığı, bekleyen işler ve temel kullanıcı metrikleri.",
    icon: "overview",
    end: true,
    requiredPermission: "dashboard.view",
  },
  {
    label: "Kullanıcılar",
    to: ROUTES.adminUsers,
    group: "Platform",
    description: "Yönetici, eğitmen ve öğrenci hesaplarını görüntüleyin.",
    icon: "users",
    requiredPermission: "users.view",
  },
  {
    label: "Ayarlar",
    to: ROUTES.adminSettings,
    group: "Platform",
    description: "Ödeme kolu kapıları ve özellik bayrakları.",
    icon: "settings",
    requiredPermission: "settings.view",
  },
  {
    label: "Eğitmen İlanları",
    shortLabel: "Eğitmenler",
    to: ROUTES.adminTutors,
    group: "Eğitim",
    description: "Eğitmen başvurularını onaylayın, reddedin veya askıya alın.",
    icon: "education",
    requiredPermission: "tutors.view",
  },
  {
    label: "Diploma Doğrulama",
    shortLabel: "Diplomalar",
    to: ROUTES.adminDiplomas,
    group: "Eğitim",
    description: "Eğitmen belgelerini e-Devlet kayıtlarıyla doğrulayın.",
    icon: "education",
    requiredPermission: "tutors.view",
  },
  {
    label: "Rezervasyonlar",
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
    description: "Öğrencilerin açtığı ders taleplerini ve eğitmen yanıtlarını inceleyin.",
    icon: "booking",
    requiredPermission: "demands.view",
  },
  {
    label: "Kütüphaneler",
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
    to: ROUTES.adminStoreProducts,
    group: "Ticaret",
    description: "Ürün, kategori, sipariş, iade ve kupon operasyonları.",
    icon: "store",
    requiredPermission: "products.view",
  },
  {
    label: "Dağıtım",
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
    return ADMIN_NAV_ITEMS.find((item) => item.to === ROUTES.adminStoreProducts)!;
  }

  return (
    ADMIN_NAV_ITEMS.find((item) =>
      item.end ? pathname === item.to : pathname.startsWith(item.to)
    ) ?? ADMIN_NAV_ITEMS[0]
  );
}
