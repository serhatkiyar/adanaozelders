import { PATHS, ROUTES } from "@/lib/routes";
import { OGREN_ACIK, TALEPLER_ACIK } from "@/lib/ozellikBayraklari";

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
  | "calendar"
  | "trophy"
  | "learn"
  | "tasks"
  | "habit"
  | "library"
  | "tickets"
  | "wallet"
  | "store"
  | "shop";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: NavIcon;
  /**
   * Bölüm donduruldu (bkz. `lib/ozellikBayraklari.ts`). Girdi menüde GÖRÜNÜR
   * kalır ama bağlantı değildir, klavyeyle odaklanamaz ve "Yakında" rozeti
   * taşır. Menüyü çizen her yüzey (`DashboardHeader` üst bar + yan menü) bu
   * alanı okumak ZORUNDADIR; okumayan yüzey donmuş bölüme tıklatır.
   */
  yakinda?: boolean;
  /**
   * Bu öğeyi AKTİF sayan ek yollar (panel şeridi).
   *
   * `NavLink` yalnız kendi `to`suna bakar; alt sayfalar (ör. ilanı öne
   * çıkarma, ilan sihirbazı, ders detayı) hiçbir sekmeyi işaretlemiyordu ve
   * kullanıcı "neredeyim"i kaybediyordu. Yol öneki olarak eşleşir.
   */
  altYollar?: string[];
}

/**
 * Öğren TAM GİZLENİR, "Yakında" rozetiyle DURMAZ (5 Eyl 2026).
 *
 * Gerekçe: Öğren lansman hikâyesinin dışına alındı — vaat etmediğimiz bir şeyi
 * menüde "Yakında" diye tutmak kullanıcıya boş bir söz verir.
 *
 * (Bu paragraf eskiden Kütüphaneler ile karşılaştırma yapıyordu; Kütüphaneler
 * 7 Eyl 2026'da bu menülerden tümüyle çıktı — aşağıya bak.)
 */
/**
 * Kütüphaneler ve Mağaza bu iki menüden ÇIKTI (kullanıcı kararı, 7 Eyl 2026).
 *
 * Bunlar özel dersin yan paneline ait değil: özel ders paneli kişinin KENDİ
 * işini taşır (favorileri, mesajları, rezervasyonları, ilanı, bakiyesi).
 * Kütüphaneler ve Mağaza ayrı keşif yüzeyleridir ve kendi girişleri duruyor —
 * ana sayfadaki kategori çubuğu (`CategoryBar`) ve doğrudan rotaları
 * (`/kutuphaneler`, `/magaza`). Rotalar, sayfalar ve mağazanın kendi
 * gezinmesi DEĞİŞMEDİ; kaldırılan yalnız bu iki menü girdisi.
 *
 * Nöbetçi: `__guards__/yanPanelKapsami.test.ts`.
 */
export const UYE_NAV: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
  ...(TALEPLER_ACIK
    ? [{ to: ROUTES.demands, label: "Taleplerim", icon: "demand" } as NavItem]
    : []),
  ...(OGREN_ACIK
    ? [{ to: ROUTES.learn, label: "Öğren", icon: "learn" } as NavItem]
    : []),
  { to: ROUTES.bookings, label: "Rezervasyonlar", icon: "bookings" },
];

/**
 * EĞİTMENİN PANEL ŞERİDİ — kalıcı, yatay, altı sekme (kullanıcı, 8 Eyl 2026).
 *
 * Kullanıcı Superprof'un eğitmen panelini gösterdi: üst barın hemen altında
 * duran, sayfa değişse de yerinde kalan bir sekme satırı.
 *
 * BEŞ SEKME (8 Eyl 2026, ikinci tur). "Hesabım" şeritten ÇIKTI. Sebebi
 * ölçümdü: o ekranda fotoğraf, hiçbir yerden dolmayan bir "Hakkımda" ve
 * eğitim/diploma vardı; gerçek hesap ayarları ise ayrı bir sayfadaydı. Yani
 * panelde "Hesabım" ve "Ayarlar" diye iki jenerik etiket rakipti ve hangisinin
 * neyi taşıdığı sezilmiyordu. Taranan on özel ders platformunun HİÇBİRİNDE bu
 * ikisi eşit seviyede iki sekme değil: hesap ayarları ya profilin altında
 * (Superprof "Profilim > Hesabım", Lessonface "Profile > Account") ya da
 * avatar menüsünden açılan ayrı bir sayfa (Wyzant, Preply). Bizde ikincisi
 * seçildi — şerit EĞİTMENİN İŞİNİ taşır, avatar menüsü hesabını.
 *
 * Fotoğraf ve eğitim/diploma "İlanım"a taşındı (ikisi de ilana ait), kimlik
 * alanları zaten Ayarlar'daydı, "Hakkımda" ise ilandaki "Biyografi"nin
 * ikiziydi ve eğitmen yüzeyinden kaldırıldı. İlk denemede bu
 * yapılmadı — "Panom" avatar açılır menüsüne bir satır olarak eklendi, İlanım
 * ve Bakiyem de panonun İÇİNE kısayol oldu. Sonuç: panele giriş hâlâ tek bir
 * açılır menüydü ve gezinme üç ayrı yere dağılmıştı (menü + panonun içindeki
 * kısayol satırı + `TutorAccountLayout`'un sol menüsü).
 *
 * Şerit o üçünün yerine geçer. Eğitmenin İŞİ buradadır; avatar menüsünde
 * yalnız şeride girmeyenler (favoriler) ve her rolde ortak olanlar
 * (bildirimler, ayarlar, çıkış) kalır.
 *
 * Metin-only: ikon yok. Şerit altı öğe taşıyor ve mobilde yatay kayıyor;
 * ikon eklemek satırı kalabalıklaştırır, Superprof'ta da metindir.
 *
 * Nöbetçi: `__guards__/panoSeridi.test.tsx`.
 */
export const TUTOR_PANO_SEKMELERI: NavItem[] = [
  // Rota `ROUTES.bookings`; o URL rol'e göre ayrışıyor (`App.tsx::
  // BookingsHome`): eğitmene `TutorDashboard`, üyeye kendi rezervasyon
  // listesi. İlk denemede buraya `to: "/"` yazılmıştı ve "Pano" eğitmen
  // listesini açıyordu — nöbetçi bu düğümü çıpalar.
  {
    to: ROUTES.bookings,
    label: "Pano",
    end: true,
    // Ders detayı panonun alt sayfasıdır (panodaki karttan açılır).
    altYollar: [
      PATHS.lesson.replace(":id", ""),
      // Kütüphane rezervasyon detayı da panonun altındadır.
      PATHS.libraryReservation.replace(":tur/:id", ""),
      // Kazançlar sekmesi kaldırıldı (Bakiyem); özet kartlarından açılır.
      ROUTES.tutorEarnings,
    ],
  },
  { to: ROUTES.messages, label: "Mesajlarım" },
  {
    to: ROUTES.tutorListing,
    label: "İlanım",
    // Öne çıkarma ve ilan sihirbazı ilanın alt sayfalarıdır.
    altYollar: [ROUTES.tutorPromotion, ROUTES.tutorOnboarding],
  },
  { to: ROUTES.tutorReviews, label: "Değerlendirmeler" },
];

/**
 * Avatar açılır menüsü — şeride GİRMEYENLER.
 *
 * Panom ve Mesajlar buradan çıktı: ikisi de şeritte. Kalan tek canlı satır
 * Favorilerim; menünün geri kalanı (Hesabım, Bildirimler, Ayarlar, Çıkış)
 * `DashboardHeader` içinde her rol için sabittir.
 *
 * Favoriler eğitmene de açık (ÜK-6 · docs/urun-kararlari.md): eğitmen ders
 * verdiği kütüphaneyi ve meslektaşını işaretleyebilir. Üst bardaki TEK
 * kısayol da budur (ÜK-2) — üyeyle aynı davranış.
 */
export const TUTOR_NAV: NavItem[] = [
  { to: ROUTES.favorites, label: "Favorilerim", icon: "favorites" },
  ...(TALEPLER_ACIK
    ? [{ to: ROUTES.demands, label: "Gelen Talepler", icon: "demand" } as NavItem]
    : []),
  // Eğitmen de "Öğren" hub'ını görür (aralıklı tekrar, pomodoro,
  // grafik, alışkanlıklar…). Kendi kullanmadığı aracı öğrencisine
  // öneremez. Öğrenci verisine erişim açılmaz — K-6 sınırı (hiçbir admin/
  // eğitmen izni `srs_progress`/`srs_review_logs` okutmaz) yerinde durur;
  // buradaki tek değişiklik hub'ın kendi araçlarına erişimdir.
  ...(OGREN_ACIK
    ? [{ to: ROUTES.learn, label: "Öğren", icon: "learn" } as NavItem]
    : []),
];

// Kütüphane operatörü: özet panel + profil + operasyon + para + mesajlar.
export const OPERATOR_NAV: NavItem[] = [
  { to: "/", label: "Panel", icon: "dashboard", end: true },
  { to: ROUTES.operatorLibrary, label: "Kütüphanem", icon: "library" },
  { to: ROUTES.operatorSessions, label: "Oturumlar", icon: "tickets" },
  { to: ROUTES.balance, label: "Bakiyem", icon: "wallet" },
  { to: ROUTES.messages, label: "Mesajlar", icon: "messages" },
];

/**
 * Role göre üst bar navigasyonu — **ortak sayfaların tek kaynağı**.
 *
 * Bildirimler, Liderlik, Ayarlar, Profil, Görevler, Öğren ve Takvim
 * role-agnostiktir: her rol girebilir. Nav seçimi bu yedi sayfada tek tek
 * kopyalanmıştı ve hiçbiri `LIBRARY_OPERATOR`'ı tanımıyordu — operatör
 * bildirimlerine girdiğinde nav çubuğu ya BOŞ kalıyor ya da öğrenci menüsü
 * çıkıyordu; panele dönmek için logoya ya da tarayıcı geri tuşuna basmak
 * gerekiyordu (ölçüm §1.4, §6.1/7).
 *
 * Yeni rol eklendiğinde de tek yer değişsin diye dal burada durur; sayfalar
 * yalnız `navForRole(user?.role_id)` çağırır. ADMIN bilinçli olarak
 * `undefined` alır: admin yüzeyi kendi kabuğunu (`/yonetim`) kullanır ve
 * buradaki rol menülerinden hiçbiri ona ait değildir.
 */
export function navForRole(roleId: number | undefined | null): NavItem[] | undefined {
  switch (roleId) {
    case 2:
      return TUTOR_NAV;
    case 3:
      return UYE_NAV;
    case 4:
      return OPERATOR_NAV;
    default:
      return undefined;
  }
}

/**
 * Role göre PANEL ŞERİDİ — `navForRole`'ün ikizi, ayrı yüzey.
 *
 * Şu an yalnız eğitmende var (kullanıcı kararı, 8 Eyl 2026): üye tarafı bu
 * turda `AccountHub` + `Reservations` akışında bırakıldı, operatörün kendi
 * kabuğu zaten `OPERATOR_NAV`. Yeni rol şeride girdiğinde tek yer değişsin
 * diye dal burada durur; `DashboardShell` yalnız bunu çağırır.
 */
export function panoSekmeleriForRole(
  roleId: number | undefined | null
): NavItem[] | undefined {
  return roleId === 2 ? TUTOR_PANO_SEKMELERI : undefined;
}
