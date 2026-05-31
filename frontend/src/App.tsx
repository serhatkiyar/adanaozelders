import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/Toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ROLE_IDS } from "@/types";
import { PublicRoute } from "@/routes/PublicRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { useWsStore } from "@/store/wsStore";
import { useQueryClient } from "@tanstack/react-query";
import Landing from "@/pages/Landing";
import PublicMarketplace from "@/pages/PublicMarketplace";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import AdminHome from "@/pages/dashboards/AdminHome";
import TutorDashboard from "@/pages/TutorDashboard";
import TutorSettings from "@/pages/TutorSettings";
import TutorQuestions from "@/pages/TutorQuestions";
import Marketplace from "@/pages/Marketplace";
import Favorites from "@/pages/Favorites";
import TutorProfile from "@/pages/TutorProfile";
import StudentProfile from "@/pages/StudentProfile";
import Questions from "@/pages/Questions";
import Exams from "@/pages/Exams";
import StudentDemands from "@/pages/StudentDemands";
import TutorDemands from "@/pages/TutorDemands";
import StudentBookings from "@/pages/StudentBookings";
import LessonDetail from "@/pages/LessonDetail";
import Messages from "@/pages/Messages";
import Leaderboard from "@/pages/Leaderboard";
import Calendar from "@/pages/Calendar";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import { GlobalMeeting } from "@/components/GlobalMeeting";
import { AuthModal } from "@/components/AuthModal";

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
        } else if (msg.type === "NEW_BOOKING_COMMENT") {
          if (msg.booking_id) {
            qc.invalidateQueries({ queryKey: ["bookings", "detail", msg.booking_id] });
          }
          qc.invalidateQueries({ queryKey: ["bookings"] });
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

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WsManager />
      <BrowserRouter>
        <Routes>
          {/* Public: giriş yapmış kullanıcı kendi paneline yönlendirilir. */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Token tabanlı akışlar: oturum durumundan bağımsız erişilebilir
              (doğrulamayı giriş yapmış kullanıcı da yapabilir). */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Protected: role_id bazlı asimetrik erişim. */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.ADMIN} />}>
            <Route path="/admin" element={<AdminHome />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path="/tutor" element={<TutorDashboard />} />
            <Route path="/tutor/questions" element={<TutorQuestions />} />
            <Route path="/tutor/settings" element={<TutorSettings />} />
            <Route path="/tutor/students/:id" element={<StudentProfile />} />
            <Route path="/tutor/demands" element={<TutorDemands />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.CLIENT} />}>
            <Route path="/student" element={<Marketplace />} />
            <Route path="/student/favorites" element={<Favorites />} />
            <Route path="/student/questions" element={<Questions />} />
            <Route path="/student/exams" element={<Exams />} />
            <Route path="/student/demands" element={<StudentDemands />} />
            <Route path="/student/bookings" element={<StudentBookings />} />
          </Route>

          {/* Tüm roller: ortak profil sayfası (rol kısıtı yok, yalnızca kimlik). */}
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/lesson/:id" element={<LessonDetail />} />
            <Route path="/student/tutors/:id" element={<TutorProfile />} />
          </Route>

          <Route path="/" element={<Landing />} />
          <Route path="/kesfet" element={<PublicMarketplace />} />
          <Route path="/egitmen/:id" element={<PublicTutorProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <AuthModal />
      </BrowserRouter>
      <GlobalMeeting />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
