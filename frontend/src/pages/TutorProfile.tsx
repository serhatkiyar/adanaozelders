import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AxiosError } from "axios";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { StarRating } from "@/components/StarRating";
import { Avatar } from "@/components/Avatar";
import { EducationSection } from "@/components/EducationSection";
import { BookmarkButton } from "@/components/BookmarkButton";
import { FullScreenSpinner } from "@/components/Spinner";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { useReviewsByTutor, useReplyToReview } from "@/hooks/useReviews";
import { useBookings, useCreateBooking } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { localInputToIso, formatDateTime, formatLastSeen } from "@/lib/datetime";
import { ageFromBirthDate, GENDER_LABEL } from "@/lib/demographics";
import {
  WEEKDAYS_SHORT,
  hhmmToMin,
  summarize,
  weekdayOfDateStr,
} from "@/lib/availability";
import { formatRate, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { BookingStatus, ROLE_IDS, TeachingMode } from "@/types";
import type { ReviewOut } from "@/types";

/* ─── constants ─────────────────────────────────────────── */

const DURATIONS = [
  { label: "30 dk", value: 30 },
  { label: "1 saat", value: 60 },
  { label: "1.5 saat", value: 90 },
  { label: "2 saat", value: 120 },
];

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00",
  "17:00", "18:00", "19:00", "20:00",
  "21:00", "22:00",
];

const MODE_LABEL: Partial<Record<TeachingMode, string>> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüzyüze",
  [TeachingMode.BOTH]: "Uzaktan & Yüzyüze",
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const today = new Date();
const QUICK_DATES = [
  { label: "Bugün", value: toDateStr(today) },
  { label: "Yarın", value: toDateStr(new Date(today.getTime() + 86_400_000)) },
  { label: "+2 gün", value: toDateStr(new Date(today.getTime() + 2 * 86_400_000)) },
];

/* ─── ReviewCard ─────────────────────────────────────────── */

function ReviewCard({
  review,
  canReply,
  replyMutation,
}: {
  review: ReviewOut;
  canReply: boolean;
  replyMutation: ReturnType<typeof useReplyToReview>;
}) {
  const name = review.client_name ?? "Anonim";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const submitReply = () => {
    if (!text.trim()) {
      toast.error("Lütfen bir yanıt yaz.");
      return;
    }
    replyMutation.mutate(
      { reviewId: review.id, reply: text.trim() },
      {
        onSuccess: () => {
          toast.success("Yanıtın eklendi.");
          setEditing(false);
          setText("");
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Yanıt eklenemedi.")),
      }
    );
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <Avatar name={name} avatar_url={review.client_avatar_url} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {name}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {formatDateTime(review.created_at)}
            </span>
          </div>
          <div className="mt-1">
            <StarRating value={review.rating} />
          </div>
          {review.comment_text && (
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {review.comment_text}
            </p>
          )}

          {review.tutor_reply && (
            <div className="mt-3 rounded-xl border-l-2 border-indigo-300 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/40 dark:bg-indigo-500/10">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                Eğitmen yanıtı
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {review.tutor_reply}
              </p>
            </div>
          )}

          {canReply && !review.tutor_reply && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 text-sm font-medium text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
            >
              Yanıtla
            </button>
          )}

          {canReply && editing && (
            <div className="mt-3 space-y-2">
              <textarea
                rows={3}
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder="Değerlendirmeye yanıtını yaz…"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setText("");
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={submitReply}
                  disabled={replyMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
                >
                  {replyMutation.isPending ? "Gönderiliyor…" : "Yanıtla"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── pill button helper ─────────────────────────────────── */

function Pill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl px-3.5 py-2 text-sm font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-indigo-600 text-white shadow-sm"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

/* ─── main page ─────────────────────────────────────────── */

export default function TutorProfile() {
  const { id } = useParams();
  const tutorId = Number(id);
  const navigate = useNavigate();

  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;

  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  const { data: reviews, isLoading: reviewsLoading } = useReviewsByTutor(tutorId);
  const { data: myBookings } = useBookings({ limit: 100 });
  const hasActiveBooking = (myBookings ?? []).some(
    (b) =>
      b.tutor_id === tutorId &&
      (b.status === BookingStatus.PENDING ||
        b.status === BookingStatus.ACCEPTED)
  );

  // Booking state — split date + time for pill UX
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<TeachingMode>(TeachingMode.ONLINE);
  const [bookingLocation, setBookingLocation] = useState("");

  const createBooking = useCreateBooking();
  const replyMutation = useReplyToReview(tutorId);
  const isOwnerTutor =
    currentUser?.role_id === ROLE_IDS.TUTOR && currentUser.id === tutorId;

  const startLocal =
    selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : "";

  const todayStr = toDateStr(new Date());
  const nowHour = new Date().getHours();

  const hasAvailability = (tutor?.availability?.length ?? 0) > 0;
  // Seçili güne ait müsaitlik pencereleri (null = müsaitlik tanımsız → kısıt yok).
  const dayWindows = useMemo(() => {
    if (!selectedDate || !hasAvailability) return null;
    const wd = weekdayOfDateStr(selectedDate);
    return (tutor?.availability ?? []).filter((a) => a.weekday === wd);
  }, [selectedDate, hasAvailability, tutor?.availability]);

  const isTimeDisabled = (time: string) => {
    if (selectedDate && selectedDate < todayStr) return true;
    if (selectedDate === todayStr && parseInt(time.slice(0, 2), 10) <= nowHour)
      return true;
    if (dayWindows !== null) {
      const t = hhmmToMin(time);
      return !dayWindows.some(
        (w) => w.start_minute <= t && t + duration <= w.end_minute
      );
    }
    return false;
  };

  // Seçili saat, gün/süre/müsaitlik değişince geçersiz kalırsa temizle.
  useEffect(() => {
    if (selectedTime && isTimeDisabled(selectedTime)) setSelectedTime("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, duration, dayWindows]);

  const handleBooking = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      toast.error("Lütfen tarih ve saat seçin.");
      return;
    }
    const start = new Date(startLocal);
    const end = new Date(start.getTime() + duration * 60_000);
    const canChoose =
      !tutor?.teaching_mode || tutor.teaching_mode === TeachingMode.BOTH;
    const lessonMode = canChoose
      ? mode
      : (tutor!.teaching_mode as TeachingMode);
    createBooking.mutate(
      {
        tutor_id: tutorId,
        start_at: localInputToIso(startLocal),
        end_at: end.toISOString(),
        notes: notes.trim() || null,
        mode: lessonMode,
        location:
          lessonMode === TeachingMode.IN_PERSON
            ? bookingLocation.trim() || null
            : null,
      },
      {
        onSuccess: () => {
          toast.success("Rezervasyon talebin gönderildi.");
          navigate("/student/bookings");
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 409) {
            toast.error("Bu saat dolu — lütfen başka bir zaman seçin.");
            return;
          }
          if (err instanceof AxiosError && err.response?.status === 422) {
            toast.error("Seçtiğin saat eğitmenin müsaitliği dışında.");
            return;
          }
          toast.error(getErrorMessage(err, "Rezervasyon oluşturulamadı."));
        },
      }
    );
  };


  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <DashboardShell title="Eğitmen" navItems={navItems}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">Eğitmen bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  const hasRatings = tutor.rating_count > 0;
  const modeLabel = tutor.teaching_mode ? MODE_LABEL[tutor.teaching_mode] : null;
  const canChooseMode =
    !tutor.teaching_mode || tutor.teaching_mode === TeachingMode.BOTH;
  const age = ageFromBirthDate(tutor.birth_date);
  const genderLabel =
    tutor.gender && tutor.gender !== "UNSPECIFIED"
      ? GENDER_LABEL[tutor.gender]
      : null;
  const isOnline =
    !!tutor.last_seen_at &&
    Date.now() - new Date(tutor.last_seen_at).getTime() < 120_000;

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500";

  return (
    <DashboardShell title="Eğitmen Detayı" navItems={navItems}>
      <div className="mx-auto max-w-4xl space-y-5 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          ← Geri dön
        </button>

        {/* ── Header ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {tutor.full_name}
              </h1>
              {tutor.headline && (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {tutor.headline}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <StarRating value={tutor.rating_average} />
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {hasRatings
                      ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count} değerlendirme)`
                      : "Henüz değerlendirme yok"}
                  </span>
                </div>
                {modeLabel && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {modeLabel}
                  </span>
                )}
                {age !== null && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {age} yaş
                  </span>
                )}
                {genderLabel && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {genderLabel}
                  </span>
                )}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                />
                {isOnline ? "Çevrimiçi" : formatLastSeen(tutor.last_seen_at)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              {currentUser?.role_id === ROLE_IDS.CLIENT && (
                <div className="flex items-center gap-2">
                  {hasActiveBooking && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/messages?to=${tutor.id}&name=${encodeURIComponent(tutor.full_name)}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                      </svg>
                      Mesaj Gönder
                    </button>
                  )}
                  <BookmarkButton tutorId={tutor.id} size="md" />
                </div>
              )}
              {rate !== null ? (
                <div>
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">
                    {formatRate(tutor.hourly_rate)}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-slate-400">
                  Ücret belirtilmemiş
                </span>
              )}
              <div className="mt-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-center text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                Sıralama {tutor.bayesian_score.toFixed(2)}
              </div>
            </div>
          </div>
        </section>

        {/* ── Bio ── */}
        {tutor.bio && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Hakkında
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {tutor.bio}
            </p>
          </section>
        )}

        {/* ── Verdiği Dersler ── */}
        {tutor.subjects && tutor.subjects.length > 0 && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Verdiği Dersler
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {tutor.subjects.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Eğitim (salt-okunur; boşsa gizli) ── */}
        <EducationSection educations={tutor.educations} />

        {/* ── Booking ── */}
        <div>
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Rezervasyon Talebi
            </h2>
            {hasAvailability && (
              <div className="mt-3 rounded-xl bg-indigo-50 px-4 py-2.5 text-xs leading-relaxed text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                <span className="font-semibold">Müsait saatler:</span>{" "}
                {summarize(tutor.availability ?? [])
                  .map((s) => `${WEEKDAYS_SHORT[s.weekday]} ${s.ranges}`)
                  .join(" · ")}
              </div>
            )}
            <form onSubmit={handleBooking} className="mt-4 space-y-5">
              {/* Quick date pills */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Tarih
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_DATES.map((d) => (
                    <Pill
                      key={d.value}
                      active={selectedDate === d.value}
                      onClick={() => setSelectedDate(d.value)}
                    >
                      {d.label}
                    </Pill>
                  ))}
                  {selectedDate && !QUICK_DATES.find((d) => d.value === selectedDate) && (
                    <span className="flex items-center rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white">
                      {selectedDate}
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  min={todayStr}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                />
              </div>

              {/* Time slot pills */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Saat
                </p>
                <div className="flex flex-wrap gap-2">
                  {TIME_SLOTS.map((t) => {
                    const disabled = isTimeDisabled(t);
                    return (
                      <Pill
                        key={t}
                        active={selectedTime === t}
                        disabled={disabled}
                        onClick={() => setSelectedTime(t)}
                      >
                        {t}
                      </Pill>
                    );
                  })}
                </div>
                {dayWindows !== null && dayWindows.length === 0 && selectedDate && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Eğitmen bu gün müsait değil — başka bir gün seç.
                  </p>
                )}
              </div>

              {/* Duration pills */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Süre
                </p>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <Pill
                      key={d.value}
                      active={duration === d.value}
                      onClick={() => setDuration(d.value)}
                    >
                      {d.label}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Ders şekli — yalnızca eğitmen her ikisini de sunuyorsa seçilir */}
              {canChooseMode && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Ders Şekli
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Pill
                      active={mode === TeachingMode.ONLINE}
                      onClick={() => setMode(TeachingMode.ONLINE)}
                    >
                      Uzaktan
                    </Pill>
                    <Pill
                      active={mode === TeachingMode.IN_PERSON}
                      onClick={() => setMode(TeachingMode.IN_PERSON)}
                    >
                      Yüzyüze
                    </Pill>
                  </div>
                </div>
              )}

              {/* Buluşma yeri — yüzyüze ders seçiliyse */}
              {((canChooseMode && mode === TeachingMode.IN_PERSON) ||
                (!canChooseMode &&
                  tutor.teaching_mode === TeachingMode.IN_PERSON)) && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Buluşma Yeri (opsiyonel)
                  </label>
                  <input
                    value={bookingLocation}
                    onChange={(e) => setBookingLocation(e.target.value)}
                    maxLength={300}
                    className={inputCls}
                    placeholder="Adres / buluşma noktası — ders sayfasından da düzenlenebilir"
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Not (opsiyonel)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={inputCls}
                  placeholder="Konu, hedef, özel istek…"
                />
              </div>

              {startLocal && (
                <p className="rounded-xl bg-indigo-50 px-4 py-2.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  Seçilen: {selectedDate} — {selectedTime} ({duration} dk)
                </p>
              )}

              <button
                type="submit"
                disabled={createBooking.isPending || !startLocal}
                className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createBooking.isPending ? "Gönderiliyor…" : "Rezervasyon Talep Et"}
              </button>
            </form>
          </section>
        </div>

        {/* ── Reviews ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Değerlendirmeler
            </h2>
            {hasRatings && (
              <div className="flex items-center gap-2">
                <StarRating value={tutor.rating_average} />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {tutor.rating_average?.toFixed(1)}
                </span>
                <span className="text-xs text-slate-400">
                  ({tutor.rating_count})
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {reviewsLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700"
                />
              ))
            ) : !reviews || reviews.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Henüz değerlendirme yok.
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Tamamlanan derslerden sonra öğrenciler yorum bırakabilir.
                </p>
              </div>
            ) : (
              reviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  canReply={isOwnerTutor}
                  replyMutation={replyMutation}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

