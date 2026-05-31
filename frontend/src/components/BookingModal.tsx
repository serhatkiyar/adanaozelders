import { FormEvent, useEffect, useMemo, useState } from "react";
import { useCreateBooking } from "@/hooks/useBookings";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import { localInputToIso } from "@/lib/datetime";
import {
  WEEKDAYS_SHORT,
  hhmmToMin,
  summarize,
  weekdayOfDateStr,
} from "@/lib/availability";
import { TeachingMode } from "@/types";
import type { SavedAddress, TutorSearchOut } from "@/types";
import { ScrollableRow } from "@/components/ScrollableRow";
import { SavedAddressCard } from "@/components/address/SavedAddressCard";
import { AddressForm } from "@/components/address/AddressForm";
import {
  useMyAddresses,
  useAddAddress,
  useUpdateAddress,
  useDeleteAddress,
} from "@/hooks/useAddresses";
import type { SavedAddressCreate } from "@/types";

const DURATIONS = [
  { label: "30 dk", value: 30 },
  { label: "1 saat", value: 60 },
  { label: "1.5 saat", value: 90 },
  { label: "2 saat", value: 120 },
];

// TIME_SLOTS array removed since we use native time input

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const today = new Date();
const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function generateNext14Days() {
  const dates = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const dateStr = toDateStr(d);
    const wd = weekdayOfDateStr(dateStr);
    dates.push({
      value: dateStr,
      dayNum: d.getDate(),
      month: MONTHS_SHORT[d.getMonth()],
      weekday: WEEKDAYS_SHORT[wd],
      label: i === 0 ? "Bugün" : i === 1 ? "Yarın" : WEEKDAYS_SHORT[wd],
    });
  }
  return dates;
}
const NEXT_14_DAYS = generateNext14Days();

function Pill({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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

function TimeStepper({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [hStr, mStr] = (value || "09:00").split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;

  useEffect(() => {
    if (!value) onChange("09:00");
  }, [value, onChange]);

  const update = (newH: number, newM: number) => {
    let finalH = newH;
    let finalM = newM;
    if (finalH < 0) finalH = 23;
    if (finalH > 23) finalH = 0;
    if (finalM < 0) finalM = 45;
    if (finalM > 45) finalM = 0;
    onChange(`${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`);
  };

  return (
    <div className="flex items-center justify-center gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700/50 dark:bg-slate-800/20">
      {/* Saat */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => update(h + 1, m)}
          className="rounded-xl bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="w-14 text-center text-3xl font-black text-slate-800 dark:text-white">
          {String(h).padStart(2, "0")}
        </div>
        <button
          type="button"
          onClick={() => update(h - 1, m)}
          className="rounded-xl bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div className="text-3xl font-black text-slate-300 dark:text-slate-600 pb-1">:</div>

      {/* Dakika */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => update(h, m + 15)}
          className="rounded-xl bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="w-14 text-center text-3xl font-black text-slate-800 dark:text-white">
          {String(m).padStart(2, "0")}
        </div>
        <button
          type="button"
          onClick={() => update(h, m - 15)}
          className="rounded-xl bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface BookingModalProps {
  tutor: TutorSearchOut;
  onClose: () => void;
}

export function BookingModal({ tutor, onClose }: BookingModalProps) {
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  
  const canChooseMode = !tutor.teaching_mode || tutor.teaching_mode === TeachingMode.BOTH;
  const initialMode = canChooseMode ? TeachingMode.ONLINE : (tutor.teaching_mode || TeachingMode.ONLINE);
  const [mode, setMode] = useState<TeachingMode>(initialMode);
  
  const [addressTitle, setAddressTitle] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [doorNo, setDoorNo] = useState("");
  const [aptNo, setAptNo] = useState("");
  const [bookingLocation, setBookingLocation] = useState("");

  useEffect(() => {
    const parts = [];
    if (addressTitle) parts.push(`Başlık: ${addressTitle}`);
    if (addressLine) parts.push(addressLine);
    if (doorNo) parts.push(`No: ${doorNo}`);
    if (aptNo) parts.push(`Daire: ${aptNo}`);
    setBookingLocation(parts.join(", "));
  }, [addressTitle, addressLine, doorNo, aptNo]);
  
  // Seçilen buluşma konumu (rezervasyon payload'ına gider)
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  // Adres formu (ekle/düzenle) görünür mü + form'a verilecek başlangıç verisi
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [formInitial, setFormInitial] = useState<Partial<SavedAddress> | null>(null);

  // Kayıtlı adresler
  const { data: savedAddresses = [] } = useMyAddresses();
  const addAddress = useAddAddress();
  const updateAddress = useUpdateAddress();
  const deleteAddress = useDeleteAddress();
  // Buluşma için seçili kayıtlı adresin id'si
  const [selectedSavedId, setSelectedSavedId] = useState<number | null>(null);

  const createBooking = useCreateBooking();
  const todayStr = toDateStr(new Date());
  const nowHour = new Date().getHours();

  const startLocal =
    selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : "";

  const hasAvailability = (tutor.availability?.length ?? 0) > 0;
  
  const dayWindows = useMemo(() => {
    if (!selectedDate || !hasAvailability) return null;
    const wd = weekdayOfDateStr(selectedDate);
    return (tutor.availability ?? []).filter((a) => a.weekday === wd);
  }, [selectedDate, hasAvailability, tutor.availability]);

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

  useEffect(() => {
    if (selectedTime && isTimeDisabled(selectedTime)) setSelectedTime("");
  }, [selectedDate, duration, dayWindows]);

  // Form'dan gelen adresi kaydet/güncelle; başarılı olunca buluşma adresi olarak seç.
  const handleSaveAddress = (payload: SavedAddressCreate) => {
    const finalPayload: SavedAddressCreate = {
      ...payload,
      // İlk adres otomatik varsayılan olsun.
      is_default: payload.is_default || savedAddresses.length === 0,
    };

    if (selectedSavedId !== null) {
      updateAddress.mutate(
        { id: selectedSavedId, payload: finalPayload },
        {
          onSuccess: (updatedAddr) => {
            toast.success("Adres güncellendi.");
            handleSelectSaved(updatedAddr);
          },
          onError: (err) =>
            toast.error(getErrorMessage(err, "Adres güncellenemedi.")),
        }
      );
    } else {
      addAddress.mutate(finalPayload, {
        onSuccess: (newAddr) => {
          toast.success("Adres kaydedildi.");
          handleSelectSaved(newAddr);
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Adres kaydedilemedi.")),
      });
    }
  };

  const handleBooking = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      toast.error("Lütfen tarih ve saat seçin.");
      return;
    }
    const start = new Date(startLocal);
    const end = new Date(start.getTime() + duration * 60_000);
    const canChoose =
      !tutor.teaching_mode || tutor.teaching_mode === TeachingMode.BOTH;
    const lessonMode = canChoose ? mode : tutor.teaching_mode || TeachingMode.ONLINE;

    if (lessonMode === TeachingMode.IN_PERSON && !bookingLocation.trim()) {
      toast.error("Lütfen dersin yapılacağı yeri girin veya haritadan seçin.");
      return;
    }

    createBooking.mutate(
      {
        tutor_id: tutor.id,
        start_at: localInputToIso(startLocal),
        end_at: end.toISOString(),
        mode: lessonMode,
        location: lessonMode === TeachingMode.IN_PERSON ? bookingLocation.trim() : null,
        location_lat: lessonMode === TeachingMode.IN_PERSON ? locationLat : null,
        location_lng: lessonMode === TeachingMode.IN_PERSON ? locationLng : null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          // Adres kaydetme işlemi artık önceden yapılıyor.
          toast.success("Rezervasyon talebin gönderildi.");
          onClose();
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Rezervasyon oluşturulamadı.")),
      }
    );
  };

  const totalSteps = mode === TeachingMode.IN_PERSON ? 4 : 3;

  const handleNext = () => {
    if (step === 2) {
      if (!selectedDate || !selectedTime) {
        toast.error("Lütfen tarih ve saat seçin.");
        return;
      }
    }
    if (mode === TeachingMode.IN_PERSON && step === 3) {
      if (!bookingLocation.trim() && !locationLat) {
        toast.error("Lütfen buluşma yeri seçin.");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, totalSteps));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  // Kayıtlı adresi buluşma yeri olarak seç: alanları + konumu doldur, listeye dön.
  const handleSelectSaved = (a: SavedAddress) => {
    setAddressTitle(a.title || "");
    setAddressLine(a.address_line || "");
    setDoorNo(a.door_no || "");
    setAptNo(a.apt_no || "");
    setLocationLat(a.location_lat ?? null);
    setLocationLng(a.location_lng ?? null);
    setSelectedSavedId(a.id);
    setShowAddressForm(false);
  };

  // Yeni adres formunu boş aç.
  const handleOpenNew = () => {
    setFormInitial(null);
    setSelectedSavedId(null);
    setShowAddressForm(true);
  };

  // Mevcut adresi düzenleme formunda aç.
  const handleEditSaved = (a: SavedAddress) => {
    setFormInitial(a);
    setSelectedSavedId(a.id);
    setShowAddressForm(true);
  };

  const handleDeleteSaved = (id: number) => {
    deleteAddress.mutate(id, {
      onSuccess: () => {
        toast.success("Adres silindi.");
        if (selectedSavedId === id) {
          setSelectedSavedId(null);
          setAddressTitle("");
          setAddressLine("");
          setDoorNo("");
          setAptNo("");
          setLocationLat(null);
          setLocationLng(null);
        }
      },
      onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          {step > 1 ? (
            <button
              onClick={handleBack}
              className="rounded-full p-2 -ml-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="w-9" />
          )}
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Rezervasyon Talebi
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 -mr-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mb-6 flex gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => {
            const s = i + 1;
            return (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  step >= s ? "bg-indigo-600" : "bg-slate-100 dark:bg-slate-800"
                }`}
              />
            );
          })}
        </div>

        <form onSubmit={handleBooking} className="mt-2 space-y-6 overflow-x-hidden">
          {/* STEP 1: DERS MODU */}
          {step === 1 && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                  Ders Modu
                </h3>
              </div>

              {canChooseMode ? (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => setMode(TeachingMode.ONLINE)}
                    className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 p-5 transition-all ${
                      mode === TeachingMode.ONLINE
                        ? "border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "border-slate-100 bg-white text-slate-600 hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700"
                    }`}
                  >
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                    </svg>
                    <span className="font-semibold">Uzaktan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(TeachingMode.IN_PERSON)}
                    className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 p-5 transition-all ${
                      mode === TeachingMode.IN_PERSON
                        ? "border-indigo-600 bg-indigo-50/50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "border-slate-100 bg-white text-slate-600 hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700"
                    }`}
                  >
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
                    </svg>
                    <span className="font-semibold">Yüzyüze</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50 p-5 mt-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                  <p className="text-sm font-medium text-indigo-800 dark:text-indigo-300 text-center">
                    Bu eğitmen sadece <strong>{mode === TeachingMode.ONLINE ? "Uzaktan" : "Yüzyüze"}</strong> ders vermektedir.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="mt-8 w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700"
              >
                Devam Et
              </button>
            </div>
          )}

          {/* STEP 2: TARİH & SAAT */}
          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                  Tarih ve Saat
                </h3>
              </div>

              {hasAvailability && (
                <div className="rounded-xl bg-indigo-50 px-4 py-3 text-xs leading-relaxed text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <span className="font-semibold">Müsait saatler:</span>{" "}
                  {summarize(tutor.availability ?? [])
                    .map((s) => `${WEEKDAYS_SHORT[s.weekday]} ${s.ranges}`)
                    .join(" · ")}
                </div>
              )}

              {/* Tarih */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Tarih
                </p>
                <div className="-mx-1 px-1">
                  <ScrollableRow className="gap-3 pb-2 snap-x" showArrows={true}>
                    {NEXT_14_DAYS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setSelectedDate(d.value)}
                        className={`flex-shrink-0 snap-start flex flex-col items-center justify-center w-[72px] h-[84px] rounded-2xl border-2 transition-all ${
                          selectedDate === d.value
                            ? "border-indigo-600 bg-indigo-600 shadow-md dark:border-indigo-500 dark:bg-indigo-500"
                            : "border-slate-100 bg-white hover:border-indigo-200 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
                        }`}
                      >
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${selectedDate === d.value ? "text-indigo-200 dark:text-indigo-100" : "text-slate-400 dark:text-slate-500"}`}>
                          {d.month}
                        </span>
                        <span className={`text-xl font-black mt-0.5 mb-1 ${selectedDate === d.value ? "text-white" : "text-slate-700 dark:text-slate-200"}`}>
                          {d.dayNum}
                        </span>
                        <span className={`text-[11px] font-medium ${selectedDate === d.value ? "text-white" : "text-slate-500 dark:text-slate-400"}`}>
                          {d.label}
                        </span>
                      </button>
                    ))}
                  </ScrollableRow>
                </div>
              </div>

              {/* Saat */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Saat
                </p>
                <TimeStepper value={selectedTime} onChange={setSelectedTime} />
                
                {dayWindows !== null && dayWindows.length === 0 && selectedDate ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-100 dark:border-amber-500/20">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Eğitmen bu gün müsait değil — lütfen üstten başka bir tarih seçin.
                  </div>
                ) : selectedTime && isTimeDisabled(selectedTime) ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Eğitmen bu saatte müsait değil.
                  </div>
                ) : null}
              </div>

              {/* Süre */}
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

              <button
                type="button"
                onClick={handleNext}
                disabled={!selectedDate || !selectedTime || isTimeDisabled(selectedTime)}
                className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Devam Et
              </button>
            </div>
          )}

          {/* STEP 3: LOKASYON (SADECE YÜZYÜZE İSE) */}
          {step === 3 && mode === TeachingMode.IN_PERSON && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                  Buluşma Yeri
                </h3>
              </div>

              {showAddressForm ? (
                /* ── Adres ekle / düzenle (ortak AddressForm) ── */
                <div className="space-y-3">
                  {savedAddresses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAddressForm(false)}
                      className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Kayıtlı adreslerime dön
                    </button>
                  )}
                  <AddressForm
                    initial={formInitial}
                    pending={addAddress.isPending || updateAddress.isPending}
                    submitLabel={selectedSavedId !== null ? "Adresi Güncelle" : "Adresi Kaydet"}
                    requireLocation
                    onSubmit={handleSaveAddress}
                    onCancel={() => setShowAddressForm(false)}
                  />
                </div>
              ) : savedAddresses.length > 0 ? (
                /* ── Kayıtlı adres seçimi (ortak SavedAddressCard) ── */
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Kayıtlı Adreslerim
                  </p>
                  {savedAddresses.map((a) => (
                    <SavedAddressCard
                      key={a.id}
                      addr={a}
                      selected={selectedSavedId === a.id}
                      onSelect={() => handleSelectSaved(a)}
                      onEdit={() => handleEditSaved(a)}
                      onDelete={() => handleDeleteSaved(a.id)}
                      deleting={deleteAddress.isPending && deleteAddress.variables === a.id}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={handleOpenNew}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-300 py-2.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Yeni adres ekle
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!bookingLocation.trim() && !locationLat}
                    className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Devam Et
                  </button>
                </div>
              ) : (
                /* ── Hiç kayıtlı adres yok: ekleme daveti ── */
                <div className="flex flex-col items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-8 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                  <div className="mb-4 rounded-full bg-indigo-100 p-4 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
                    </svg>
                  </div>
                  <p className="mb-4 text-center text-sm font-medium text-indigo-900 dark:text-indigo-200">
                    Dersin yapılacağı adresi ekleyin; sonraki rezervasyonlarda tek tıkla seçebilirsiniz.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenNew}
                    className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-700"
                  >
                    Adres Ekle
                  </button>
                </div>
              )}

            </div>
          )}

          {/* SON ADIM: NOTLAR & ONAY */}
          {step === totalSteps && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                  Son Detaylar
                </h3>
              </div>

              {/* Ek Not */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Eğitmene Mesaj (Opsiyonel)
                </label>
                <textarea
                  rows={6}
                  maxLength={1000}
                  placeholder="Kendinizi kısaca tanıtın, ders beklentilerinizi veya hedeflerinizi yazın..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                />
              </div>

              <button
                type="submit"
                disabled={createBooking.isPending || (mode === TeachingMode.IN_PERSON && !bookingLocation.trim() && !locationLat)}
                className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createBooking.isPending ? "Gönderiliyor…" : "Rezervasyon Talep Et"}
              </button>
            </div>
          )}
        </form>

      </div>
    </div>
  );
}
