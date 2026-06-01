import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FullScreenSpinner } from "@/components/Spinner";
import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";
import { PublicRoute } from "@/routes/PublicRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { LegacyRedirect } from "@/routes/LegacyRedirect";
import { useAuthStore } from "@/store/authStore";
import { useWsStore } from "@/store/wsStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import Landing from "@/pages/Landing";
import MarketplacePage from "@/pages/MarketplacePage";
import TutorProfilePage from "@/pages/TutorProfilePage";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import AdminHome from "@/pages/dashboards/AdminHome";
import TutorDashboard from "@/pages/TutorDashboard";
import TutorSettings from "@/pages/TutorSettings";
import TutorQuestions from "@/pages/TutorQuestions";
import Favorites from "@/pages/Favorites";
import StudentProfile from "@/pages/StudentProfile";
import Questions from "@/pages/Questions";
import Exams from "@/pages/Exams";
import StudentBookings from "@/pages/StudentBookings";
import LessonDetail from "@/pages/LessonDetail";
import Messages from "@/pages/Messages";
import Leaderboard from "@/pages/Leaderboard";
import Calendar from "@/pages/Calendar";
import Learn from "@/pages/Learn";
import Flashcards from "@/pages/Flashcards";
import FlashcardDeck from "@/pages/FlashcardDeck";
import DeepWork from "@/pages/DeepWork";
import Grapher from "@/pages/Grapher";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import { GlobalMeeting } from "@/components/GlobalMeeting";
import { DeepWorkTimer } from "@/components/DeepWorkTimer";
import { AuthModal } from "@/components/AuthModal";
import { rtcManager } from "@/lib/rtcTransfer";

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
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "NEW_MESSAGE") {
          qc.invalidateQueries({ queryKey: ["messages"] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        } else if (msg.type === "NEW_NOTIFICATION") {
          qc.invalidateQueries({ queryKey: ["notifications"] });
        } else if (msg.type === "BOOKING_UPDATE" || msg.type === "NEW_BOOKING_COMMENT") {
          // Rezervasyon oluşturma/kabul/red/iptal/tamamlama/yorum → her iki tarafta
          // liste ve detayı sayfa yenilemeden canlı tazele.
          if (msg.booking_id) {
            qc.invalidateQueries({ queryKey: ["bookings", "detail", msg.booking_id] });
          }
          qc.invalidateQueries({ queryKey: ["bookings"] });
        } else if (msg.type === "RTC_SIGNAL" && msg.booking_id && msg.signal) {
          // Uçtan uca dosya aktarımı sinyalleşmesi (WebRTC) → P2P yöneticisine ilet.
          rtcManager.handleSignal(msg.booking_id, msg.signal);
        }
      } catch (err) {
        console.error("WS Parse error", err);
      }
    };
    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket, qc]);

  return null;
}

// Nötr panel girişi (/panel): role göre uygun ana ekranı render eder.
function PanelHome() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.ADMIN) return <AdminHome />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorDashboard />;
  // CLIENT'in ana işi eğitmen bulmak → listeye yönlendir.
  return <Navigate to={ROUTES.tutors} replace />;
}

// "Sorular" rol göre farklı içerik: öğrenci kendi sorularını, eğitmen gelenleri görür.
function PanelQuestions() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorQuestions />;
  if (user.role_id === ROLE_IDS.CLIENT) return <Questions />;
  return <Navigate to={ROUTES.panel} replace />;
}

// Eski (İngilizce/karışık) URL'ler → yeni Türkçe yapı. SPA içi `replace`,
// query string LegacyRedirect tarafından korunur (?token=, ?q=, ?to= …).
const LEGACY_STATIC: [string, string][] = [
  ["/login", ROUTES.login],
  ["/register", ROUTES.register],
  ["/forgot-password", ROUTES.forgotPassword],
  ["/reset-password", ROUTES.resetPassword],
  ["/verify-email", ROUTES.verifyEmail],
  ["/kesfet", ROUTES.tutors],
  ["/admin", ROUTES.panel],
  ["/tutor", ROUTES.panel],
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
];

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WsManager />
      <BrowserRouter>
        <Routes>
          {/* ── Public (SEO) — oturumdan bağımsız; içerik oturuma göre uyarlanır ── */}
          <Route path={ROUTES.home} element={<Landing />} />
          <Route path={ROUTES.tutors} element={<MarketplacePage />} />
          <Route path="/egitmenler/:slug" element={<TutorProfilePage />} />

          {/* ── Kimlik: giriş yapmış kullanıcı kendi paneline yönlendirilir ── */}
          <Route element={<PublicRoute />}>
            <Route path={ROUTES.login} element={<Login />} />
            <Route path={ROUTES.register} element={<Register />} />
          </Route>

          {/* ── Token akışları: oturum durumundan bağımsız erişilebilir ── */}
          <Route path={ROUTES.forgotPassword} element={<ForgotPassword />} />
          <Route path={ROUTES.resetPassword} element={<ResetPassword />} />
          <Route path={ROUTES.verifyEmail} element={<VerifyEmail />} />

          {/* ── Panel: nötr shell, role-adaptive. Yalnızca kimlik gerektiren ortak uçlar ── */}
          <Route element={<ProtectedRoute />}>
            <Route path={ROUTES.panel} element={<PanelHome />} />
            <Route path={ROUTES.messages} element={<Messages />} />
            <Route path={ROUTES.calendar} element={<Calendar />} />
            <Route path={ROUTES.learn} element={<Learn />} />
            <Route path={ROUTES.flashcards} element={<Flashcards />} />
            <Route path="/panel/ogren/kelime-kartlari/:id" element={<FlashcardDeck />} />
            <Route path={ROUTES.deepwork} element={<DeepWork />} />
            <Route path={ROUTES.grapher} element={<Grapher />} />
            <Route path={ROUTES.leaderboard} element={<Leaderboard />} />
            <Route path={ROUTES.profile} element={<Profile />} />
            <Route path={ROUTES.settings} element={<Settings />} />
            <Route path={ROUTES.questions} element={<PanelQuestions />} />
            <Route path="/panel/rezervasyonlar/:id" element={<LessonDetail />} />
          </Route>

          {/* ── Panel: yalnızca CLIENT ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.CLIENT} />}>
            <Route path={ROUTES.favorites} element={<Favorites />} />
            <Route path={ROUTES.exams} element={<Exams />} />
            <Route path={ROUTES.bookings} element={<StudentBookings />} />
          </Route>

          {/* ── Panel: yalnızca TUTOR ── */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path={ROUTES.tutorListing} element={<TutorSettings />} />
            <Route path="/panel/ogrenciler/:id" element={<StudentProfile />} />
          </Route>

          {/* ── Eski URL'ler → yeni yapı (geriye dönük uyumluluk) ── */}
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

          <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
        </Routes>
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
