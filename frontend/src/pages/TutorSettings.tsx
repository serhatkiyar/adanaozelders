import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { UseMutationResult } from "@tanstack/react-query";
import { TutorAccountLayout } from "@/components/TutorAccountLayout";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";
import { MapPicker } from "@/components/MapPicker";
import { ROUTES } from "@/lib/routes";
import {
  useMyTutorProfile,
  useTutorListingAction,
  useUpdateTutorProfile,
} from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { uniqueSubjects } from "@/lib/examTree";
import { WEEKDAYS_LONG, hhmmToMin, minToHHMM } from "@/lib/availability";
import { toast } from "@/store/toastStore";
import {
  TeachingMode,
  TutorStatus,
  type Availability,
  type TutorOut,
} from "@/types";

const SUBJECT_OPTIONS = uniqueSubjects();

// İlan başlığı için minimum sözcük kalite kapısı (backend ile aynı).
const HEADLINE_MIN_WORDS = 10;

/* ─── status metadata ────────────────────────────────── */

type StatusCfg = {
  label: string;
  border: string;
  bg: string;
  dot: string;
  pulse: boolean;
  text: string;
  help: string;
};

const STATUS_CFG: Record<TutorStatus, StatusCfg> = {
  [TutorStatus.DRAFT]: {
    label: "Taslak",
    border: "border-l-slate-300 dark:border-l-slate-600",
    bg: "bg-slate-50 dark:bg-slate-800/60",
    dot: "bg-slate-400",
    pulse: false,
    text: "text-slate-600 dark:text-slate-400",
    help: "İlanın henüz yayında değil. Bilgileri doldurup onaya gönderebilirsin.",
  },
  [TutorStatus.PENDING_APPROVAL]: {
    label: "Onay Bekliyor",
    border: "border-l-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/10",
    dot: "bg-amber-400",
    pulse: true,
    text: "text-amber-700 dark:text-amber-400",
    help: "İlanın yönetici incelemesinde. Onaylanana kadar düzenleme ve işlem yapamazsın.",
  },
  [TutorStatus.APPROVED]: {
    label: "Yayında",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-900/10",
    dot: "bg-emerald-500",
    pulse: false,
    text: "text-emerald-700 dark:text-emerald-400",
    help: "İlanın Marketplace'te aktif olarak görünüyor. Öğrenciler seni bulabilir.",
  },
  [TutorStatus.REJECTED]: {
    label: "Reddedildi",
    border: "border-l-red-400",
    bg: "bg-red-50 dark:bg-red-900/10",
    dot: "bg-red-500",
    pulse: false,
    text: "text-red-700 dark:text-red-400",
    help: "İlanın reddedildi. Bilgilerini güncelleyip tekrar onaya gönderebilirsin.",
  },
  [TutorStatus.SUSPENDED]: {
    label: "Pasif",
    border: "border-l-slate-400 dark:border-l-slate-500",
    bg: "bg-slate-100 dark:bg-slate-800/80",
    dot: "bg-slate-500",
    pulse: false,
    text: "text-slate-600 dark:text-slate-400",
    help: "İlanın geçici olarak pasife alındı. İstediğinde yeniden aktifleştirebilirsin.",
  },
};

/* ─── teaching mode pills ────────────────────────────── */

const MODES = [
  { value: TeachingMode.ONLINE, label: "Uzaktan" },
  { value: TeachingMode.IN_PERSON, label: "Yüzyüze" },
  { value: TeachingMode.BOTH, label: "Her İkisi" },
] as const;

/* ─── shared style tokens ────────────────────────────── */

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500 dark:disabled:bg-slate-800 dark:focus:border-indigo-500";

const labelCls =
  "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

/* ─── main page ─────────────────────────────────────── */

export default function TutorSettings() {
  const { data, isLoading, isError, error } = useMyTutorProfile();
  const updateProfile = useUpdateTutorProfile();
  const submitAction = useTutorListingAction("submit");
  const suspendAction = useTutorListingAction("suspend");
  const activateAction = useTutorListingAction("activate");

  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [lessonInfo, setLessonInfo] = useState("");
  const [introVideoUrl, setIntroVideoUrl] = useState("");
  const [firstLessonFree, setFirstLessonFree] = useState(true);
  const [hourlyRate, setHourlyRate] = useState("");
  const [teachingMode, setTeachingMode] = useState<TeachingMode | "">("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [locationText, setLocationText] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);

  useEffect(() => {
    if (data) {
      setHeadline(data.headline ?? "");
      setBio(data.bio ?? "");
      setLessonInfo(data.lesson_info ?? "");
      setIntroVideoUrl(data.intro_video_url ?? "");
      setFirstLessonFree(data.first_lesson_free ?? true);
      const rate = parseMoney(data.hourly_rate);
      setHourlyRate(rate !== null ? String(rate) : "");
      setTeachingMode(data.teaching_mode ?? "");
      setSubjects(data.subjects ?? []);
      setAvailability(data.availability ?? []);
      setLocationText(data.location_text ?? "");
      setLocationLat(data.location_lat ?? null);
      setLocationLng(data.location_lng ?? null);
    }
  }, [data]);

  const toggleSubject = (q: string) =>
    setSubjects((prev) =>
      prev.includes(q) ? prev.filter((s) => s !== q) : [...prev, q]
    );

  const addWindow = () =>
    setAvailability((p) => [
      ...p,
      { weekday: 0, start_minute: 1080, end_minute: 1200 },
    ]);
  const updateWindow = (i: number, patch: Partial<Availability>) =>
    setAvailability((p) => p.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  const removeWindow = (i: number) =>
    setAvailability((p) => p.filter((_, idx) => idx !== i));

  const editable = !!data && data.status !== TutorStatus.PENDING_APPROVAL;
  const actionBusy =
    submitAction.isPending || suspendAction.isPending || activateAction.isPending;

  const headlineWords = headline.trim() ? headline.trim().split(/\s+/).length : 0;
  const headlineTooShort = headlineWords < HEADLINE_MIN_WORDS;

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (headlineTooShort) {
      toast.error(
        `İlan başlığın en az ${HEADLINE_MIN_WORDS} sözcük olmalı (şu an ${headlineWords}).`
      );
      return;
    }
    let rate: number | null = null;
    if (hourlyRate.trim() !== "") {
      const n = Number(hourlyRate);
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Saatlik ücret geçerli bir sayı olmalı.");
        return;
      }
      rate = n;
    }
    if (availability.some((w) => w.end_minute <= w.start_minute)) {
      toast.error("Müsaitlikte bitiş saati başlangıçtan sonra olmalı.");
      return;
    }
    updateProfile.mutate(
      {
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        lesson_info: lessonInfo.trim() || null,
        intro_video_url: introVideoUrl.trim() || null,
        first_lesson_free: firstLessonFree,
        hourly_rate: rate,
        teaching_mode: teachingMode || null,
        location_text: locationText.trim() || null,
        location_lat: locationLat,
        location_lng: locationLng,
        subjects,
        availability,
      },
      {
        onSuccess: () => toast.success("İlan bilgilerin kaydedildi."),
        onError: (err) =>
          toast.error(getErrorMessage(err, "İlan kaydedilemedi.")),
      }
    );
  };

  const runAction = (
    mutation: UseMutationResult<TutorOut, Error, void>,
    okMsg: string
  ) => {
    mutation.mutate(undefined, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });
  };

  const cfg = data ? STATUS_CFG[data.status] : null;

  return (
    <TutorAccountLayout active="listing" title="İlan Ayarları">
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          İlan ayarları
        </h1>
        <div className="space-y-4 pb-12">
        {isLoading || !data ? (
          isError ? (
            <div className="flex items-start gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800/30">
              <span className="mt-0.5 shrink-0">⚠</span>
              {getErrorMessage(error, "İlan profili yüklenemedi.")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              <div className="h-96 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            </div>
          )
        ) : (
          <>
            <ProfileCompleteness tutor={data} showLink={false} />

            {/* ── Status Card ── */}
            <div
              className={`rounded-2xl border-l-4 px-6 py-5 shadow-sm ring-1 ring-slate-100 dark:ring-slate-700 ${cfg!.border} ${cfg!.bg}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    {cfg!.pulse ? (
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span
                          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${cfg!.dot}`}
                        />
                        <span
                          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cfg!.dot}`}
                        />
                      </span>
                    ) : (
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg!.dot}`}
                      />
                    )}
                    <span className={`text-sm font-bold ${cfg!.text}`}>
                      {cfg!.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {cfg!.help}
                  </p>
                  {(data.status === TutorStatus.DRAFT ||
                    data.status === TutorStatus.REJECTED) && (
                    <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                      ⚠ Onaya gönderebilmek için{" "}
                      <Link
                        to={ROUTES.profile}
                        className="font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300"
                      >
                        Profil → Eğitim
                      </Link>{" "}
                      bölümünden en az bir eğitime diploma/belge yüklemelisin.
                    </p>
                  )}
                </div>

                {/* FSM actions */}
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(data.status === TutorStatus.DRAFT ||
                    data.status === TutorStatus.REJECTED) && (
                    <button
                      onClick={() =>
                        runAction(submitAction, "İlanın onaya gönderildi.")
                      }
                      disabled={actionBusy}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {data.status === TutorStatus.REJECTED
                        ? "Yeniden Gönder"
                        : "Onaya Gönder"}
                    </button>
                  )}
                  {data.status === TutorStatus.APPROVED && (
                    <button
                      onClick={() =>
                        runAction(suspendAction, "İlanın pasife alındı.")
                      }
                      disabled={actionBusy}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                    >
                      İlanı Pasife Al
                    </button>
                  )}
                  {data.status === TutorStatus.SUSPENDED && (
                    <button
                      onClick={() =>
                        runAction(activateAction, "İlanın yeniden yayında.")
                      }
                      disabled={actionBusy}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Yeniden Aktifleştir
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Form Card ── */}
            <div className="rounded-2xl bg-white px-6 py-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                İlan Detayları
              </h2>

              {!editable && (
                <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800/30">
                  <span className="shrink-0">⏳</span>
                  İlanın onay sürecinde; bu sırada düzenleme kapalıdır.
                </div>
              )}

              <form onSubmit={handleSave} className="mt-5 space-y-5">
                {/* Başlık */}
                <div>
                  <label className={labelCls}>Başlık</label>
                  <input
                    type="text"
                    maxLength={255}
                    disabled={!editable}
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    className={inputCls}
                    placeholder="Örn. TYT-AYT Matematik, 8 yıl deneyimli sonuç odaklı özel ders"
                  />
                  <p
                    className={`mt-1.5 text-xs ${
                      headlineTooShort
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {headlineTooShort
                      ? `En az ${HEADLINE_MIN_WORDS} sözcük gerekli — şu an ${headlineWords}. Branşını, sınav türünü ve deneyimini ekle.`
                      : `${headlineWords} sözcük`}
                  </p>
                </div>

                {/* Saatlik Ücret */}
                <div>
                  <label className={labelCls}>Saatlik Ücret</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-semibold text-slate-400">
                      ₺
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      disabled={!editable}
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(e.target.value)}
                      className={`${inputCls} pl-8`}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Eğitim Şekli — pills */}
                <div>
                  <label className={labelCls}>Eğitim Şekli</label>
                  <div className="flex flex-wrap gap-2">
                    {MODES.map((mode) => {
                      const selected = teachingMode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          disabled={!editable}
                          onClick={() =>
                            setTeachingMode(selected ? "" : mode.value)
                          }
                          className={`rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                            selected
                              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200 dark:shadow-none"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                          }`}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                    {teachingMode && editable && (
                      <button
                        type="button"
                        onClick={() => setTeachingMode("")}
                        className="rounded-full px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300"
                      >
                        Temizle
                      </button>
                    )}
                  </div>
                </div>

                {/* Verdiğin Dersler — yapılandırılmış branş seçimi */}
                <div>
                  <label className={labelCls}>Verdiğin Dersler</label>
                  <div className="flex flex-wrap gap-2">
                    {SUBJECT_OPTIONS.map((s) => {
                      const selected = subjects.includes(s.q);
                      return (
                        <button
                          key={s.q}
                          type="button"
                          disabled={!editable}
                          onClick={() => toggleSubject(s.q)}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                            selected
                              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200 dark:shadow-none"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    Seçtiğin dersler, öğrencilerin aramada seni bulmasını sağlar.
                  </p>
                </div>

                {/* Konum — yüzyüze ders ve "yakınımdaki eğitmenler" araması için */}
                <div>
                  <label className={labelCls}>Konum (yüzyüze ders için)</label>
                  <input
                    type="text"
                    value={locationText}
                    disabled={!editable}
                    onChange={(e) => setLocationText(e.target.value)}
                    placeholder="ör. Kadıköy, İstanbul"
                    className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                  />
                  <MapPicker
                    initialLat={locationLat}
                    initialLng={locationLng}
                    readonly={!editable}
                    onLocationSelect={(lat, lng) => {
                      setLocationLat(lat);
                      setLocationLng(lng);
                    }}
                  />
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    {locationLat != null
                      ? `Seçili konum: ${locationLat.toFixed(4)}, ${locationLng?.toFixed(4)} — öğrenciler "yakınımdaki" aramasında seni bulabilir.`
                      : "Haritaya tıklayarak baz konumunu işaretle (opsiyonel)."}
                  </p>
                </div>

                {/* Müsaitlik — haftalık pencereler */}
                <div>
                  <label className={labelCls}>Müsaitlik (haftalık)</label>
                  <div className="space-y-2">
                    {availability.length === 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Pencere eklemezsen öğrenciler herhangi bir saati talep edebilir.
                        Eklersen rezervasyonlar yalnızca bu saatlerde yapılabilir.
                      </p>
                    )}
                    {availability.map((w, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select
                          disabled={!editable}
                          value={w.weekday}
                          onChange={(e) =>
                            updateWindow(i, { weekday: Number(e.target.value) })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        >
                          {WEEKDAYS_LONG.map((d, idx) => (
                            <option key={idx} value={idx}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          step={1800}
                          disabled={!editable}
                          value={minToHHMM(w.start_minute)}
                          onChange={(e) =>
                            updateWindow(i, { start_minute: hhmmToMin(e.target.value) })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        />
                        <span className="text-slate-400">–</span>
                        <input
                          type="time"
                          step={1800}
                          disabled={!editable}
                          value={minToHHMM(w.end_minute)}
                          onChange={(e) =>
                            updateWindow(i, { end_minute: hhmmToMin(e.target.value) })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        />
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => removeWindow(i)}
                          aria-label="Pencereyi sil"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {editable && (
                      <button
                        type="button"
                        onClick={addWindow}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
                      >
                        + Pencere ekle
                      </button>
                    )}
                  </div>
                </div>

                {/* Yaş ve cinsiyet artık profil bilgilerinde (Profil sayfası). */}
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">
                  Yaş ve cinsiyet bilgini{" "}
                  <Link
                    to={ROUTES.profile}
                    className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Profil
                  </Link>{" "}
                  sayfandan düzenleyebilirsin; profilinde ve aramada gösterilir.
                </div>

                {/* Biyografi */}
                <div>
                  <label className={labelCls}>Biyografi</label>
                  <textarea
                    rows={5}
                    disabled={!editable}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className={inputCls}
                    placeholder="Deneyimin, yaklaşımın ve uzmanlık alanların…"
                  />
                </div>

                {/* Ders Hakkında — metodoloji */}
                <div>
                  <label className={labelCls}>Ders Hakkında</label>
                  <textarea
                    rows={5}
                    maxLength={2000}
                    disabled={!editable}
                    value={lessonInfo}
                    onChange={(e) => setLessonInfo(e.target.value)}
                    className={inputCls}
                    placeholder="Dersin nasıl işliyor? Hangi seviyeye/sınava yönelik, ilk ders nasıl geçer, hangi materyalleri kullanıyorsun…"
                  />
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    Öğrenciler dersinin akışını ve yöntemini buradan görür.
                  </p>
                </div>

                {/* Tanıtım videosu */}
                <div>
                  <label className={labelCls}>Tanıtım Videosu</label>
                  <input
                    type="url"
                    disabled={!editable}
                    value={introVideoUrl}
                    onChange={(e) => setIntroVideoUrl(e.target.value)}
                    className={inputCls}
                    placeholder="https://www.youtube.com/watch?v=…"
                  />
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    YouTube veya Vimeo bağlantısı. Profilinin üstünde gömülü oynatılır.
                  </p>
                </div>

                {/* İlk ders ücretsiz */}
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={firstLessonFree}
                    onChange={(e) => setFirstLessonFree(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      İlk ders ücretsiz
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                      Açıkken öğrenciler bu eğitmenle ilk derslerini ücretsiz talep
                      edebilir. Kapatırsan ilanında ücretsiz ders rozeti görünmez.
                    </span>
                  </span>
                </label>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={!editable || updateProfile.isPending}
                    className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateProfile.isPending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
        </div>
      </div>
    </TutorAccountLayout>
  );
}
