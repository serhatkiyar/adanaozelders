import { FormEvent, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useCreateBooking } from "@/hooks/useBookings";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import { istanbulInputToIso, istanbulNow } from "@/lib/datetime";
import {
  WEEKDAYS_SHORT,
  hhmmToMin,
  summarize,
  weekdayOfDateStr,
} from "@/lib/availability";
import { TeachingMode } from "@/types";
import type { SavedAddress, TutorSearchOut } from "@/types";
import { TimeStepper } from "@/components/booking/TimeStepper";
import { DateStrip, buildUpcomingDays } from "@/components/booking/DateStrip";
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

const NEXT_14_DAYS = buildUpcomingDays();

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
          ? "bg-marka text-white shadow-sm"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
      }`}
    >
      {children}
    </button>
  );
}

interface BookingModalProps {
  tutor: TutorSearchOut;
  onClose: () => void;
  /** Takvimden açıldıysa önseçili tarih ("YYYY-MM-DD"); listedeyse vurgulanır. */
  initialDate?: string;
  /** Öğrenci bu eğitmenden ücretsiz ilk ders alabilir mi (sunmuyor/kullanılmışsa false). */
  canRequestFreeLesson?: boolean;
}

export function BookingModal({
  tutor,
  onClose,
  initialDate,
  canRequestFreeLesson = false,
}: BookingModalProps) {
  const [step, setStep] = useState(1);
  // Önseçili tarih yalnızca 14 günlük listede yer alıyorsa seedle (geçmiş/uzak değilse).
  const [selectedDate, setSelectedDate] = useState(
    initialDate && NEXT_14_DAYS.some((d) => d.value === initialDate)
      ? initialDate
      : ""
  );
  const [selectedTime, setSelectedTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [freeLesson, setFreeLesson] = useState(false);
  
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
  // Geçmiş kontrolleri Türkiye saatiyle (backend de UTC+3) — tarayıcı tz'inden bağımsız.
  const { dateStr: todayStr, hour: nowHour } = istanbulNow();

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
    // Seçilen saat Türkiye duvar-saati kabul edilir (+03:00); start ve end aynı
    // UTC anından türetilir, böylece tarayıcı tz'inden bağımsız ve tutarlıdır.
    const startIso = istanbulInputToIso(startLocal);
    const endIso = new Date(
      new Date(startIso).getTime() + duration * 60_000
    ).toISOString();
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
        start_at: startIso,
        end_at: endIso,
        mode: lessonMode,
        location: lessonMode === TeachingMode.IN_PERSON ? bookingLocation.trim() : null,
        location_lat: lessonMode === TeachingMode.IN_PERSON ? locationLat : null,
        location_lng: lessonMode === TeachingMode.IN_PERSON ? locationLng : null,
        notes: notes.trim() || null,
        free_lesson: canRequestFreeLesson && freeLesson,
      },
      {
        onSuccess: () => {
          // Adres kaydetme işlemi artık önceden yapılıyor.
          toast.success("Ders talebin gönderildi.");
          onClose();
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Ders talebi oluşturulamadı.")),
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
    <Modal
      open
      onClose={onClose}
      ariaLabel="Ders talebi"
      hideCloseButton
      panelClassName="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
    >
        <div className="flex items-center justify-between mb-4">
          {step > 1 ? (
            <button
              onClick={handleBack}
              className="rounded-full p-2 -ml-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="w-9" />
          )}
          <h2 className="text-xl font-bold text-slate-900 ">
            Ders Talebi
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 -mr-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
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
                  step >= s ? "bg-marka" : "bg-slate-100 "
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
                <h3 className="text-lg font-semibold text-slate-900 mb-5">
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
                        ? "border-marka bg-marka-soft/50 text-marka-hover "
                        : "border-slate-100 bg-white text-slate-600 hover:border-slate-200 "
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
                        ? "border-marka bg-marka-soft/50 text-marka-hover "
                        : "border-slate-100 bg-white text-slate-600 hover:border-slate-200 "
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
                <div className="rounded-2xl border-2 border-marka-line bg-marka-soft p-5 mt-4 ">
                  <p className="text-sm font-medium text-marka-soft-fg text-center">
                    Bu eğitmen sadece <strong>{mode === TeachingMode.ONLINE ? "Uzaktan" : "Yüzyüze"}</strong> ders vermektedir.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="mt-8 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-marka-hover"
              >
                Devam Et
              </button>
            </div>
          )}

          {/* STEP 2: TARİH & SAAT */}
          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-5">
                  Tarih ve Saat
                </h3>
              </div>

              {hasAvailability && (
                <div className="rounded-xl bg-marka-soft px-4 py-3 text-xs leading-relaxed text-marka-hover ">
                  <span className="font-semibold">Müsait saatler:</span>{" "}
                  {summarize(tutor.availability ?? [])
                    .map((s) => `${WEEKDAYS_SHORT[s.weekday]} ${s.ranges}`)
                    .join(" · ")}
                </div>
              )}

              {/* Tarih */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                  Tarih
                </p>
                <DateStrip value={selectedDate} onChange={setSelectedDate} days={NEXT_14_DAYS} />
              </div>

              {/* Saat */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                  Saat
                </p>
                <TimeStepper value={selectedTime} onChange={setSelectedTime} />
                
                {dayWindows !== null && dayWindows.length === 0 && selectedDate ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-700 border border-amber-100 ">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Eğitmen bu gün müsait değil, lütfen üstten başka bir tarih seçin.
                  </div>
                ) : selectedTime && isTimeDisabled(selectedTime) ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 border border-red-100 ">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Eğitmen bu saatte müsait değil.
                  </div>
                ) : null}
              </div>

              {/* Süre */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
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
                className="mt-6 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-marka-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Devam Et
              </button>
            </div>
          )}

          {/* STEP 3: LOKASYON (SADECE YÜZYÜZE İSE) */}
          {step === 3 && mode === TeachingMode.IN_PERSON && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-5">
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
                      className="flex items-center gap-1 text-xs font-semibold text-marka hover:text-marka-hover "
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-marka-mid py-2.5 text-xs font-semibold text-marka transition hover:bg-marka-soft "
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
                    className="mt-3 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-marka-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Devam Et
                  </button>
                </div>
              ) : (
                /* ── Hiç kayıtlı adres yok: ekleme daveti ── */
                <div className="flex flex-col items-center justify-center rounded-xl border border-marka-line bg-marka-soft/50 px-4 py-8 ">
                  <div className="mb-4 rounded-full bg-marka-line p-4 text-marka ">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
                    </svg>
                  </div>
                  <p className="mb-4 text-center text-sm font-medium text-marka-soft-fg ">
                    Dersin yapılacağı adresi ekleyin; sonraki rezervasyonlarda tek tıkla seçebilirsiniz.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenNew}
                    className="flex items-center justify-center gap-2 rounded-xl bg-marka px-6 py-3 text-sm font-bold text-white transition hover:bg-marka-hover"
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
                <h3 className="text-lg font-semibold text-slate-900 mb-5">
                  Son Detaylar
                </h3>
              </div>

              {/* Ücretsiz ilk ders */}
              {canRequestFreeLesson && (
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 ">
                  <input
                    type="checkbox"
                    checked={freeLesson}
                    onChange={(e) => setFreeLesson(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-emerald-800 ">
                      İlk dersim ücretsiz olsun
                    </span>
                    <span className="mt-0.5 block text-xs text-emerald-700/80 ">
                      Bu eğitmenle ilk dersin ücretsiz. İşaretlersen ödeme alınmaz.
                    </span>
                  </span>
                </label>
              )}

              {/* Ek Not */}
              <Field label="Eğitmene Mesaj (Opsiyonel)" labelClassName="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                {(id) => (
                    <textarea
                    id={id}
                      rows={8}
                      maxLength={1000}
                      placeholder="Kendinizi kısaca tanıtın, ders beklentilerinizi veya hedeflerinizi yazın..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                    />
                )}
              </Field>

              <button
                type="submit"
                disabled={createBooking.isPending || (mode === TeachingMode.IN_PERSON && !bookingLocation.trim() && !locationLat)}
                className="mt-6 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-white transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createBooking.isPending
                  ? "Gönderiliyor…"
                  : canRequestFreeLesson && freeLesson
                    ? "Ücretsiz Ders Talep Et"
                    : "Ders Talep Et"}
              </button>
            </div>
          )}
        </form>
    </Modal>
  );
}
