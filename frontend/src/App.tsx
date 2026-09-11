import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { trackPageview } from "@/lib/analytics";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";
import { FullScreenSpinner } from "@/components/Spinner";
import { KesifKabugu } from "@/components/kesif/KesifKabugu";
import { ALISVERIS_ROLLERI } from "@/lib/roles";
import { ROLE_IDS } from "@/types";
import { ROUTES, PATHS } from "@/lib/routes";
import {
  DENEMELER_ACIK,
  KUTUPHANELER_ACIK,
  OGREN_ACIK,
  TALEPLER_ACIK,
} from "@/lib/ozellikBayraklari";
import { PublicRoute } from "@/routes/PublicRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { LegacyRedirect } from "@/routes/LegacyRedirect";
import { useAuthStore } from "@/store/authStore";
import { useWsStore } from "@/store/wsStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
// Landing kök (`/`) yüzeyidir + prerender/SEO hedefi → eager (kod bölünmez).
import Landing from "@/pages/Landing";
import { NiyetUygulayici } from "@/components/NiyetUygulayici";
import { StoreFavoritesSync } from "@/components/StoreFavoritesSync";
import { rtcManager } from "@/lib/rtcTransfer";

// Her ziyaretçiye inen ama NADİREN açılan üç yüzey. Giriş paketinden çıkarıldı:
// canlı ders penceresi yalnız derse katılınca, odak zamanlayıcı yalnız
// başlatılınca, giriş modalı yalnız tıklanınca gerekir. Üçü de kapalıyken
// `null` render ettiğinden Suspense fallback'i de `null`.
const GlobalMeeting = lazy(() =>
  import("@/components/GlobalMeeting").then((m) => ({ default: m.GlobalMeeting }))
);
const DeepWorkTimer = lazy(() =>
  import("@/components/DeepWorkTimer").then((m) => ({ default: m.DeepWorkTimer }))
);
const AuthModal = lazy(() =>
  import("@/components/AuthModal").then((m) => ({ default: m.AuthModal }))
);

// ── Route-level code splitting: ağır modüller talep üzerine yüklenir ──
const MarketplacePage = lazy(() => import("@/pages/MarketplacePage"));
const TutorProfilePage = lazy(() => import("@/pages/TutorProfilePage"));
const Libraries = lazy(() => import("@/pages/Libraries"));
const Yakinda = lazy(() => import("@/pages/Yakinda"));
const LibraryDetail = lazy(() => import("@/pages/LibraryDetail"));
const LibraryRegister = lazy(() => import("@/pages/LibraryRegister"));
// Mağaza (D&R tarzı) — katalog/detay/sepet public; ödeme/siparişler oturum-içi
const StorePage = lazy(() => import("@/pages/store/StorePage"));
const OkulaDonusKampanyasi = lazy(() => import("@/pages/store/vitrin/OkulaDonusKampanyasi"));
const ProductDetailPage = lazy(() => import("@/pages/store/ProductDetailPage"));
const SellerStorePage = lazy(() => import("@/pages/store/SellerStorePage"));
const CartPage = lazy(() => import("@/pages/store/CartPage"));
const FavoritesPage = lazy(() => import("@/pages/store/FavoritesPage"));
const SharedCollectionPage = lazy(() => import("@/pages/store/SharedCollectionPage"));
const CargoTrackingPage = lazy(() => import("@/pages/store/CargoTrackingPage"));
const AccountHub = lazy(() => import("@/pages/AccountHub"));
const AddressesPage = lazy(() => import("@/pages/AddressesPage"));
const CheckoutPage = lazy(() => import("@/pages/store/CheckoutPage"));
const OrdersPage = lazy(() => import("@/pages/store/OrdersPage"));
const OrderDetailPage = lazy(() => import("@/pages/store/OrderDetailPage"));
const SellerProducts = lazy(() => import("@/pages/store/SellerProducts"));
// Yasal sayfalar — tek chunk, belge prop'la seçilir (içerik lib/legalContent.ts)
const LegalPage = lazy(() => import("@/pages/LegalPage"));
const BlogListPage = lazy(() => import("@/pages/blog/BlogListPage"));
const BlogPostPage = lazy(() => import("@/pages/blog/BlogPostPage"));
const FaqPage = lazy(() => import("@/pages/FaqPage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
// Eğitmen ön başvurusu — sosyal medyada paylaşılan hesapsız lead sayfası.
const TutorPreApply = lazy(() => import("@/pages/tutorPreApply/TutorPreApply"));
const OperatorHome = lazy(() => import("@/pages/dashboards/OperatorHome"));
// Kurye açılış ekranı (rol 5) — menüsüz; aktif tura yönlendirir.
const CourierHome = lazy(() => import("@/pages/dashboards/CourierHome"));
const OperatorLibrary = lazy(() => import("@/pages/dashboards/OperatorLibrary"));
const OperatorSessions = lazy(() => import("@/pages/dashboards/OperatorSessions"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));
const GoogleDonus = lazy(() => import("@/pages/GoogleDonus"));
const HesapSilmeOnayi = lazy(() => import("@/pages/HesapSilmeOnayi"));
const AdminLayout = lazy(() => import("@/components/admin/layout/AdminLayout"));
const PanelShell = lazy(() => import("@/panel/layout/PanelShell").then((m) => ({ default: m.PanelShell })));
const GostergePaneli = lazy(() =>
  import("@/panel/pages/gosterge/GostergePaneli").then((m) => ({ default: m.GostergePaneli })),
);
const StokSayimiListesi = lazy(() =>
  import("@/panel/pages/urunler/StokSayimiListesi").then((m) => ({ default: m.StokSayimiListesi })),
);
const StokSayimiDetayi = lazy(() =>
  import("@/panel/pages/urunler/StokSayimiDetayi").then((m) => ({ default: m.StokSayimiDetayi })),
);
const UrunListesi = lazy(() =>
  import("@/panel/pages/urunler/UrunListesi").then((m) => ({ default: m.UrunListesi })),
);
const UrunFormu = lazy(() =>
  import("@/panel/pages/urunler/UrunFormu").then((m) => ({ default: m.UrunFormu })),
);
const SiparisListesi = lazy(() =>
  import("@/panel/pages/siparisler/SiparisListesi").then((m) => ({ default: m.SiparisListesi })),
);
const MusteriListesi = lazy(() =>
  import("@/panel/pages/musteriler/MusteriListesi").then((m) => ({ default: m.MusteriListesi })),
);
const AdminDashboardPage = lazy(() => import("@/pages/admin/AdminDashboardPage"));
const AdminSectionPage = lazy(() => import("@/pages/admin/AdminSectionPage"));
const AdminOperationsPage = lazy(() => import("@/pages/admin/AdminOperationsPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminUserDetailPage = lazy(() => import("@/pages/admin/AdminUserDetailPage"));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin/AdminAuditLogsPage"));
const AdminPayoutsPage = lazy(() => import("@/pages/admin/AdminPayoutsPage"));
const AdminReportsPage = lazy(() => import("@/pages/admin/AdminReportsPage"));
const AdminDemandsPage = lazy(() => import("@/pages/admin/AdminDemandsPage"));
const AdminBookingsPage = lazy(() => import("@/pages/admin/AdminBookingsPage"));
const AdminAccessPage = lazy(() => import("@/pages/admin/AdminAccessPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/AdminSettingsPage"));
const AdminLibraries = lazy(() => import("@/pages/dashboards/AdminLibraries"));
const AdminExamCatalogs = lazy(() => import("@/pages/dashboards/AdminExamCatalogs"));
const AdminStore = lazy(() => import("@/pages/dashboards/AdminStore"));
// Blog editörü (TipTap) yalnız bu chunk'la gelir — public bundle'a girmez.
const AdminBlogListPage = lazy(() => import("@/pages/admin/blog/AdminBlogListPage"));
const AdminBlogEditorPage = lazy(() => import("@/pages/admin/blog/AdminBlogEditorPage"));
const InventoryLayout = lazy(() => import("@/pages/admin/inventory/InventoryLayout"));
const InventoryOverviewPage = lazy(() => import("@/pages/admin/inventory/InventoryOverviewPage"));
const CountSessionsPage = lazy(() => import("@/pages/admin/inventory/CountSessionsPage"));
const CountSessionDetailPage = lazy(() => import("@/pages/admin/inventory/CountSessionDetailPage"));
const DamageEventsPage = lazy(() => import("@/pages/admin/inventory/DamageEventsPage"));
const StockMovementsPanel = lazy(() =>
  import("@/components/admin/StockMovementsPanel").then((module) => ({ default: module.StockMovementsPanel }))
);
const PackingLayout = lazy(() => import("@/pages/admin/packing/PackingLayout"));
const PackingQueuePage = lazy(() => import("@/pages/admin/packing/PackingQueuePage"));
const PackingStationPage = lazy(() => import("@/pages/admin/packing/PackingStationPage"));
const PackagesPage = lazy(() => import("@/pages/admin/packing/PackagesPage"));
const ReturnQueuePage = lazy(() => import("@/pages/admin/packing/ReturnQueuePage"));
const DeliveryLayout = lazy(() => import("@/pages/admin/delivery/DeliveryLayout"));
const DeliveryTodayPage = lazy(() => import("@/pages/admin/delivery/DeliveryTodayPage"));
const DeliveryOrdersPage = lazy(() => import("@/pages/admin/delivery/DeliveryOrdersPage"));
const DeliveryRunsPage = lazy(() => import("@/pages/admin/delivery/DeliveryRunsPage"));
const DeliveryRunDetailPage = lazy(() => import("@/pages/admin/delivery/DeliveryRunDetailPage"));
const DeliveryPerformancePage = lazy(() => import("@/pages/admin/delivery/DeliveryPerformancePage"));
const DeliveryCouriersPage = lazy(() => import("@/pages/admin/delivery/DeliveryCouriersPage"));
const DeliveryVehiclesPage = lazy(() => import("@/pages/admin/delivery/DeliveryVehiclesPage"));
const DeliveryBoardPage = lazy(() => import("@/pages/admin/delivery/DeliveryBoardPage"));
const DeliveryDriver = lazy(() => import("@/pages/DeliveryDriver"));
// Zimmet (paketi araca alma) saha ekranından AYRI bir rotadır: aynı sayfada
// sekme olsaydı, kurye kapıda yanlış moda düşebilirdi (sözleşme §3.4).
const DeliveryRunHandover = lazy(() => import("@/pages/DeliveryRunHandover"));
const TutorDashboard = lazy(() => import("@/pages/TutorDashboard"));
const TutorSettings = lazy(() => import("@/pages/TutorSettings"));
const IlanSihirbazi = lazy(
  () => import("@/pages/tutorOnboarding/IlanSihirbazi"),
);
const TutorPromotion = lazy(() => import("@/pages/TutorPromotion"));
const TutorReviews = lazy(() => import("@/pages/TutorReviews"));
const AdminPromotionsPage = lazy(() => import("@/pages/admin/AdminPromotionsPage"));
const AdminTutorApplicationsPage = lazy(
  () => import("@/pages/admin/AdminTutorApplicationsPage")
);
const TutorQuestions = lazy(() => import("@/pages/TutorQuestions"));
const Favorites = lazy(() => import("@/pages/Favorites"));
const FavorilerGirisDaveti = lazy(() => import("@/pages/FavorilerGirisDaveti"));
const UyeProfili = lazy(() => import("@/pages/UyeProfili"));
const Questions = lazy(() => import("@/pages/Questions"));
const Exams = lazy(() => import("@/pages/Exams"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const LessonDetail = lazy(() => import("@/pages/LessonDetail"));
const LibraryReservationDetail = lazy(() => import("@/pages/LibraryReservationDetail"));
const Messages = lazy(() => import("@/pages/Messages"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Learn = lazy(() => import("@/pages/Learn"));
const DeepWork = lazy(() => import("@/pages/DeepWork"));
const Grapher = lazy(() => import("@/pages/Grapher"));
const Habits = lazy(() => import("@/pages/Habits"));
// Aralıklı tekrar (FSRS, İP-16)
const SrsDecks = lazy(() => import("@/pages/srs/SrsDecks"));
const SrsDeckDetail = lazy(() => import("@/pages/srs/SrsDeckDetail"));
const SrsStudy = lazy(() => import("@/pages/srs/SrsStudy"));
const SrsBrowser = lazy(() => import("@/pages/srs/SrsBrowser"));
const SrsStats = lazy(() => import("@/pages/srs/SrsStats"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Profile = lazy(() => import("@/pages/Profile"));
const MessageCenter = lazy(() => import("@/pages/MessageCenter"));
const Settings = lazy(() => import("@/pages/Settings"));
const Balance = lazy(() => import("@/pages/Balance"));
const Demands = lazy(() => import("@/pages/Demands"));
const Notifications = lazy(() => import("@/pages/Notifications"));
// Geliştirme prototipi: canlı ders (Jitsi) önizleme (/test-canli-ders)
const TestLiveLesson = lazy(() => import("@/pages/TestLiveLesson"));
// Geliştirme prototipi: kütüphane kartı tasarım karşılaştırması (/test-kutuphane-karti)
const LibraryCardTest = lazy(() => import("@/pages/LibraryCardTest"));
// Bilinmeyen URL'ler — shell-uyarlamalı 404 (sessiz redirect yerine)
const NotFound = lazy(() => import("@/pages/NotFound"));

function WsManager() {
  const token = useAuthStore((s) => s.token);
  const { connect, disconnect, socket } = useWsStore();
  const qc = useQueryClient();

  useEffect(() => {
    if (token) {
      connect(token);
    } else {
      disconnect();
    }
  }, [token, connect, disconnect]);

  useEffect(() => {
    if (!socket) return;

    // Hızlı bildirim seli (ör. art arda mesaj) tek refetch'e insin diye invalidate'leri
    // kısa bir pencerede birleştir (coalesce): aynı query key 250 ms içinde bir kez
    // geçersiz kılınır. Böylece her WS mesajında tüm listeler yeniden çekilmez.
    const pending = new Map<string, readonly unknown[]>();
    let flush: ReturnType<typeof setTimeout> | null = null;
    const invalidate = (queryKey: readonly unknown[]) => {
      pending.set(JSON.stringify(queryKey), queryKey);
      if (flush) return;
      flush = setTimeout(() => {
        const keys = [...pending.values()];
        pending.clear();
        flush = null;
        for (const queryKey of keys) qc.invalidateQueries({ queryKey });
      }, 250);
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "NEW_MESSAGE") {
          // Yalnız ilgili sohbeti + liste/okunmamış sayacını tazele (tüm thread'leri DEĞİL).
          const convId = msg.data?.conversation_id;
          invalidate(convId != null ? ["messages", convId] : ["messages"]);
          invalidate(["messages", "unread"]);
          invalidate(["conversations"]);
        } else if (msg.type === "NEW_NOTIFICATION") {
          invalidate(["notifications"]);
        } else if (msg.type === "BOOKING_UPDATE" || msg.type === "NEW_BOOKING_COMMENT") {
          // Rezervasyon oluşturma/kabul/red/iptal/tamamlama/yorum → her iki tarafta
          // liste ve detayı sayfa yenilemeden canlı tazele. (["bookings"] öneki detayı
          // da kapsar.)
          invalidate(["bookings"]);
        } else if (msg.type === "RTC_SIGNAL" && msg.booking_id && msg.signal) {
          // Uçtan uca dosya aktarımı sinyalleşmesi (WebRTC) → gerçek zamanlı, throttle ETME.
          rtcManager.handleSignal(msg.booking_id, msg.signal);
        }
      } catch (err) {
        console.error("WS Parse error", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
      if (flush) clearTimeout(flush);
    };
  }, [socket, qc]);

  return null;
}

// Kök (`/`) root dispatcher: anonim → public Landing (prerender/SEO hedefi),
// oturumlu → role workspace (URL `/` kalır). Hem öğrenci hem EĞİTMEN kökten,
// Landing workspace'inden başlar (zenginleştirilecek); ders talepleri kökte DEĞİL,
// `/ders-talepleri`'ndedir. ADMIN dahil herkes kökte Landing görür.
function RootDispatcher() {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading } = useCurrentUser();
  if (!token) return <Landing />;
  if (isLoading || !user) return <FullScreenSpinner />;
  // Admin kökten panele ZORLA yönlendirilmez (29 Ağu): "Özel Ders Al" `/`e
  // götürür ve admin de bu yüzeyi gezebilmelidir. Panele dönüş, hesap
  // menüsündeki "Yönetim Paneli" bağlantısıyla.
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <OperatorHome />;
  if (user.role_id === ROLE_IDS.COURIER) return <CourierHome />;
  return <Landing />;
}

/**
 * "Hesabım" — CLIENT için birleşik hesap hub'ı, ADMIN için profil editörü.
 *
 * TUTOR ARTIK BURAYA GELMİYOR (kullanıcı kararı, 8 Eyl 2026). O ekranda
 * eğitmen için fotoğraf, hiçbir yerden dolmayan bir "Hakkımda" ve
 * eğitim/diploma vardı; üçü de gerçek sahiplerine dağıtıldı (fotoğraf ve
 * eğitim → İlanım, kimlik alanları → zaten oldukları Ayarlar) ve "Hesabım"
 * panel şeridinden kalktı.
 *
 * Rota SİLİNMEDİ, yönlendirmeye bağlandı: `/pano/hesabim` üretimde canlıydı ve
 * eski bildirim satırları (`name_change_service`) hâlâ o yolu taşıyor. Eğitmen
 * oraya giderse hesap ayarlarında açılır — 404 değil.
 */
function AccountDispatcher() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.CLIENT) return <AccountHub />;
  if (user.role_id === ROLE_IDS.TUTOR)
    return <Navigate to={ROUTES.settings} replace />;
  return <Profile />;
}

// "Ders Talepleri" — ortak `/ders-talepleri` URL'i, rol göre içerik:
//  • TUTOR  → panosu (gelen talepler/kazanç) = TutorDashboard
//  • CLIENT → kendi rezervasyon listesi = Reservations
function BookingsHome() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorDashboard />;
  if (user.role_id === ROLE_IDS.CLIENT) return <Reservations />;
  return <Navigate to={ROUTES.home} replace />;
}

// "Sorular" rol göre farklı içerik: öğrenci kendi sorularını, eğitmen gelenleri görür.
function PanelQuestions() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorQuestions />;
  if (user.role_id === ROLE_IDS.CLIENT) return <Questions />;
  return <Navigate to={ROUTES.home} replace />;
}

// Eski URL'ler → yeni düz yapı. Tek hop `replace`; query string LegacyRedirect
// tarafından korunur (?token=, ?q=, ?to= …). Eski `/panel/*` öneki dahil.
export const LEGACY_STATIC: [string, string][] = [
  // İngilizce/karışık eski yüzey
  ["/login", ROUTES.login],
  ["/register", ROUTES.register],
  ["/forgot-password", ROUTES.forgotPassword],
  ["/reset-password", ROUTES.resetPassword],
  ["/verify-email", ROUTES.verifyEmail],
  ["/kesfet", ROUTES.tutors],
  ["/admin", ROUTES.admin],
  ["/tutor", ROUTES.home],
  ["/student", ROUTES.tutors],
  ["/student/favorites", ROUTES.favorites],
  ["/student/questions", ROUTES.questions],
  ["/student/exams", ROUTES.exams],
  ["/student/bookings", ROUTES.bookings],
  ["/tutor/questions", ROUTES.questions],
  ["/tutor/settings", ROUTES.tutorListing],
  ["/profile", ROUTES.profile],
  ["/settings", ROUTES.settings],
  ["/messages", ROUTES.messages],
  ["/calendar", ROUTES.calendar],
  ["/leaderboard", ROUTES.leaderboard],
  // KALICI: bilet metaforu kalktı ama bu yol SİLİNEMEZ. Veritabanındaki eski
  // bildirim satırları ve gönderilmiş e-postalar hâlâ "/biletlerim" taşıyor;
  // yönlendirme kalkarsa o linkler 404 olur. Nöbetçisi routes.test.ts.
  ["/biletlerim", ROUTES.bookings],
  /*
   * Şeridin altı sayfası `/pano/*` altına toplandı (kullanıcı kararı,
   * 8 Eyl 2026). Aşağıdakiler ÜRETİMDE canlı olan eski düz yollardır:
   * veritabanındaki bildirim satırları, gönderilmiş e-postalar ve
   * kullanıcıların yer imleri bunları taşıyor. Silinirlerse 404 olurlar.
   * (`/pano/degerlendirmeler` listede YOK — o yol hiç yayınlanmadı.)
   */
  ["/rezervasyonlar", ROUTES.bookings],
  ["/mesajlar", ROUTES.messages],
  ["/hesabim", ROUTES.profile],
  ["/hesabim/profil", ROUTES.profileEdit],
  ["/bakiyem", ROUTES.balance],
  ["/ilan-ayarlari", ROUTES.tutorListing],
  // Eski `/panel/*` öneki → yeni path
  ["/panel", ROUTES.home],
  ["/panel/profil", ROUTES.profile],
  ["/panel/mesajlar", ROUTES.messages],
  ["/panel/takvim", ROUTES.calendar],
  ["/panel/favoriler", ROUTES.favorites],
  ["/panel/sorular", ROUTES.questions],
  ["/panel/denemeler", ROUTES.exams],
  ["/panel/gorevler", ROUTES.tasks],
  ["/panel/liderlik", ROUTES.leaderboard],
  ["/panel/ayarlar", ROUTES.settings],
  ["/panel/ilan", ROUTES.tutorListing],
  ["/panel/rezervasyonlar", ROUTES.bookings],
  ["/panel/ogren", ROUTES.learn],
  // `/panel/ogren/kelime-kartlari` girdisi KALDIRILDI: hedef yüzey artık yok,
  // yönlendirme bilinçli olarak yazılmadı (eski URL 404 döner).
  ["/panel/ogren/zamanlayici", ROUTES.deepwork],
  ["/panel/ogren/grafik", ROUTES.grapher],
  ["/panel/ogren/aliskanliklar", ROUTES.habits],
  // Mağaza-scoped hesap yüzeyleri birleşik hesaba taşındı
  ["/magaza/hesabim", ROUTES.profile],
  ["/magaza/adreslerim", ROUTES.addresses],
];

/**
 * Rota değişimlerini analitiğe bildirir (SPA'da gezinme sayfa yenilemesi
 * değildir; bildirilmezse yalnız ilk açılış sayılır ve tüm derinlik kaybolur).
 * Analitik yapılandırılmamışsa `trackPageview` no-op'tur.
 */
function AnalyticsTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WsManager />
      <BrowserRouter>
        <AnalyticsTracker />
        {/* İkinci sınır ROUTER'IN İÇİNDE: dıştaki sınır tek başınayken bir
            sayfa çöktüğünde router da düşüyordu, yani "ana sayfaya dön"
            tam sayfa yenilemeye zorlanıyordu. İçteki sınır rota değişince
            sıfırlanır ve kullanıcı uygulamada kalır. */}
        <RouteErrorBoundary>
        <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          {/* ── KEŞİF KABUĞU ────────────────────────────────────────────
              `/` ve `/kutuphaneler` TEK ebeveyn altında: adres değişir, üst bar
              YERİNDE KALIR. React Router çocuk eşleşmesi değişse de aynı
              ebeveyni aynı konumda, aynı tipte reconcile eder — kabuk mount
              kalır, yalnız `<Outlet/>`in çözdüğü gövde değişir.

              `KesifKabugu` MODÜL KAPSAMINDA tanımlıdır (burada satır içi
              DEĞİL): satır içi tanımlansaydı her render'da yeni bir bileşen
              tipi doğar ve kabuk yine remount olurdu.

              `/egitmenler` bilerek DIŞARIDA: telefonda kendi sonuç başlığını
              taşıyor ve kullanıcı ona dokunulmamasını istedi (10 Eyl 2026).
              Nöbetçi: `__guards__/kesifKabuguKalir.test.tsx`. */}
          <Route element={<KesifKabugu />}>
            <Route path={PATHS.home} element={<RootDispatcher />} />
            {/* Donmuş bölüm (bkz. lib/ozellikBayraklari.ts): doğrudan URL yazan
                kullanıcı gerçek sayfayı değil "Yakında" ekranını görür. */}
            <Route
              path={PATHS.libraries}
              element={KUTUPHANELER_ACIK ? <Libraries /> : <Yakinda />}
            />
          </Route>
          <Route path={PATHS.tutors} element={<MarketplacePage />} />
          <Route path={PATHS.tutor} element={<TutorProfilePage />} />
          <Route
            path={PATHS.library}
            element={KUTUPHANELER_ACIK ? <LibraryDetail /> : <Yakinda />}
          />
          <Route
            path={PATHS.libraryRegister}
            element={KUTUPHANELER_ACIK ? <LibraryRegister /> : <Yakinda />}
          />
          {/* `/denemeler` normalde CLIENT korumalıdır. Donmuşken korumanın
              DIŞINDA duruyor: anonim kullanıcı da 404 ya da giriş ekranı
              yerine "Yakında" görsün. Bayrak açılınca aşağıdaki korumalı
              blokta yeniden yerini alır. */}
          {!DENEMELER_ACIK && (
            <Route path={PATHS.exams} element={<Yakinda />} />
          )}

          {/* Öğrenci talepleri donduruldu (bkz. lib/ozellikBayraklari.ts).
              Denemeler/Öğren ile AYNI sözleşme: rota korumanın DIŞINDA, çünkü
              doğrudan URL yazan kullanıcı giriş ekranı ya da 404 yerine
              "Yakında" görmeli. Bayrak açılınca korumalı bloktaki yerini alır. */}
          {!TALEPLER_ACIK && (
            <Route path={PATHS.demands} element={<Yakinda />} />
          )}

          {/* Öğren hub'ı donduruldu (bkz. lib/ozellikBayraklari.ts). Rotalar
              KORUMANIN DIŞINDA: doğrudan URL yazan kullanıcı giriş ekranı ya
              da 404 yerine "Yakında" görsün — Denemeler'le aynı sözleşme.
              Bayrak `true` olunca aşağıdaki korumalı blokta yerlerini alırlar. */}
          {!OGREN_ACIK && (
            <>
              <Route path={PATHS.learn} element={<Yakinda />} />
              <Route path={PATHS.deepwork} element={<Yakinda />} />
              <Route path={PATHS.grapher} element={<Yakinda />} />
              <Route path={PATHS.habits} element={<Yakinda />} />
              <Route path={PATHS.srs} element={<Yakinda />} />
              <Route path={PATHS.srsDeck} element={<Yakinda />} />
              <Route path={PATHS.srsStudy} element={<Yakinda />} />
              <Route path={PATHS.srsBrowser} element={<Yakinda />} />
              <Route path={PATHS.srsStats} element={<Yakinda />} />
            </>
          )}

          {/* ── Mağaza (public: katalog/detay/sepet) ── */}
          <Route path={PATHS.store} element={<StorePage />} />
          <Route path={PATHS.storeProduct} element={<ProductDetailPage />} />
          <Route path={PATHS.storeSeller} element={<SellerStorePage />} />
          <Route path={PATHS.storeCart} element={<CartPage />} />
          <Route path={PATHS.storeFavorites} element={<FavoritesPage />} />
          <Route path={PATHS.storeCollectionShared} element={<SharedCollectionPage />} />
          {/* Manuel vitrin: kampanya sayfaları KODDA, sabit rotalarla. */}
          <Route path={PATHS.storeOkulaDonus} element={<OkulaDonusKampanyasi />} />
          {/* Oturumsuz kargo takibi (SMS token'ı) — subdomain kökü buraya rewrite'lanır. */}
          <Route path={PATHS.cargoTracking} element={<CargoTrackingPage />} />

          {/* ── Yasal sayfalar (public, SEO) ── */}
          <Route path={PATHS.kvkk} element={<LegalPage doc="kvkk" />} />
          <Route path={PATHS.privacy} element={<LegalPage doc="privacy" />} />
          <Route path={PATHS.terms} element={<LegalPage doc="terms" />} />
          <Route path={PATHS.distanceSales} element={<LegalPage doc="distance-sales" />} />
          <Route path={PATHS.refundPolicy} element={<LegalPage doc="refund" />} />
          <Route path={PATHS.cookiePolicy} element={<LegalPage doc="cookies" />} />
          <Route path={PATHS.preliminaryInfo} element={<LegalPage doc="preliminary-info" />} />
          <Route path={PATHS.rankingCriteria} element={<LegalPage doc="ranking-criteria" />} />
          <Route path={PATHS.about} element={<LegalPage doc="about" />} />

          {/* ── Destek (public) ── */}
          <Route path={PATHS.blog} element={<BlogListPage />} />
          <Route path={PATHS.blogPost} element={<BlogPostPage />} />

          <Route path={PATHS.faq} element={<FaqPage />} />
          <Route path={PATHS.contact} element={<ContactPage />} />
          <Route path={PATHS.tutorPreApply} element={<TutorPreApply />} />

          {/* ── Geliştirme prototipleri ──
              YALNIZ dev sunucusunda. Üretimde bu rotalar kimlik doğrulamasız
              açıktı ve robots.txt'te dışlanmadığından indekslenebiliyordu;
              LibraryCardTest gerçek arama API'sini de çağırıyor. */}
          {import.meta.env.DEV && (
            <>
              <Route path="/test-canli-ders" element={<TestLiveLesson />} />
              <Route path="/test-kutuphane-karti" element={<LibraryCardTest />} />
            </>
          )}

          {/* ── Kimlik: giriş yapmış kullanıcı kök workspace'ine yönlendirilir ── */}
          <Route element={<PublicRoute />}>
            <Route path={PATHS.login} element={<Login />} />
            <Route path={PATHS.register} element={<Register />} />
          </Route>

          {/* ── Token akışları: oturum durumundan bağımsız erişilebilir ── */}
          <Route path={PATHS.forgotPassword} element={<ForgotPassword />} />
          <Route path={PATHS.resetPassword} element={<ResetPassword />} />
          <Route path={PATHS.verifyEmail} element={<VerifyEmail />} />
          {/* Google donusu: `PublicRoute` ile SARILMAZ -- sayfa tam da
              oturumu acarken calisir, oturumlu kullaniciyi disari atan
              bir guard akisi tam ortasinda keserdi. */}
          <Route path={PATHS.googleReturn} element={<GoogleDonus />} />
          <Route path={PATHS.confirmDelete} element={<HesapSilmeOnayi />} />

          {/* ── Oturum-içi (DÜZ). Yalnızca kimlik gerektiren ortak uçlar ── */}
          <Route element={<ProtectedRoute />}>
            <Route path={PATHS.messages} element={<Messages />} />
            <Route path={PATHS.messageCenter} element={<MessageCenter />} />
            <Route path={PATHS.calendar} element={<Calendar />} />
            {OGREN_ACIK && (
              <>
                <Route path={PATHS.learn} element={<Learn />} />
                <Route path={PATHS.deepwork} element={<DeepWork />} />
                <Route path={PATHS.grapher} element={<Grapher />} />
                <Route path={PATHS.habits} element={<Habits />} />
                <Route path={PATHS.srs} element={<SrsDecks />} />
                <Route path={PATHS.srsDeck} element={<SrsDeckDetail />} />
                <Route path={PATHS.srsStudy} element={<SrsStudy />} />
                <Route path={PATHS.srsBrowser} element={<SrsBrowser />} />
                <Route path={PATHS.srsStats} element={<SrsStats />} />
              </>
            )}
            <Route path={PATHS.tasks} element={<Tasks />} />
            {/* Bakiyem — rol delegasyonu sayfa içinde (TUTOR + LIBRARY_OPERATOR) */}
            <Route path={PATHS.balance} element={<Balance />} />
            {/* Talepler — rol delegasyonu sayfa içinde (CLIENT açar, TUTOR yanıtlar) */}
            {TALEPLER_ACIK && (
              <Route path={PATHS.demands} element={<Demands />} />
            )}
            <Route path={PATHS.leaderboard} element={<Leaderboard />} />
            <Route path={PATHS.notifications} element={<Notifications />} />
            <Route path={PATHS.profile} element={<AccountDispatcher />} />
            <Route path={PATHS.profileEdit} element={<Profile />} />
            <Route path={PATHS.settings} element={<Settings />} />
            <Route path={PATHS.questions} element={<PanelQuestions />} />
            {/* Ders talepleri — CLIENT + TUTOR ortak (rol göre içerik) */}
            <Route path={PATHS.bookings} element={<BookingsHome />} />
            <Route path={PATHS.lesson} element={<LessonDetail />} />
            <Route
              path={PATHS.libraryReservation}
              element={<LibraryReservationDetail />}
            />
          </Route>

          {/* ── Favoriler: öğrenci + eğitmen (ÜK-6) ──
              Eğitmen de eğitmen/kütüphane favoriler; sunucu tarafında gölge
              `Client`e çevrilir (docs/urun-kararlari.md). */}
          <Route
            element={
              <ProtectedRoute
                allowedRoleIds={[...ALISVERIS_ROLLERI]}
                anonimIcerik={<FavorilerGirisDaveti />}
              />
            }
          >
            <Route path={PATHS.favorites} element={<Favorites />} />
          </Route>

          {/* ── Yalnızca CLIENT ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.CLIENT} />}>
            {DENEMELER_ACIK && <Route path={PATHS.exams} element={<Exams />} />}
          </Route>

          {/* ── Mağaza alıcı yüzeyi: öğrenci + eğitmen ──
              Eğitmen kendi oturumuyla alışveriş yapar; sunucu tarafında bir
              `Client` yansımasına çevrilir (docs/egitmen-alici-sozlesme.md). */}
          <Route element={<ProtectedRoute allowedRoleIds={[...ALISVERIS_ROLLERI]} />}>
            <Route path={PATHS.storeCheckout} element={<CheckoutPage />} />
            <Route path={PATHS.orders} element={<OrdersPage />} />
            <Route path={PATHS.orderDetail} element={<OrderDetailPage />} />
            <Route path={PATHS.addresses} element={<AddressesPage />} />
          </Route>

          {/* ── Yalnızca TUTOR ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path={PATHS.tutorListing} element={<TutorSettings />} />
            <Route
              path={PATHS.tutorOnboarding}
              element={<IlanSihirbazi />}
            />
            <Route path={PATHS.tutorPromotion} element={<TutorPromotion />} />
            <Route path={PATHS.tutorReviews} element={<TutorReviews />} />
            <Route path={PATHS.uyeProfili} element={<UyeProfili />} />
            <Route path={PATHS.sellerProducts} element={<SellerProducts />} />
          </Route>

          {/* ── Yalnızca ADMIN: kanonik, deep-link destekli yönetim alanı ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.ADMIN} />}>
            <Route path={PATHS.admin} element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="kullanicilar" element={<AdminUsersPage />} />
              <Route path="kullanicilar/:role/:id" element={<AdminUserDetailPage />} />
              <Route path="egitmenler" element={<AdminSectionPage section="listings" />} />
              <Route path="egitmen-basvurulari" element={<AdminTutorApplicationsPage />} />
              <Route path="one-cikarmalar" element={<AdminPromotionsPage />} />
              <Route path="diplomalar" element={<AdminSectionPage section="diplomas" />} />
              <Route path="kutuphaneler" element={<AdminLibraries />} />
              <Route path="deneme-kataloglari" element={<AdminExamCatalogs />} />
              <Route path="blog" element={<AdminBlogListPage />} />
              <Route path="blog/yeni" element={<AdminBlogEditorPage />} />
              <Route path="blog/:postId" element={<AdminBlogEditorPage />} />
              <Route path="magaza" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="magaza/ana-sayfa" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="magaza/kampanyalar" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="magaza/koleksiyonlar" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="magaza/urunler" element={<AdminStore />} />
              <Route path="magaza/kategoriler" element={<AdminStore />} />
              <Route path="magaza/siparisler" element={<AdminStore />} />
              <Route path="magaza/iadeler" element={<AdminStore />} />
              <Route path="magaza/kuponlar" element={<AdminStore />} />
              <Route path="magaza/stok-hareketleri" element={<Navigate replace to={ROUTES.adminInventoryMovements} />} />
              <Route path="magaza/tedarikci" element={<AdminStore />} />
              <Route path="magaza/vitrin-sayfalari" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="magaza/urun-gruplari" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="envanter" element={<InventoryLayout />}>
                <Route index element={<InventoryOverviewPage />} />
                <Route path="sayimlar" element={<CountSessionsPage />} />
                <Route path="sayimlar/:id" element={<CountSessionDetailPage />} />
                <Route path="hasar" element={<DamageEventsPage />} />
                <Route path="hareketler" element={<StockMovementsPanel />} />
              </Route>
              {/* Paketleme istasyonu: kuyruk (index) · paketler · tek paket
                  (deep-link) · geri dönüş kuyruğu. */}
              <Route path="paketleme" element={<PackingLayout />}>
                <Route index element={<PackingQueuePage />} />
                <Route path="paketler" element={<PackagesPage />} />
                <Route path="paket/:id" element={<PackingStationPage />} />
                <Route path="iade" element={<ReturnQueuePage />} />
              </Route>
              <Route path="dagitim" element={<DeliveryLayout />}>
                <Route index element={<DeliveryTodayPage />} />
                <Route path="siparisler" element={<DeliveryOrdersPage />} />
                <Route path="turlar" element={<DeliveryRunsPage />} />
                <Route path="turlar/:id" element={<DeliveryRunDetailPage />} />
                <Route path="performans" element={<DeliveryPerformancePage />} />
                <Route path="kuryeler" element={<DeliveryCouriersPage />} />
                <Route path="araclar" element={<DeliveryVehiclesPage />} />
                <Route path="tahta" element={<DeliveryBoardPage />} />
              </Route>
              <Route path="rezervasyonlar" element={<AdminBookingsPage />} />
              <Route path="talepler" element={<AdminDemandsPage />} />
              <Route path="ad-degisiklikleri" element={<AdminSectionPage section="names" />} />
              <Route path="moderasyon/sikayetler" element={<AdminReportsPage />} />
              <Route path="denetim-kayitlari" element={<AdminAuditLogsPage />} />
              <Route path="hata-cozme" element={<AdminOperationsPage />} />
              <Route path="hakedisler" element={<AdminPayoutsPage />} />
              <Route path="yetkiler" element={<AdminAccessPage />} />
              <Route path="ayarlar" element={<AdminSettingsPage />} />
              <Route path="vitrin-gorselleri" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
              <Route path="duyuru-seridi" element={<Navigate replace to={ROUTES.adminStoreProducts} />} />
            </Route>
            <Route path={PATHS.adminNew} element={<PanelShell />}>
              <Route index element={<GostergePaneli />} />
              <Route path="urunler" element={<UrunListesi />} />
              <Route path="urunler/yeni" element={<UrunFormu />} />
              <Route path="urunler/stok-sayimi" element={<StokSayimiListesi />} />
              <Route path="urunler/stok-sayimi/:id" element={<StokSayimiDetayi />} />
              <Route path="urunler/:id" element={<UrunFormu />} />
              <Route path="siparisler" element={<SiparisListesi />} />
              <Route path="musteriler" element={<MusteriListesi />} />
            </Route>
          </Route>

          {/* ── Saha ekranı: ADMIN + KURYE (kurye yalnız kendi turunu açabilir —
                backend sahiplik kontrolü yabancı tura 404 döner) ── */}
          <Route
            element={
              <ProtectedRoute allowedRoleIds={[ROLE_IDS.ADMIN, ROLE_IDS.COURIER]} />
            }
          >
            {/* Dağıtıcı saha ekranı (kendi-filo teslimat) — mobil, shell'siz */}
            <Route path={PATHS.deliveryRun} element={<DeliveryDriver />} />
            {/* Zimmet ekranı — aynı yetki kapısı: kurye yalnız kendi turunun
                manifestini görebilir (backend `ensure_run_access` 404 döner). */}
            <Route path={PATHS.deliveryRunHandover} element={<DeliveryRunHandover />} />
          </Route>

          {/* ── Yalnızca LIBRARY_OPERATOR ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.LIBRARY_OPERATOR} />}>
            <Route path={PATHS.operatorLibrary} element={<OperatorLibrary />} />
            <Route path={PATHS.operatorSessions} element={<OperatorSessions />} />
          </Route>

          {/* ── Eski URL'ler → yeni düz yapı (geriye dönük uyumluluk, tek hop) ── */}
          {LEGACY_STATIC.map(([from, to]) => (
            <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
          ))}
          <Route
            path="/egitmen/:id"
            element={<LegacyRedirect to={(p) => ROUTES.tutor(p.id!)} />}
          />
          <Route
            path="/student/tutors/:id"
            element={<LegacyRedirect to={(p) => ROUTES.tutor(p.id!)} />}
          />
          <Route
            path="/lesson/:id"
            element={<LegacyRedirect to={(p) => ROUTES.lesson(p.id!)} />}
          />
          <Route
            path="/tutor/students/:id"
            element={<LegacyRedirect to={(p) => ROUTES.uyeProfili(p.id!)} />}
          />
          <Route
            path="/panel/rezervasyonlar/:id"
            element={<LegacyRedirect to={(p) => ROUTES.lesson(p.id!)} />}
          />
          <Route
            path="/panel/ogrenciler/:id"
            element={<LegacyRedirect to={(p) => ROUTES.uyeProfili(p.id!)} />}
          />
          {/* Kütüphane rezervasyon detayı `/rezervasyonlar/:tur/:id`ten
              `/pano/rezervasyon/:tur/:id`e taşındı. Kapıda okunan giriş kodu
              bu URL'le paylaşılıyor (SMS + bildirim) — yönlendirme şart. */}
          <Route
            path="/rezervasyonlar/:tur/:id"
            element={
              <LegacyRedirect
                to={(p) =>
                  ROUTES.libraryReservation(
                    p.tur as "deneme" | "calisma",
                    p.id!
                  )
                }
              />
            }
          />
          {/* /ogrenciler -> /uyeler. Oturum içi ve eğitmen-özel bir yol,
              SEO'ya girmez; yine de paylaşılmış bir link kırılmasın diye
              yönlendirme bırakıldı (aynı desen: `/panel/ogrenciler`). */}
          <Route
            path="/ogrenciler/:id"
            element={<LegacyRedirect to={(p) => ROUTES.uyeProfili(p.id!)} />}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <Suspense fallback={null}>
          <AuthModal />
        </Suspense>
        <NiyetUygulayici />
        <StoreFavoritesSync />
        {/* Pomodoro kartı rota tablosunun DIŞINDA, her sayfada mount ediliyor.
            Öğren donmuşken bu da kapanmalı: aksi hâlde çalışan bir zamanlayıcısı
            olan kullanıcının yüzen kartı her sayfada çizilmeye devam eder ve
            içindeki "zamanlayıcı sayfasına git" bağlantısı ÖLÜ LİNK olur. */}
        {OGREN_ACIK && (
          <Suspense fallback={null}>
            <DeepWorkTimer />
          </Suspense>
        )}
      </BrowserRouter>
      <Suspense fallback={null}>
        <GlobalMeeting />
      </Suspense>
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
