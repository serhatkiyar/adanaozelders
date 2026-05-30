import { useMeetingStore } from "@/store/meetingStore";
import { useAuthStore } from "@/store/authStore";

export function GlobalMeeting() {
  const { roomName, tutorName, clientName, isMinimized, leaveMeeting, toggleMinimize } = useMeetingStore();
  const user = useAuthStore((s) => s.user);

  if (!roomName) return null;

  const domain = "meet.jit.si";
  const userInfo = encodeURIComponent(
    JSON.stringify({
      displayName: user?.full_name || "Kullanıcı",
    })
  );
  const url = `https://${domain}/${roomName}#userInfo=${userInfo}`;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[9999] h-64 w-96 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-900 transition-all">
        <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5 text-white">
          <span className="truncate text-xs font-medium">Canlı Ders: {tutorName} - {clientName}</span>
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleMinimize}
              className="text-slate-300 hover:text-white"
              title="Büyüt"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>
            <button
              onClick={leaveMeeting}
              className="text-slate-300 hover:text-red-500"
              title="Dersten Çık"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <iframe
          allow="camera; microphone; display-capture; autoplay; clipboard-write"
          src={url}
          className="h-[calc(100%-32px)] w-full border-0"
          title="Jitsi Video Call Minimized"
        />
      </div>
    );
  }

  // Tam ekran modu
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-900 transition-all">
      <div className="flex items-center justify-between bg-slate-800 px-4 py-3 text-white shadow-md">
        <div className="flex items-center space-x-4">
          <button
            onClick={toggleMinimize}
            className="flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium transition hover:bg-slate-600"
            title="Küçült (Siteye Dön)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            Küçült &amp; Siteye Dön
          </button>
          <span className="text-sm font-medium">Canlı Ders: {tutorName} - {clientName}</span>
        </div>
        <button
          onClick={leaveMeeting}
          className="flex items-center gap-2 rounded-xl bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-600/30"
          title="Dersten Çık"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Görüşmeyi Kapat
        </button>
      </div>
      <div className="flex-1 bg-black">
        <iframe
          allow="camera; microphone; display-capture; autoplay; clipboard-write"
          src={url}
          className="h-full w-full border-0"
          title="Jitsi Video Call"
        />
      </div>
    </div>
  );
}
