import { FormEvent, useEffect, useState, useId } from "react";
import { Link } from "react-router-dom";
import type { UseMutationResult } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";
import { ProfilFotografi } from "@/components/ProfilFotografi";
import { EducationSection } from "@/components/EducationSection";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MapPicker } from "@/components/MapPicker";
import { ADANA_DISTRICTS } from "@/lib/districts";
import { ROUTES } from "@/lib/routes";
import {
  useMyTutorProfile,
  useTutorListingAction,
  useUpdateTutorProfile,
} from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { DersSecici } from "@/components/tutor/DersSecici";
import { useLevelScales, useSubjects } from "@/hooks/useSubjects";
import type { Ders } from "@/api/subjects";
import { WEEKDAYS_LONG, hhmmToMin, minToHHMM } from "@/lib/availability";
import { toast } from "@/store/toastStore";
import {
  TeachingMode,
  TutorStatus,
  type Availability,
  type TutorOut,
} from "@/types";
import { BASLIK_EN_AZ_KELIME, kelimeSay } from "@/lib/metin";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_BIRINCIL,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";


/* ─── status metadata ────────────────────────────────── */

type StatusCfg = {
  label: string;
  dot: string;
  pulse: boolean;
  text: string;
  help: string;
};

const STATUS_CFG: Record<TutorStatus, StatusCfg> = {
  [TutorStatus.DRAFT]: {
    label: "Taslak",
    dot: "bg-slate-400",
    pulse: false,
    text: "text-slate-600",
    help: "İlanın henüz yayında değil. Bilgileri doldurup onaya gönderebilirsin.",
  },
  [TutorStatus.PENDING_APPROVAL]: {
    label: "Onay Bekliyor",
    dot: "bg-amber-400",
    pulse: true,
    text: "text-amber-700",
    help: "İlanın yönetici incelemesinde. Onaylanana kadar düzenleme ve işlem yapamazsın.",
  },
  [TutorStatus.APPROVED]: {
    label: "Yayında",
    dot: "bg-emerald-500",
    pulse: false,
    text: "text-emerald-700",
    help: "İlanın Marketplace'te aktif olarak görünüyor. Öğrenciler seni bulabilir.",
  },
  [TutorStatus.REJECTED]: {
    label: "Reddedildi",
    dot: "bg-red-500",
    pulse: false,
    text: "text-red-700",
    help: "İlanın reddedildi. Bilgilerini güncelleyip tekrar onaya gönderebilirsin.",
  },
  [TutorStatus.SUSPENDED]: {
    label: "Pasif",
    dot: "bg-slate-500",
    pulse: false,
    text: "text-slate-600",
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
  "w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-base leading-6 text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-marka-mid focus:ring-2 focus:ring-marka/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

const labelCls = `mb-2 block ${ETIKET}`;

/** Müsaitlik satırındaki küçük denetimler — satır düğmeleriyle aynı 40px. */
const satirGirdiCls =
  "h-10 rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-900 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 disabled:cursor-not-allowed disabled:opacity-50";

/* ─── main page ─────────────────────────────────────── */

export default function TutorSettings() {
  const uid = useId();
  const { data, isLoading, isError, error } = useMyTutorProfile();
  const { data: currentUser } = useCurrentUser();
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
  // {subject_id: [level_id]} — ders başına verilen seviyeler.
  const [subjectLevels, setSubjectLevels] = useState<Record<number, number[]>>({});
  // Eğitmen tarafı TAM kataloğu görür: branşını bildiremeyen eğitmen arzdan düşer.
  const { data: katalog } = useSubjects("secim");
  const { data: merdivenler } = useLevelScales();
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [locationText, setLocationText] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [district, setDistrict] = useState("");

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
      setDistrict(data.district ?? "");
      setSubjectLevels(
        Object.fromEntries(
          Object.entries(data.subject_levels ?? {}).map(([k, v]) => [Number(k), v])
        )
      );
    }
  }, [data]);

  const toggleSubject = (ders: Ders) => {
    setSubjects((prev) =>
      prev.includes(ders.name)
        ? prev.filter((s) => s !== ders.name)
        : [...prev, ders.name]
    );
    // Ders kaldırılınca seviyeleri de gider; sunucu zaten temizliyor ama
    // ekranda asılı kalmasınlar.
    setSubjectLevels((prev) => {
      if (!prev[ders.id]) return prev;
      const { [ders.id]: _cikan, ...kalan } = prev;
      return kalan;
    });
  };

  const toggleLevel = (dersId: number, levelId: number) =>
    setSubjectLevels((prev) => {
      const mevcut = prev[dersId] ?? [];
      return {
        ...prev,
        [dersId]: mevcut.includes(levelId)
          ? mevcut.filter((l) => l !== levelId)
          : [...mevcut, levelId],
      };
    });

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

  const headlineWords = kelimeSay(headline);
  const headlineTooShort = headlineWords < BASLIK_EN_AZ_KELIME;

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (headlineTooShort) {
      toast.error(
        `İlan başlığın en az ${BASLIK_EN_AZ_KELIME} sözcük olmalı (şu an ${headlineWords}).`
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
        district: district || null,
        subjects,
        subject_levels: Object.entries(subjectLevels)
          .filter(([, lv]) => lv.length > 0)
          .map(([sid, lv]) => ({ subject_id: Number(sid), level_ids: lv })),
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
    <DashboardShell title="İlan Ayarları" genislik="dar">
      <div className="px-1 pt-2 sm:px-2">
        <h1 className={`mb-6 ${SAYFA_BASLIGI}`}>
          İlan ayarları
        </h1>

        <div className="space-y-6 pb-12">
        {isLoading || !data ? (
          isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-base leading-6 text-red-700">
              {getErrorMessage(error, "İlan profili yüklenemedi.")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-96 animate-pulse rounded-lg bg-slate-100" />
            </div>
          )
        ) : (
          <>
            {/* ── İlanın yüzü: fotoğraf + ad ──
                8 Eyl 2026: fotoğraf "Hesabım" ekranındaydı ve o ekran şeritten
                kalktı. Fotoğraf zaten ilana ait: öğrencinin arama sonucunda ve
                ilan sayfasında gördüğü şey bu. Preply "Photo", Wyzant "Photos"
                — ikisi de profil/ilan ekranında tutuyor. */}
            <div className={`flex items-center gap-5 ${KART}`}>
              <ProfilFotografi />
              <div className="min-w-0">
                <p className={`truncate ${ETIKET}`}>
                  {currentUser?.full_name ?? ""}
                </p>
                <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
                  İlanının ve arama sonuçlarının yüzü bu fotoğraf. Üstüne
                  gelip değiştirebilirsin.
                </p>
              </div>
            </div>

            <ProfileCompleteness tutor={data} showLink={false} />

            {/* ── Status Card ── */}
            <div
              className={KART}
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
                    <span className={`text-base font-semibold leading-6 ${cfg!.text}`}>
                      {cfg!.label}
                    </span>
                  </div>
                  <p className={`mt-2 ${ACIKLAMA}`}>
                    {cfg!.help}
                  </p>
                  {/* Eğitim bölümü ARTIK BU SAYFADA (8 Eyl 2026): eskiden
                      başka bir ekrana ("Profil") link veriyordu. */}
                  {(data.status === TutorStatus.DRAFT ||
                    data.status === TutorStatus.REJECTED) && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">
                      Onaya gönderebilmek için aşağıdaki{" "}
                      <strong className="font-semibold">Eğitim ve belgeler</strong>{" "}
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
                      className={DUGME_SATIR_BIRINCIL}
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
                      className={DUGME_SATIR_IKINCIL}
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
                      className={DUGME_SATIR_BIRINCIL}
                    >
                      Yeniden Aktifleştir
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Form Card ── */}
            <div className={KART}>
              <h2 className={BOLUM_BASLIGI}>
                İlan Detayları
              </h2>

              {!editable && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-base leading-6 text-amber-800">
                  İlanın onay sürecinde; bu sırada düzenleme kapalıdır.
                </div>
              )}

              <form onSubmit={handleSave} className="mt-6 space-y-6">
                {/* Başlık */}
                <div>
                  <label htmlFor={`${uid}-baslik`} className={labelCls}>Başlık</label>
                  <input id={`${uid}-baslik`}
                    type="text"
                    maxLength={255}
                    disabled={!editable}
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    className={inputCls}
                    placeholder="Örn. TYT-AYT Matematik, 8 yıl deneyimli sonuç odaklı özel ders"
                  />
                  <p
                    className={`mt-2 ${
                      headlineTooShort
                        ? "text-sm leading-5 text-amber-700"
                        : KUCUK_ACIKLAMA
                    }`}
                  >
                    {headlineTooShort
                      ? `En az ${BASLIK_EN_AZ_KELIME} sözcük gerekli, şu an ${headlineWords}. Branşını, sınav türünü ve deneyimini ekle.`
                      : `${headlineWords} sözcük`}
                  </p>
                </div>

                {/* Saatlik Ücret */}
                <div>
                  <label htmlFor={`${uid}-saatlik-ucret`} className={labelCls}>Saatlik Ücret</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base font-semibold text-slate-500">
                      TL
                    </span>
                    <input id={`${uid}-saatlik-ucret`}
                      type="number"
                      min={250}
                      max={5000}
                      step={1}
                      disabled={!editable}
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(e.target.value)}
                      className={`${inputCls} pl-12`}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Eğitim Şekli — pills */}
                <div>
                  <span className={labelCls}>Eğitim Şekli</span>
                  <div role="group" aria-label="Eğitim Şekli" className="flex flex-wrap gap-2">
                    {MODES.map((mode) => {
                      const selected = teachingMode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          disabled={!editable}
                          aria-pressed={selected}
                          onClick={() =>
                            setTeachingMode(selected ? "" : mode.value)
                          }
                          className={
                            selected ? DUGME_SATIR_BIRINCIL : DUGME_SATIR_IKINCIL
                          }
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                    {teachingMode && editable && (
                      <button
                        type="button"
                        onClick={() => setTeachingMode("")}
                        className={`h-10 px-2 ${METIN_BAGLANTI}`}
                      >
                        Temizle
                      </button>
                    )}
                  </div>
                </div>

                {/* Verdiğin Dersler — yapılandırılmış branş seçimi */}
                <div>
                  <span className={labelCls}>Verdiğin Dersler</span>
                  <DersSecici
                    katalog={katalog}
                    merdivenler={merdivenler}
                    secili={subjects}
                    seviyeler={subjectLevels}
                    duzenlenebilir={editable}
                    onToggle={toggleSubject}
                    onSeviye={toggleLevel}
                  />
                  <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
                    Seçtiğin dersler ve seviyeler, öğrencilerin aramada seni
                    bulmasını sağlar.
                  </p>
                </div>

                {/* İlçe — aramadaki "İlçe" filtresini besler (yapısal) */}
                <div>
                  <label htmlFor={`${uid}-ilce`} className={labelCls}>İlçe</label>
                  <div className="relative">
                    <select id={`${uid}-ilce`}
                      value={district}
                      disabled={!editable}
                      onChange={(e) => setDistrict(e.target.value)}
                      className={`${inputCls} cursor-pointer appearance-none pr-10`}
                    >
                      <option value="">İlçe seç (opsiyonel)</option>
                      {ADANA_DISTRICTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </div>
                  <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
                    Öğrenciler aramada ilçeye göre eğitmen filtreler.
                  </p>
                </div>

                {/* Konum — yüzyüze ders ve "yakınımdaki eğitmenler" araması için */}
                <div>
                  <label htmlFor={`${uid}-konum-yuzyuze-ders-icin`} className={labelCls}>Konum (yüzyüze ders için)</label>
                  <input id={`${uid}-konum-yuzyuze-ders-icin`}
                    type="text"
                    value={locationText}
                    disabled={!editable}
                    onChange={(e) => setLocationText(e.target.value)}
                    placeholder="ör. Kadıköy, İstanbul"
                    className={`${inputCls} mb-3`}
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
                  <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
                    {locationLat != null
                      ? `Seçili konum: ${locationLat.toFixed(4)}, ${locationLng?.toFixed(4)}, öğrenciler "yakınımdaki" aramasında seni bulabilir.`
                      : "Haritaya tıklayarak baz konumunu işaretle (opsiyonel)."}
                  </p>
                </div>

                {/* Müsaitlik — haftalık pencereler */}
                <div>
                  <label htmlFor={`${uid}-musaitlik-haftalik`} className={labelCls}>Müsaitlik (haftalık)</label>
                  <div className="space-y-3">
                    {availability.length === 0 && (
                      <p className={KUCUK_ACIKLAMA}>
                        Pencere eklemezsen öğrenciler herhangi bir saati talep edebilir.
                        Eklersen rezervasyonlar yalnızca bu saatlerde yapılabilir.
                      </p>
                    )}
                    {availability.map((w, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select id={`${uid}-musaitlik-haftalik`}
                          disabled={!editable}
                          value={w.weekday}
                          onChange={(e) =>
                            updateWindow(i, { weekday: Number(e.target.value) })
                          }
                          className={satirGirdiCls}
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
                          className={satirGirdiCls}
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
                          className={satirGirdiCls}
                        />
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => removeWindow(i)}
                          aria-label="Pencereyi sil"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
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
                        className={DUGME_SATIR_IKINCIL}
                      >
                        + Pencere ekle
                      </button>
                    )}
                  </div>
                </div>

                {/* KIRIK YÖNLENDİRME DÜZELTİLDİ (8 Eyl 2026).
                    Burası eskiden "Profil" sayfasına yolluyordu; orada yaş ve
                    cinsiyet SALT-OKUNURDU ve gerçek editör Ayarlar > Kişisel
                    bilgiler'deydi. Kullanıcı iki sıçrama yapıyor, ikincisini
                    kendi buluyordu. Artık doğrudan doğru sekmeye gidiyor. */}
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-base leading-6 text-slate-600">
                  Yaş ve cinsiyet bilgini{" "}
                  <Link
                    to={`${ROUTES.settings}?bolum=kisisel`}
                    className={METIN_BAGLANTI}
                  >
                    Ayarlar
                  </Link>{" "}
                  sayfasından düzenleyebilirsin; ilanında ve aramada gösterilir.
                </div>

                {/* Biyografi */}
                <div>
                  <label htmlFor={`${uid}-biyografi`} className={labelCls}>Biyografi</label>
                  <textarea id={`${uid}-biyografi`}
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
                  <label htmlFor={`${uid}-ders-hakkinda`} className={labelCls}>Ders Hakkında</label>
                  <textarea id={`${uid}-ders-hakkinda`}
                    rows={5}
                    maxLength={2000}
                    disabled={!editable}
                    value={lessonInfo}
                    onChange={(e) => setLessonInfo(e.target.value)}
                    className={inputCls}
                    placeholder="Dersin nasıl işliyor? Hangi seviyeye/sınava yönelik, ilk ders nasıl geçer, hangi materyalleri kullanıyorsun…"
                  />
                  <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
                    Öğrenciler dersinin akışını ve yöntemini buradan görür.
                  </p>
                </div>

                {/* Tanıtım videosu */}
                <div>
                  <label htmlFor={`${uid}-tanitim-videosu`} className={labelCls}>Tanıtım Videosu</label>
                  <input id={`${uid}-tanitim-videosu`}
                    type="url"
                    disabled={!editable}
                    value={introVideoUrl}
                    onChange={(e) => setIntroVideoUrl(e.target.value)}
                    className={inputCls}
                    placeholder="https://www.youtube.com/watch?v=…"
                  />
                  <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>
                    YouTube veya Vimeo bağlantısı. Profilinin üstünde gömülü oynatılır.
                  </p>
                </div>

                {/* İlk ders ücretsiz */}
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={firstLessonFree}
                    onChange={(e) => setFirstLessonFree(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-marka"
                  />
                  <span>
                    <span className={`block ${ETIKET}`}>
                      İlk ders ücretsiz
                    </span>
                    <span className={`mt-1 block ${KUCUK_ACIKLAMA}`}>
                      Açıkken öğrenciler bu eğitmenle ilk derslerini ücretsiz talep
                      edebilir. Kapatırsan ilanında ücretsiz ders rozeti görünmez.
                    </span>
                  </span>
                </label>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={!editable || updateProfile.isPending}
                    className={DUGME_BIRINCIL}
                  >
                    {updateProfile.isPending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>

            {/* ── Eğitim ve belgeler ──
                8 Eyl 2026: bu bölüm "Hesabım" ekranındaydı ve o ekran şeritten
                kalktı. Buraya taşınmasının sebebi yalnız yer değişikliği değil:
                profil doluluk ölçerinin sekiz maddesinden BİRİ (diploma/belge)
                orada dolduruluyor, ölçerin kendisi ise burada duruyordu ve
                "İlan Ayarları'na git" diyordu. Yani eksik olan tek madde
                diplomaysa ölçer kullanıcıyı zaten bulunduğu sayfaya yolluyordu.
                Sekiz maddenin sekizi de artık tek ekranda.

                Belgenin ilanda GÖRÜNMEDİĞİ açıkça yazılı — Lessonface'in
                "Credentials … not displayed publicly" deseni. */}
            <div className={KART}>
              <h2 className={BOLUM_BASLIGI}>
                Eğitim ve belgeler
              </h2>
              <p className={`mt-2 ${ACIKLAMA}`}>
                Okulun ilanında görünür. Yüklediğin diploma veya belge{" "}
                <strong className="font-semibold text-slate-900">
                  ilanında gösterilmez
                </strong>
                ; yalnız doğrulama için kullanılır ve onaylanınca ilanında
                "Diploması Doğrulandı" rozeti çıkar.
              </p>
              <div className="mt-6">
                <EducationSection editable bare withDocument />
              </div>
            </div>

          {/* ÖNE ÇIKAR — bu satır kaldırılamaz: `/ilanimi-one-cikar` sayfasının
              TEK girişi burasıdır. Eskiden `TutorAccountLayout`'un sol
              menüsündeydi; o kabuk kalkınca (panel şeridi geldi, sol menüde
              şeritle çakışmayan tek öğe kalmıştı) buraya taşındı. Öne çıkarma
              ilana ait bir eylemdir, hesaba değil — yeri de burasıdır.
              Silinirse rota ayakta kalır, sayfa çalışır, hiçbir test kırılmaz;
              yalnız eğitmen oraya gidemez. Nöbetçi: `panoSeridi.test.tsx`. */}
          <Link
            to={ROUTES.tutorPromotion}
            className={`flex items-center justify-between gap-4 transition hover:bg-slate-50 ${KART}`}
          >
            <span className="min-w-0">
              <span className={`block ${ETIKET}`}>
                İlanını öne çıkar
              </span>
              <span className={`mt-1 block ${ACIKLAMA}`}>
                Arama sonuçlarının üstündeki blokta "Reklam" ibaresiyle görün.
              </span>
            </span>
            <span className={`shrink-0 ${METIN_BAGLANTI}`}>
              Paketler →
            </span>
          </Link>

          {/* DEĞERLENDİRMELER — sayfanın TEK girişi (18 Eyl 2026): hesap
              menüsünden kalktı (Preply'da da ayrı yeri yok). Yorumlar ilanın
              parçası; yanıtlama bu sayfada. Silinirse eğitmen yorumlara
              yanıt veremez. */}
          <Link
            to={ROUTES.tutorReviews}
            className={`flex items-center justify-between gap-4 transition hover:bg-slate-50 ${KART}`}
          >
            <span className="min-w-0">
              <span className={`block ${ETIKET}`}>Değerlendirmeler</span>
              <span className={`mt-1 block ${ACIKLAMA}`}>
                Öğrencilerin yorumlarını gör ve yanıtla.
              </span>
            </span>
            <span className={`shrink-0 ${METIN_BAGLANTI}`}>Gör →</span>
          </Link>
          </>
        )}
        </div>
      </div>
    </DashboardShell>
  );
}
