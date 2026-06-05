import { useState } from "react";
import { useMeetingStore } from "@/store/meetingStore";
import { jitsiUrl } from "@/lib/lesson";

/* ──────────────────────────────────────────────────────────────────────────
 * TEST SAYFASI — Canlı ders (gömülü Jitsi) önizleme (/test-canli-ders)
 *
 * Gerçek canlı ders, ders saatinde `meetingStore.joinMeeting(...)` ile açılır
 * (LessonDetail'deki "Derse Katıl" butonu, zaman kapısı `isLessonJoinable` ile).
 * Bu sayfa o zaman kapısını ATLAYIP store'u elle tetikler ki geliştirirken
 * tam ekran kabuğu / PiP / çekmece (Kaynaklar·Dosya Aktar·Notlar) görülebilsin.
 *
 * Her hesaptan (hatta giriş yapmadan) erişilir. Görüşme penceresi global
 * `GlobalMeeting` tarafından çizilir (App.tsx), bu sayfa yalnız onu başlatır.
 * Production yüzeyi değildir.
 * ────────────────────────────────────────────────────────────────────────── */

export default function TestLiveLesson() {
  const { roomName, bookingId, joinMeeting, leaveMeeting, toggleMinimize } = useMeetingStore();
  const active = !!roomName;

  const [room, setRoom] = useState("ceyhan-test-oda");
  const [tutor, setTutor] = useState("Eğitmen Test");
  const [client, setClient] = useState("Öğrenci Test");
  // Çekmecedeki Kaynaklar/Notlar gerçek booking'den çekilir; boşsa yalnız
  // "Dosya Aktar" sekmesi (booking gerektirmez) ve kabuk önizlenir.
  const [booking, setBooking] = useState("");

  const start = () => {
    const bid = booking.trim() ? Number(booking.trim()) : 0;
    joinMeeting(Number.isFinite(bid) ? bid : 0, room.trim() || "ceyhan-test-oda", tutor, client);
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Test · Prototip</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Canlı ders önizleme</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Zaman kapısını atlayıp gömülü Jitsi penceresini elle başlatır. Kamera/mikrofon izni
            istenir. Tam ekran kabuğu, küçült (PiP) ve ders çekmecesini buradan deneyebilirsin.
          </p>
        </header>

        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          <Field label="Oda adı" hint="İki cihazdan aynı odaya katılmak için aynı adı kullan.">
            <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Eğitmen adı">
              <input className="input" value={tutor} onChange={(e) => setTutor(e.target.value)} />
            </Field>
            <Field label="Öğrenci adı">
              <input className="input" value={client} onChange={(e) => setClient(e.target.value)} />
            </Field>
          </div>
          <Field
            label="Booking ID (opsiyonel)"
            hint="Çekmecedeki Kaynaklar/Notlar gerçek bir derse bağlıdır. Boş bırakırsan yalnız 'Dosya Aktar' sekmesi ve kabuk önizlenir."
          >
            <input
              className="input"
              inputMode="numeric"
              placeholder="örn. 12"
              value={booking}
              onChange={(e) => setBooking(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={start}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              🎥 Canlı dersi başlat
            </button>
            {active && (
              <>
                <button
                  onClick={toggleMinimize}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Küçült / Büyüt
                </button>
                <button
                  onClick={leaveMeeting}
                  className="rounded-xl bg-red-600/10 px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-600/20 dark:text-red-400"
                >
                  Görüşmeyi kapat
                </button>
              </>
            )}
          </div>

          {active && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Görüşme açık · oda <code className="font-mono">{roomName}</code>
              {bookingId ? ` · booking #${bookingId}` : " · booking yok (çekmece kısıtlı)"}.
              Pencere ekranı kaplar; "Geri" ile küçültüp siteyi gezebilirsin.
            </p>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          Oda bağlantısı:{" "}
          <a
            href={jitsiUrl(room.trim() || "ceyhan-test-oda")}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-indigo-500"
          >
            {jitsiUrl(room.trim() || "ceyhan-test-oda")}
          </a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}
