import { useState } from "react";
import { useMeetingStore } from "@/store/meetingStore";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBooking } from "@/hooks/useBookings";
import { ROLE_IDS, BookingStatus } from "@/types";
import { BookingResourcesPanel } from "@/components/booking/BookingResourcesPanel";
import { BookingPrivateNotesPanel } from "@/components/booking/BookingPrivateNotesPanel";
import { P2PTransferPanel } from "@/components/booking/P2PTransferPanel";

type DrawerTab = "resources" | "transfer" | "notes";

function MeetingDrawer({ bookingId }: { bookingId: number }) {
  const [tab, setTab] = useState<DrawerTab>("resources");
  const { data: user } = useCurrentUser();
  const { data: booking, isLoading } = useBooking(bookingId);

  const role =
    user?.role_id === ROLE_IDS.TUTOR
      ? "TUTOR"
      : user?.role_id === ROLE_IDS.CLIENT
        ? "CLIENT"
        : null;
  const canEdit =
    booking?.status === BookingStatus.PENDING ||
    booking?.status === BookingStatus.ACCEPTED;

  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "resources", label: "Kaynaklar" },
    { id: "transfer", label: "Dosya Aktar" },
    { id: "notes", label: "Notlar" },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-white text-slate-900 ">
      {/* Sekmeler */}
      <div className="flex shrink-0 gap-1 border-b border-slate-100 p-2 ">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition ${
              tab === t.id
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-100 "
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading || !booking ? (
          <p className="text-sm text-slate-400 ">Yükleniyor…</p>
        ) : tab === "resources" ? (
          <BookingResourcesPanel
            bookingId={bookingId}
            resources={booking.resources}
            role={role}
            userId={user?.id}
            canEdit={canEdit}
            showHeading={false}
          />
        ) : tab === "transfer" ? (
          <P2PTransferPanel />
        ) : (
          <BookingPrivateNotesPanel
            bookingId={bookingId}
            notes={booking.private_notes}
            showHeading={false}
          />
        )}
      </div>
    </div>
  );
}

export function GlobalMeeting() {
  const {
    bookingId,
    roomName,
    tutorName,
    clientName,
    isMinimized,
    isDrawerOpen,
    leaveMeeting,
    toggleMinimize,
    toggleDrawer,
  } = useMeetingStore();
  const user = useAuthStore((s) => s.user);

  if (!roomName) return null;

  const domain = "meet.jit.si";
  const userInfo = encodeURIComponent(
    JSON.stringify({ displayName: user?.full_name || "Kullanıcı" })
  );
  const url = `https://${domain}/${roomName}#userInfo=${userInfo}`;

  // Çekmece açıkken video alanı sağdan daralır (tam ekran modda).
  const drawerActive = !isMinimized && bookingId != null && isDrawerOpen;

  // Tek kalıcı video kutusu: konumu (PiP ↔ tam ekran) sınıfla değişir; iframe
  // aynı DOM düğümünde kaldığından minimize/maximize/çekmece geçişlerinde
  // görüşme YENİDEN BAĞLANMAZ (kopmaz).
  const videoBox = isMinimized
    ? "fixed bottom-4 right-4 h-64 w-96 rounded-2xl shadow-2xl ring-1 ring-slate-200 "
    : `fixed left-0 top-14 bottom-0 ${drawerActive ? "right-[380px]" : "right-0"}`;

  return (
    <div>
      {/* ── Tek kalıcı video ── */}
      <div
        className={`z-[9990] overflow-hidden bg-black transition-all duration-300 ${videoBox}`}
      >
        <iframe
          allow="camera; microphone; display-capture; autoplay; clipboard-write"
          src={url}
          className="h-full w-full border-0"
          title="Jitsi Video Call"
        />
        {/* PiP başlığı (yalnız minimize) */}
        {isMinimized && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-slate-800/90 px-3 py-1.5 text-white backdrop-blur">
            <button
              onClick={toggleMinimize}
              className="truncate text-left text-xs font-medium hover:text-indigo-300"
              title="Büyüt"
            >
              🎥 {tutorName} - {clientName}
            </button>
            <div className="flex items-center space-x-2">
              <button onClick={toggleMinimize} className="text-slate-300 hover:text-white" title="Büyüt">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>
              <button onClick={leaveMeeting} className="text-slate-300 hover:text-red-500" title="Dersten Çık">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Tam ekran kabuğu (üst bar + çekmece) ── */}
      {!isMinimized && (
        <>
          {/* Üst bar */}
          <div className="fixed inset-x-0 top-0 z-[9999] flex h-14 items-center justify-between bg-slate-800 px-4 text-white shadow-md">
            <div className="flex min-w-0 items-center gap-4">
              <button
                onClick={toggleMinimize}
                className="flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium transition hover:bg-slate-600"
                title="Küçült (Siteye Dön), görüşme açık kalır"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                Geri
              </button>
              <span className="truncate text-sm font-medium">
                Canlı Ders: {tutorName} - {clientName}
              </span>
            </div>
            <button
              onClick={leaveMeeting}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-600/30"
              title="Dersten Çık"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Görüşmeyi Kapat
            </button>
          </div>

          {bookingId != null && (
            <>
              {/* Aç tutamağı (çekmece kapalıyken, video sağ kenarında) */}
              {!isDrawerOpen && (
                <button
                  onClick={toggleDrawer}
                  title="Ders panelini aç"
                  className="fixed right-0 top-1/2 z-[9999] flex -translate-y-1/2 items-center rounded-l-xl bg-slate-800/90 py-3 pl-2 pr-1.5 text-white shadow-lg backdrop-blur transition hover:bg-indigo-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}

              {/* Çekmece */}
              <div
                className={`fixed bottom-0 right-0 top-14 z-[9998] w-[380px] border-l border-slate-200 shadow-xl transition-transform duration-300 ${
                  isDrawerOpen ? "translate-x-0" : "translate-x-full"
                }`}
              >
                {/* Kapat tutamağı */}
                <button
                  onClick={toggleDrawer}
                  title="Paneli kapat"
                  className="absolute -left-7 top-1/2 flex -translate-y-1/2 items-center rounded-l-lg bg-slate-100 py-3 pl-1.5 pr-1 text-slate-500 shadow transition hover:bg-slate-200 "
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
                <MeetingDrawer bookingId={bookingId} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
