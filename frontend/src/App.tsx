import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import { rtcManager } from "@/lib/rtcTransfer";

// ── Route-level code splitting: ağır modüller talep üzerine yüklenir ──
const MarketplacePage = lazy(() => import("@/pages/MarketplacePage"));
const TutorProfilePage = lazy(() => import("@/pages/TutorProfilePage"));
const Libraries = lazy(() => import("@/pages/Libraries"));
const LibraryDetail = lazy(() => import("@/pages/LibraryDetail"));
const LibraryRegister = lazy(() => import("@/pages/LibraryRegister"));
const Tickets = lazy(() => import("@/pages/Tickets"));
// Yasal sayfalar — tek chunk, belge prop'la seçilir (içerik lib/legalContent.ts)
const LegalPage = lazy(() => import("@/pages/LegalPage"));
const OperatorHome = lazy(() => import("@/pages/dashboards/OperatorHome"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));
const AdminHome = lazy(() => import("@/pages/dashboards/AdminHome"));
const TutorDashboard = lazy(() => import("@/pages/TutorDashboard"));
const TutorSettings = lazy(() => import("@/pages/TutorSettings"));
const TutorQuestions = lazy(() => import("@/pages/TutorQuestions"));
const Favorites = lazy(() => import("@/pages/Favorites"));
const StudentProfile = lazy(() => import("@/pages/StudentProfile"));
const Questions = lazy(() => import("@/pages/Questions"));
const Exams = lazy(() => import("@/pages/Exams"));
const StudentBookings = lazy(() => import("@/pages/StudentBookings"));
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
const Settings = lazy(() => import("@/pages/Settings"));
const Balance = lazy(() => import("@/pages/Balance"));
// Geliştirme prototipi: "yırtılan kupon" bilet animasyonu (/test-bilet)
const TicketTearTest = lazy(() => import("@/pages/TicketTearTest"));
// Geliştirme prototipi: canlı ders (Jitsi) önizleme (/test-canli-ders)
const TestLiveLesson = lazy(() => import("@/pages/TestLiveLesson"));

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
  if (user.role_id === ROLE_IDS.ADMIN) return <AdminHome />;
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <OperatorHome />;
  return <Landing />;
}

// "Ders Talepleri" — ortak `/ders-talepleri` URL'i, rol göre içerik:
//  • TUTOR  → panosu (gelen talepler/kazanç) = TutorDashboard
//  • CLIENT → kendi talep listesi = StudentBookings
function BookingsHome() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorDashboard />;
  if (user.role_id === ROLE_IDS.CLIENT) return <StudentBookings />;
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
  ["/admin", ROUTES.home],
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
];

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WsManager />
      <BrowserRouter>
        <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          {/* ── Kök dağıtıcı + public (SEO) — oturumdan bağımsız ── */}
          <Route path={PATHS.home} element={<RootDispatcher />} />
          <Route path={PATHS.tutors} element={<MarketplacePage />} />
          <Route path={PATHS.tutor} element={<TutorProfilePage />} />
          <Route path={PATHS.libraries} element={<Libraries />} />
          <Route path={PATHS.library} element={<LibraryDetail />} />
          <Route path={PATHS.libraryRegister} element={<LibraryRegister />} />

          {/* ── Yasal sayfalar (public, SEO) ── */}
          <Route path={PATHS.kvkk} element={<LegalPage doc="kvkk" />} />
          <Route path={PATHS.privacy} element={<LegalPage doc="privacy" />} />
          <Route path={PATHS.terms} element={<LegalPage doc="terms" />} />
          <Route path={PATHS.distanceSales} element={<LegalPage doc="distance-sales" />} />
          <Route path={PATHS.refundPolicy} element={<LegalPage doc="refund" />} />
          <Route path={PATHS.cookiePolicy} element={<LegalPage doc="cookies" />} />

          {/* ── Geliştirme prototipi (oturum gerektirmez) ── */}
          <Route path="/test-bilet" element={<TicketTearTest />} />
          <Route path="/test-canli-ders" element={<TestLiveLesson />} />

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
            <Route path={PATHS.leaderboard} element={<Leaderboard />} />
            <Route path={PATHS.profile} element={<Profile />} />
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
            <Route path={PATHS.tickets} element={<Tickets />} />
          </Route>

          {/* ── Yalnızca TUTOR ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path={PATHS.tutorListing} element={<TutorSettings />} />
            <Route path={PATHS.studentProfile} element={<StudentProfile />} />
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

          <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
        </Routes>
        </Suspense>
        <AuthModal />
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
