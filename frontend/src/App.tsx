import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { trackPageview } from "@/lib/analytics";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";
import { FullScreenSpinner } from "@/components/Spinner";
import { ROLE_IDS } from "@/types";
import { ROUTES, PATHS } from "@/lib/routes";
import { PublicRoute } from "@/routes/PublicRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { LegacyRedirect } from "@/routes/LegacyRedirect";
import { useAuthStore } from "@/store/authStore";
import { useWsStore } from "@/store/wsStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
// Landing kök (`/`) yüzeyidir + prerender/SEO hedefi → eager (kod bölünmez).
import Landing from "@/pages/Landing";
import { GlobalMeeting } from "@/components/GlobalMeeting";
import { DeepWorkTimer } from "@/components/DeepWorkTimer";
import { AuthModal } from "@/components/AuthModal";
import { PendingFavoriteApplier } from "@/components/PendingFavoriteApplier";
import { StoreFavoritesSync } from "@/components/StoreFavoritesSync";
import { rtcManager } from "@/lib/rtcTransfer";

// ── Route-level code splitting: ağır modüller talep üzerine yüklenir ──
const MarketplacePage = lazy(() => import("@/pages/MarketplacePage"));
const TutorProfilePage = lazy(() => import("@/pages/TutorProfilePage"));
const Libraries = lazy(() => import("@/pages/Libraries"));
const LibraryDetail = lazy(() => import("@/pages/LibraryDetail"));
const LibraryRegister = lazy(() => import("@/pages/LibraryRegister"));
// Mağaza (D&R tarzı) — katalog/detay/sepet public; ödeme/siparişler oturum-içi
const StorePage = lazy(() => import("@/pages/store/StorePage"));
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
const FaqPage = lazy(() => import("@/pages/FaqPage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
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
const AdminLayout = lazy(() => import("@/components/admin/layout/AdminLayout"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/AdminDashboardPage"));
const AdminSectionPage = lazy(() => import("@/pages/admin/AdminSectionPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminUserDetailPage = lazy(() => import("@/pages/admin/AdminUserDetailPage"));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin/AdminAuditLogsPage"));
const AdminPayoutsPage = lazy(() => import("@/pages/admin/AdminPayoutsPage"));
const AdminReportsPage = lazy(() => import("@/pages/admin/AdminReportsPage"));
const AdminDemandsPage = lazy(() => import("@/pages/admin/AdminDemandsPage"));
const AdminBookingsPage = lazy(() => import("@/pages/admin/AdminBookingsPage"));
const AdminAccessPage = lazy(() => import("@/pages/admin/AdminAccessPage"));
const AdminLibraries = lazy(() => import("@/pages/dashboards/AdminLibraries"));
const AdminExamCatalogs = lazy(() => import("@/pages/dashboards/AdminExamCatalogs"));
const AdminStore = lazy(() => import("@/pages/dashboards/AdminStore"));
const AdminDelivery = lazy(() => import("@/pages/dashboards/AdminDelivery"));
const DeliveryDriver = lazy(() => import("@/pages/DeliveryDriver"));
const TutorDashboard = lazy(() => import("@/pages/TutorDashboard"));
const TutorSettings = lazy(() => import("@/pages/TutorSettings"));
const TutorQuestions = lazy(() => import("@/pages/TutorQuestions"));
const Favorites = lazy(() => import("@/pages/Favorites"));
const StudentProfile = lazy(() => import("@/pages/StudentProfile"));
const Questions = lazy(() => import("@/pages/Questions"));
const Exams = lazy(() => import("@/pages/Exams"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const LessonDetail = lazy(() => import("@/pages/LessonDetail"));
const Messages = lazy(() => import("@/pages/Messages"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Learn = lazy(() => import("@/pages/Learn"));
const Flashcards = lazy(() => import("@/pages/Flashcards"));
const FlashcardDeck = lazy(() => import("@/pages/FlashcardDeck"));
const DeepWork = lazy(() => import("@/pages/DeepWork"));
const Grapher = lazy(() => import("@/pages/Grapher"));
const Habits = lazy(() => import("@/pages/Habits"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Profile = lazy(() => import("@/pages/Profile"));
const MessageCenter = lazy(() => import("@/pages/MessageCenter"));
const Settings = lazy(() => import("@/pages/Settings"));
const Balance = lazy(() => import("@/pages/Balance"));
const Demands = lazy(() => import("@/pages/Demands"));
const Notifications = lazy(() => import("@/pages/Notifications"));
// Geliştirme prototipi: "yırtılan kupon" bilet animasyonu (/test-bilet)
const TicketTearTest = lazy(() => import("@/pages/TicketTearTest"));
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
// `/ders-talepleri`'ndedir. Yalnız ADMIN'in kök ekranı kendi panosudur.
function RootDispatcher() {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading } = useCurrentUser();
  if (!token) return <Landing />;
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.ADMIN) return <Navigate to={ROUTES.admin} replace />;
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <OperatorHome />;
  if (user.role_id === ROLE_IDS.COURIER) return <CourierHome />;
  return <Landing />;
}

// "Hesabım" — CLIENT için birleşik hesap hub'ı; TUTOR/ADMIN için mevcut profil editörü.
function AccountDispatcher() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.CLIENT) return <AccountHub />;
  return <Profile />;
}

// "Ders Talepleri" — ortak `/ders-talepleri` URL'i, rol göre içerik:
//  • TUTOR  → panosu (gelen talepler/kazanç) = TutorDashboard
//  • CLIENT → kendi talep listesi = StudentBookings
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
const LEGACY_STATIC: [string, string][] = [
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
  ["/biletlerim", ROUTES.bookings],
  // Eski `/panel/*` öneki → yeni düz path
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
  ["/panel/ogren/kelime-kartlari", ROUTES.flashcards],
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
          {/* ── Kök dağıtıcı + public (SEO) — oturumdan bağımsız ── */}
          <Route path={PATHS.home} element={<RootDispatcher />} />
          <Route path={PATHS.tutors} element={<MarketplacePage />} />
          <Route path={PATHS.tutor} element={<TutorProfilePage />} />
          <Route path={PATHS.libraries} element={<Libraries />} />
          <Route path={PATHS.library} element={<LibraryDetail />} />
          <Route path={PATHS.libraryRegister} element={<LibraryRegister />} />

          {/* ── Mağaza (public: katalog/detay/sepet) ── */}
          <Route path={PATHS.store} element={<StorePage />} />
          <Route path={PATHS.storeProduct} element={<ProductDetailPage />} />
          <Route path={PATHS.storeSeller} element={<SellerStorePage />} />
          <Route path={PATHS.storeCart} element={<CartPage />} />
          <Route path={PATHS.storeFavorites} element={<FavoritesPage />} />
          <Route path={PATHS.storeCollectionShared} element={<SharedCollectionPage />} />
          {/* Oturumsuz kargo takibi (SMS token'ı) — subdomain kökü buraya rewrite'lanır. */}
          <Route path={PATHS.cargoTracking} element={<CargoTrackingPage />} />

          {/* ── Yasal sayfalar (public, SEO) ── */}
          <Route path={PATHS.kvkk} element={<LegalPage doc="kvkk" />} />
          <Route path={PATHS.privacy} element={<LegalPage doc="privacy" />} />
          <Route path={PATHS.terms} element={<LegalPage doc="terms" />} />
          <Route path={PATHS.distanceSales} element={<LegalPage doc="distance-sales" />} />
          <Route path={PATHS.refundPolicy} element={<LegalPage doc="refund" />} />
          <Route path={PATHS.cookiePolicy} element={<LegalPage doc="cookies" />} />

          {/* ── Destek (public) ── */}
          <Route path={PATHS.faq} element={<FaqPage />} />
          <Route path={PATHS.contact} element={<ContactPage />} />

          {/* ── Geliştirme prototipleri ──
              YALNIZ dev sunucusunda. Üretimde bu rotalar kimlik doğrulamasız
              açıktı ve robots.txt'te dışlanmadığından indekslenebiliyordu;
              LibraryCardTest gerçek arama API'sini de çağırıyor. */}
          {import.meta.env.DEV && (
            <>
              <Route path="/test-bilet" element={<TicketTearTest />} />
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

          {/* ── Oturum-içi (DÜZ). Yalnızca kimlik gerektiren ortak uçlar ── */}
          <Route element={<ProtectedRoute />}>
            <Route path={PATHS.messages} element={<Messages />} />
            <Route path={PATHS.messageCenter} element={<MessageCenter />} />
            <Route path={PATHS.calendar} element={<Calendar />} />
            <Route path={PATHS.learn} element={<Learn />} />
            <Route path={PATHS.flashcards} element={<Flashcards />} />
            <Route path={PATHS.flashcardDeck} element={<FlashcardDeck />} />
            <Route path={PATHS.deepwork} element={<DeepWork />} />
            <Route path={PATHS.grapher} element={<Grapher />} />
            <Route path={PATHS.habits} element={<Habits />} />
            <Route path={PATHS.tasks} element={<Tasks />} />
            {/* Bakiyem — rol delegasyonu sayfa içinde (TUTOR + LIBRARY_OPERATOR) */}
            <Route path={PATHS.balance} element={<Balance />} />
            {/* Talepler — rol delegasyonu sayfa içinde (CLIENT açar, TUTOR yanıtlar) */}
            <Route path={PATHS.demands} element={<Demands />} />
            <Route path={PATHS.leaderboard} element={<Leaderboard />} />
            <Route path={PATHS.notifications} element={<Notifications />} />
            <Route path={PATHS.profile} element={<AccountDispatcher />} />
            <Route path={PATHS.profileEdit} element={<Profile />} />
            <Route path={PATHS.settings} element={<Settings />} />
            <Route path={PATHS.questions} element={<PanelQuestions />} />
            {/* Ders talepleri — CLIENT + TUTOR ortak (rol göre içerik) */}
            <Route path={PATHS.bookings} element={<BookingsHome />} />
            <Route path={PATHS.lesson} element={<LessonDetail />} />
          </Route>

          {/* ── Yalnızca CLIENT ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.CLIENT} />}>
            <Route path={PATHS.favorites} element={<Favorites />} />
            <Route path={PATHS.exams} element={<Exams />} />
            <Route path={PATHS.storeCheckout} element={<CheckoutPage />} />
            <Route path={PATHS.orders} element={<OrdersPage />} />
            <Route path={PATHS.orderDetail} element={<OrderDetailPage />} />
            <Route path={PATHS.addresses} element={<AddressesPage />} />
          </Route>

          {/* ── Yalnızca TUTOR ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path={PATHS.tutorListing} element={<TutorSettings />} />
            <Route path={PATHS.studentProfile} element={<StudentProfile />} />
            <Route path={PATHS.sellerProducts} element={<SellerProducts />} />
          </Route>

          {/* ── Yalnızca ADMIN: kanonik, deep-link destekli yönetim alanı ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.ADMIN} />}>
            <Route path={PATHS.admin} element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="kullanicilar" element={<AdminUsersPage />} />
              <Route path="kullanicilar/:role/:id" element={<AdminUserDetailPage />} />
              <Route path="egitmenler" element={<AdminSectionPage section="listings" />} />
              <Route path="diplomalar" element={<AdminSectionPage section="diplomas" />} />
              <Route path="kutuphaneler" element={<AdminLibraries />} />
              <Route path="deneme-kataloglari" element={<AdminExamCatalogs />} />
              <Route path="magaza/urunler" element={<AdminStore />} />
              <Route path="magaza/kategoriler" element={<AdminStore />} />
              <Route path="magaza/siparisler" element={<AdminStore />} />
              <Route path="magaza/iadeler" element={<AdminStore />} />
              <Route path="magaza/kuponlar" element={<AdminStore />} />
              <Route path="dagitim" element={<AdminDelivery />} />
              <Route path="rezervasyonlar" element={<AdminBookingsPage />} />
              <Route path="talepler" element={<AdminDemandsPage />} />
              <Route path="ad-degisiklikleri" element={<AdminSectionPage section="names" />} />
              <Route path="moderasyon/sikayetler" element={<AdminReportsPage />} />
              <Route path="denetim-kayitlari" element={<AdminAuditLogsPage />} />
              <Route path="hakedisler" element={<AdminPayoutsPage />} />
              <Route path="yetkiler" element={<AdminAccessPage />} />
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
            element={<LegacyRedirect to={(p) => ROUTES.studentProfile(p.id!)} />}
          />
          <Route
            path="/panel/rezervasyonlar/:id"
            element={<LegacyRedirect to={(p) => ROUTES.lesson(p.id!)} />}
          />
          <Route
            path="/panel/ogren/kelime-kartlari/:id"
            element={<LegacyRedirect to={(p) => ROUTES.flashcardDeck(p.id!)} />}
          />
          <Route
            path="/panel/ogrenciler/:id"
            element={<LegacyRedirect to={(p) => ROUTES.studentProfile(p.id!)} />}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <AuthModal />
        <PendingFavoriteApplier />
        <StoreFavoritesSync />
        <DeepWorkTimer />
      </BrowserRouter>
      <GlobalMeeting />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
