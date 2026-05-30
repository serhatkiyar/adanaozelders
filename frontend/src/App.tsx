import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/Toaster";
import { ROLE_IDS } from "@/types";
import { PublicRoute } from "@/routes/PublicRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import Landing from "@/pages/Landing";
import PublicMarketplace from "@/pages/PublicMarketplace";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import AdminHome from "@/pages/dashboards/AdminHome";
import TutorDashboard from "@/pages/TutorDashboard";
import TutorSettings from "@/pages/TutorSettings";
import TutorQuestions from "@/pages/TutorQuestions";
import Marketplace from "@/pages/Marketplace";
import Favorites from "@/pages/Favorites";
import TutorProfile from "@/pages/TutorProfile";
import StudentProfile from "@/pages/StudentProfile";
import StudentSearch from "@/pages/StudentSearch";
import Questions from "@/pages/Questions";
import Exams from "@/pages/Exams";
import StudentDemands from "@/pages/StudentDemands";
import TutorDemands from "@/pages/TutorDemands";
import StudentBookings from "@/pages/StudentBookings";
import LessonDetail from "@/pages/LessonDetail";
import Messages from "@/pages/Messages";
import Leaderboard from "@/pages/Leaderboard";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public: giriş yapmış kullanıcı kendi paneline yönlendirilir. */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Protected: role_id bazlı asimetrik erişim. */}
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.ADMIN} />}>
            <Route path="/admin" element={<AdminHome />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoleId={ROLE_IDS.TUTOR} />}>
            <Route path="/tutor" element={<TutorDashboard />} />
            <Route path="/tutor/questions" element={<TutorQuestions />} />
            <Route path="/tutor/settings" element={<TutorSettings />} />
            <Route path="/tutor/students" element={<StudentSearch />} />
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
            <Route path="/lesson/:id" element={<LessonDetail />} />
            <Route path="/student/tutors/:id" element={<TutorProfile />} />
          </Route>

          <Route path="/" element={<Landing />} />
          <Route path="/kesfet" element={<PublicMarketplace />} />
          <Route path="/egitmen/:id" element={<PublicTutorProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
