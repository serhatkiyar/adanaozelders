/**
 * ── Testlerin admin oturumu için TAM izin listesi (İP-A8 · Görev 1 · B-5) ──
 *
 * Neden var: çalışma zamanı kapısı oturumu `admin_permissions: ["*"]` ile
 * kuruyordu. Joker diye bir şey **yok** — ne backend kataloğunda
 * (`backend/core/admin_permissions.py::PERMISSION_CATALOG`) ne
 * `lib/adminAccess.ts`te. `adminAreaAccess` tam kodu arar
 * (`permissions.includes("libraries.manage")`), dolayısıyla `["*"]` taşıyan
 * oturum panelde YETKİSİZDİR: 88 ekranın 14'ü ekran yerine
 * "Bu alan için yetkiniz yok" kutusu basıyordu ve kapı onu "ölçüldü" sayıyordu
 * (bağımsız denetim #3 · B-5; ölçülen kontrol 60 yerine 39).
 *
 * Doğru düzeltmenin `adminAreaAccess`e joker EKLEMEK olmadığı da ölçüldü:
 * backend hiçbir yerde `"*"` üretmez (`/auth/me` her zaman açık kod listesi
 * döndürür, `schemas/user.py` varsayılanı `[]`), yani jokeri kabul etmek
 * üretimde HİÇ oluşmayan bir durumu test yolunda meşrulaştırmak olurdu —
 * fixture ile üretim arasındaki sapmayı kapatmak yerine kalıcılaştırmak.
 * Kusur fixture'daydı; düzeltme de fixture'da.
 *
 * Liste backend kataloğunun aynasıdır. Sapması sessiz kalmaz: kapı her ekranı
 * mount edip **403 kutusu basmadığını** ayrıca doğrular (`calismaZamaniKapisi`),
 * yani yeni bir izin alanı doğduğunda ve buraya yazılmadığında kapı kırmızı
 * düşer.
 */
export const TAM_ADMIN_IZINLERI: readonly string[] = [
  // Platform
  "dashboard.view",
  "users.view",
  "users.manage",
  "settings.view",
  "settings.manage",
  "operations.view",
  "operations.manage",
  // Eğitim
  "tutors.view",
  "tutors.manage",
  "bookings.view",
  "bookings.manage",
  "demands.view",
  "demands.manage",
  "srs_platform.view",
  "srs_platform.manage",
  // Operasyon
  "libraries.view",
  "libraries.manage",
  "catalogs.view",
  "catalogs.manage",
  // Ticaret
  "products.view",
  "products.manage",
  "orders.view",
  "orders.manage",
  "returns.view",
  "returns.manage",
  "coupons.view",
  "coupons.manage",
  "delivery.view",
  "delivery.manage",
  "payments.view",
  "payments.manage",
  "inventory.view",
  "inventory.count",
  "inventory.apply",
  "packing.view",
  "packing.pack",
  "packing.manage",
  // Tedarikçi senkronu — `products.*` bilinçli olarak yeniden kullanılmadı
  // (token bir sırdır; sözleşme §3).
  "suppliers.view",
  "suppliers.manage",
  // Güvenlik
  "reports.view",
  "reports.manage",
  "audit.view",
  "admin_roles.view",
  "admin_roles.manage",
];
