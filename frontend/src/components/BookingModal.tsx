import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { isSlotConflictError, useCreateBooking } from "@/hooks/useBookings";
import { useTutorSlots } from "@/hooks/useTutorSlots";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { canPromiseEscrow } from "@/lib/paymentAvailability";
import { toast } from "@/store/toastStore";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import { formatIstanbulDay, formatIstanbulTime, istanbulNow } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { googleTakvimLinki, icsIcerigi, icsIndir } from "@/lib/takvim";
import { TeachingMode } from "@/types";
import type { BookingOut, PartOfDay, SavedAddress, SlotOut, TutorSearchOut } from "@/types";
import { DateStrip, buildDaysFromDates } from "@/components/booking/DateStrip";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { SavedAddressCard } from "@/components/address/SavedAddressCard";
import { AddressForm } from "@/components/address/AddressForm";
import {
  useMyAddresses,
  useAddAddress,
  useUpdateAddress,
  useDeleteAddress,
} from "@/hooks/useAddresses";
import type { SavedAddressCreate } from "@/types";

const DURATIONS = [{ label: "45 dk", value: 45 }, { label: "1 saat", value: 60 }, { label: "1.5 saat", value: 90 }, { label: "2 saat", value: 120 }];

/** Gün bölümleri saat sırasıyla; Gece yalnız slotu varsa görünür. */
const GUN_BOLUMLERI: { key: PartOfDay; label: string }[] = [
  { key: "night", label: "Gece" },
  { key: "morning", label: "Sabah" },
  { key: "afternoon", label: "Öğleden sonra" },
  { key: "evening", label: "Akşam" },
];

// Slot düğmeleri: satır içi ikincil düğme; seçili marka çerçeveli, dolu soluk ve çizili.
const SLOT_DUGME = `${DUGME_SATIR_IKINCIL.replace("disabled:opacity-60", "disabled:opacity-40")} w-full`;
const SLOT_SECILI = `${DUGME_SATIR_IKINCIL.replace("border-slate-200", "border-marka")
  .replace("bg-white", "bg-marka-soft")
  .replace("hover:border-slate-900", "")} w-full`;
const SLOT_DOLU = `${SLOT_DUGME} opacity-40 line-through`;

/** "YYYY-MM-DD" + n gün (UTC aritmetiği; tarayıcı saat diliminden bağımsız). */
function gunEkle(gun: string, n: number): string {
  return new Date(Date.parse(`${gun}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function gunFarki(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function saatAraligi(startIso: string, endIso: string): string {
  return `${formatIstanbulTime(startIso)}–${formatIstanbulTime(endIso)}`;
}

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
          ? "bg-marka text-marka-fg shadow-sm"
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
  
  /**
   * Profildeki Program takviminden seçilen saat. `date` sunucunun İstanbul
   * günüdür (UTC ISO'dan türetilmez: 03:00 öncesi başlangıç önceki UTC gününe
   * düşer). Slot, taze veride `start_at` ile yeniden eşlenir; `end_at` hep
   * sunucudan gelir. Artık boş değilse normal seçime düşülür.
   */
  initialSlot?: { date: string; start_at: string; duration: number };
}

export function BookingModal({
  tutor,
  onClose,
  initialDate,
  
  initialSlot,
}: BookingModalProps) {
  const baslangicGunu = initialSlot?.date ?? initialDate;
  const [step, setStep] = useState(1);
  // Günler İstanbul tarihiyle; hafta 0 = bugünden, 1 = 7 gün sonrasından (en fazla 14 gün).
  const bugun = istanbulNow().dateStr;
  const [hafta, setHafta] = useState(() => {
    const fark = baslangicGunu ? gunFarki(baslangicGunu, bugun) : 0;
    return fark >= 7 && fark < 14 ? 1 : 0;
  });
  // Önseçili tarih, sunucunun döndüğü günlerde varsa kullanılır (aşağıdaki effect).
  const [selectedDate, setSelectedDate] = useState(baslangicGunu ?? "");
  const [selectedSlot, setSelectedSlot] = useState<SlotOut | null>(null);
  const [slotDoldu, setSlotDoldu] = useState(false);
  const [duration, setDuration] = useState(initialSlot?.duration ?? 60);
  // Profilden gelen saat bir kez eşlenir; sonra kullanıcı serbestçe değiştirir.
  const [onSecimBekliyor, setOnSecimBekliyor] = useState(!!initialSlot);
  const [onSecimKayip, setOnSecimKayip] = useState(false);
  const [basari, setBasari] = useState<BookingOut | null>(null);
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

  // Boş/dolu saatler, kurallar ve ücret sunucuda hesaplanır.
  const from = gunEkle(bugun, 7 * hafta);
  const slotlar = useTutorSlots(tutor.id, from, duration);
  const slotVerisi = slotlar.data;
  const gunler = slotVerisi?.days;
  const sonrakiHaftaVar =
    !!slotVerisi &&
    hafta < 1 &&
    Date.parse(`${gunEkle(bugun, 7 * (hafta + 1))}T00:00:00+03:00`) < Date.parse(slotVerisi.window_end);
  const haftadaBosVar = (gunler ?? []).some((g) => g.has_available);
  const seciliGun = gunler?.find((g) => g.date === selectedDate);

  // Bayat önbellekle eşlenmez: arka planda tazeleniyorsa taze yanıt beklenir.
  useEffect(() => {
    if (!onSecimBekliyor || !initialSlot || !gunler || slotlar.isFetching) return;
    const eslesen = gunler
      .find((g) => g.date === initialSlot.date)
      ?.slots.find((sl) => sl.start_at === initialSlot.start_at && sl.status === "available");
    if (eslesen) setSelectedSlot(eslesen);
    else setOnSecimKayip(true);
    setOnSecimBekliyor(false);
  }, [onSecimBekliyor, initialSlot, gunler, slotlar.isFetching]);

  // Seçili saat tazelenen veride artık boş değilse seçim düşer ("Devam Et" dolu saatle geçmesin).
  useEffect(() => {
    if (!selectedSlot || !gunler) return;
    const hala = gunler.some((g) =>
      g.slots.some((sl) => sl.start_at === selectedSlot.start_at && sl.status === "available"),
    );
    if (hala) return;
    setSelectedSlot(null);
    const onSecimden =
      !!initialSlot && initialSlot.start_at === selectedSlot.start_at && initialSlot.duration === duration;
    if (onSecimden) setOnSecimKayip(true);
    else setSlotDoldu(true);
  }, [gunler, selectedSlot, initialSlot, duration]);

  // Varsayılan gün: listede yoksa ilk boş slotu olan gün, o da yoksa ilk gün.
  useEffect(() => {
    if (!gunler || gunler.some((g) => g.date === selectedDate)) return;
    const ilk = gunler.find((g) => g.has_available) ?? gunler[0];
    setSelectedDate(ilk?.date ?? "");
  }, [gunler, selectedDate]);

  const gunSec = (gun: string) => {
    setSelectedDate(gun);
    setSelectedSlot(null);
  };
  const haftaDegistir = (yeni: number) => {
    setHafta(yeni);
    setSelectedDate("");
    setSelectedSlot(null);
  };
  const sureDegistir = (yeni: number) => {
    setDuration(yeni);
    setSelectedSlot(null);
  };

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
    if (!selectedSlot) {
      toast.error("Lütfen tarih ve saat seçin.");
      return;
    }
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
        // Slot uçları sunucudan UTC gelir; istemci saat hesaplamaz.
        start_at: selectedSlot.start_at,
        end_at: selectedSlot.end_at,
        mode: lessonMode,
        location: lessonMode === TeachingMode.IN_PERSON ? bookingLocation.trim() : null,
        location_lat: lessonMode === TeachingMode.IN_PERSON ? locationLat : null,
        location_lng: lessonMode === TeachingMode.IN_PERSON ? locationLng : null,
        notes: notes.trim() || null,
        is_trial: isTrial || false,
      },
      {
        onSuccess: (booking) => setBasari(booking),
        onError: (err) => {
          if (isSlotConflictError(err)) {
            // Slotlar hook'ta yeniden istenir; öğrenci saat adımına döner.
            setSelectedSlot(null);
            setSlotDoldu(true);
            setStep(2);
            toast.error("Bu saat az önce doldu. Başka bir saat seç.");
            return;
          }
          const durum = (err as { response?: { status?: number } })?.response?.status;
          // 409 (ör. ücretsiz ders hakkı) ve 422 kuralları sunucu metniyle gösterilir.
          toast.error(
            durum === 409 || durum === 422
              ? getErrorDetail(err, "Ders talebi oluşturulamadı.")
              : getErrorMessage(err, "Ders talebi oluşturulamadı.")
          );
        },
      }
    );
  };

  const totalSteps = mode === TeachingMode.IN_PERSON ? 4 : 3;

  const handleNext = () => {
    if (step === 2) {
      if (!selectedSlot) {
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
          {step > 1 && !basari ? (
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

        {basari ? (
          <BasariEkrani booking={basari} tutor={tutor} onClose={onClose} />
        ) : (
        <>
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
                {/* Profildeki Program'dan gelindiyse seçim kaybolmuş gibi görünmesin. */}
                {initialSlot && selectedSlot && (
                  <p className={`-mt-3 ${KUCUK_ACIKLAMA}`}>
                    Seçtiğin saat: {formatIstanbulDay(selectedSlot.start_at)},{" "}
                    {formatIstanbulTime(selectedSlot.start_at)} ·{" "}
                    {DURATIONS.find((d) => d.value === duration)?.label}
                  </p>
                )}
              </div>

              {canChooseMode ? (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => setMode(TeachingMode.ONLINE)}
                    className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 p-5 transition-all ${
                      mode === TeachingMode.ONLINE
                        ? "border-marka bg-marka-soft/50 text-marka-metin-hover "
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-200 "
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
                        ? "border-marka bg-marka-soft/50 text-marka-metin-hover "
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-200 "
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
                    Bu öğretmen sadece <strong>{mode === TeachingMode.ONLINE ? "Uzaktan" : "Yüzyüze"}</strong> ders vermektedir.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="mt-8 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-marka-fg transition hover:bg-marka-hover"
              >
                Devam Et
              </button>
            </div>
          )}

          {/* STEP 2: TARİH & SAAT — sunucu slot ızgarası */}
          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-5">
                  Tarih ve Saat
                </h3>
              </div>

              {slotlar.isLoading ? (
                <p className={KUCUK_ACIKLAMA}>Saatler yükleniyor…</p>
              ) : slotlar.isError || !slotVerisi ? (
                <div className="space-y-3">
                  <p role="alert" className={ACIKLAMA}>Saatler yüklenemedi.</p>
                  <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => slotlar.refetch()}>
                    Tekrar dene
                  </button>
                </div>
              ) : !slotVerisi.has_availability ? (
                <div className={`${KART} space-y-3`}>
                  <p className={ETIKET}>Öğretmen henüz ders saati açmadı</p>
                  <p className={ACIKLAMA}>Uygun olduğu zamanı mesajla sorabilirsin.</p>
                  <Link
                    to={ROUTES.messageWith(tutor.id, tutor.display_name, "TUTOR")}
                    className={DUGME_SATIR_IKINCIL}
                    onClick={onClose}
                  >
                    Mesaj gönder
                  </Link>
                </div>
              ) : (
                <>
                  {/* Süre — değişince seçili saat sıfırlanır */}
                  
                  {isTrial ? (
                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-blue-900">25 dk Deneme Dersi — 49,90 TL</span>
                      </div>
                      <p className="text-sm text-blue-800">
                        Eğitmenin anlatım tarzını tanı, hedeflerini konuş ve kısa bir örnek ders yap. Sana uygun değilse başka bir eğitmenle ücretsiz tekrar deneyebilirsin.
                      </p>
                    </div>
                  ) : (
                    <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                      Süre
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {DURATIONS.map((d) => (
                        <Pill
                          key={d.value}
                          active={duration === d.value}
                          onClick={() => sureDegistir(d.value)}
                        >
                          {d.label}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  )}


                  {/* Tarih */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                        Tarih
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={DUGME_SATIR_IKINCIL}
                          onClick={() => haftaDegistir(hafta - 1)}
                          disabled={hafta === 0}
                          aria-label="Önceki hafta"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={DUGME_SATIR_IKINCIL}
                          onClick={() => haftaDegistir(hafta + 1)}
                          disabled={!sonrakiHaftaVar}
                          aria-label="Sonraki hafta"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <DateStrip
                      value={selectedDate}
                      onChange={gunSec}
                      days={buildDaysFromDates(slotVerisi.days.map((g) => g.date), bugun)}
                      hasAvailable={Object.fromEntries(
                        slotVerisi.days.map((g) => [g.date, g.has_available])
                      )}
                    />
                  </div>

                  {/* Saat */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                      Saat
                    </p>
                    {onSecimKayip && !selectedSlot && (
                      <p role="status" className={`mb-3 ${KUCUK_ACIKLAMA}`}>
                        Profilde seçtiğin saat artık boş değil. Başka bir saat seç.
                      </p>
                    )}
                    {slotDoldu && (
                      <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        Bu saat az önce doldu. Başka bir saat seç.
                      </p>
                    )}
                    {!haftadaBosVar ? (
                      <div className="space-y-3">
                        <p className={ACIKLAMA}>Bu hafta {duration} dakikalık boş saat yok</p>
                        {sonrakiHaftaVar && (
                          <button
                            type="button"
                            className={DUGME_SATIR_IKINCIL}
                            onClick={() => haftaDegistir(hafta + 1)}
                          >
                            Sonraki haftaya bak
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {GUN_BOLUMLERI.map((bolum) => {
                          const liste = (seciliGun?.slots ?? []).filter(
                            (sl) => sl.part_of_day === bolum.key
                          );
                          if (bolum.key === "night" && liste.length === 0) return null;
                          return (
                            <div key={bolum.key}>
                              <p className={`mb-2 ${ETIKET}`}>{bolum.label}</p>
                              {liste.length === 0 ? (
                                <p className={KUCUK_ACIKLAMA}>Boş saat yok</p>
                              ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {liste.map((sl) => {
                                    const saat = formatIstanbulTime(sl.start_at);
                                    const dolu = sl.status === "busy";
                                    const secili = selectedSlot?.start_at === sl.start_at;
                                    return (
                                      <button
                                        key={sl.start_at}
                                        type="button"
                                        disabled={dolu}
                                        aria-pressed={dolu ? undefined : secili}
                                        aria-label={dolu ? `${saat} Dolu` : undefined}
                                        className={dolu ? SLOT_DOLU : secili ? SLOT_SECILI : SLOT_DUGME}
                                        onClick={() => {
                                          setSelectedSlot(sl);
                                          setSlotDoldu(false);
                                        }}
                                      >
                                        {saat}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className={`mt-3 ${KUCUK_ACIKLAMA}`}>Saatler Türkiye saatiyle.</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!selectedSlot}
                    className="mt-6 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-marka-fg transition hover:bg-marka-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Devam Et
                  </button>
                </>
              )}
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
                      className="flex items-center gap-1 text-xs font-semibold text-marka-metin hover:text-marka-metin-hover "
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-marka-mid py-2.5 text-xs font-semibold text-marka-soft-fg transition hover:bg-marka-soft "
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
                    className="mt-3 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-marka-fg transition hover:bg-marka-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Devam Et
                  </button>
                </div>
              ) : (
                /* ── Hiç kayıtlı adres yok: ekleme daveti ── */
                <div className="flex flex-col items-center justify-center rounded-xl border border-marka-line bg-marka-soft/50 px-4 py-8 ">
                  <div className="mb-4 rounded-full bg-marka-line p-4 text-marka-soft-fg ">
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
                    className="flex items-center justify-center gap-2 rounded-xl bg-marka px-6 py-3 text-sm font-bold text-marka-fg transition hover:bg-marka-hover"
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

              {selectedSlot && (
                <OzetKarti
                  slot={selectedSlot}
                  mode={mode}
                  ucretsiz={false}
                  ucret={isTrial ? 49.9 : (slotVerisi?.price.amount ?? null)}
                  gecIptalSaati={slotVerisi?.policy.late_cancel_hours ?? 12}
                />
              )}

              {/* Ücretsiz ilk ders */}
              {canRequestFreeLesson && (
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 ">
                  <input
                    type="checkbox"
                    checked={freeLesson}
                    onChange={(e) => setFreeLesson(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 accent-marka"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-emerald-800 ">
                      İlk dersim ücretsiz olsun
                    </span>
                    <span className="mt-0.5 block text-xs text-emerald-700/80 ">
                      Bu öğretmenle ilk dersin ücretsiz. İşaretlersen ödeme alınmaz.
                    </span>
                  </span>
                </label>
              )}

              {/* Ek Not */}
              <Field label="Öğretmene Mesaj (Opsiyonel)" labelClassName="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
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
                className="mt-6 w-full rounded-xl bg-marka px-4 py-3.5 text-center text-sm font-bold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-60"
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
        </>
        )}
    </Modal>
  );
}

const MOD_ETIKETI: Record<string, string> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüzyüze",
};

/** Son adım özeti: tarih, saat, mod, ücret, ödeme zamanı ve iptal kuralı. */
function OzetKarti({
  slot,
  mode,
  ucretsiz,
  ucret,
  gecIptalSaati,
}: {
  slot: SlotOut;
  mode: TeachingMode;
  ucretsiz: boolean;
  ucret: string | null;
  gecIptalSaati: number;
}) {
  // Kapalı kolda emanet vaadi verilmez (lib/paymentAvailability): o dönemde
  // ders "takvim randevusu"dur, ücret eğitmene doğrudan ödenir.
  const { data: availability } = usePaymentAvailability();
  const emanetli = canPromiseEscrow(availability, "tutor_marketplace");
  const iptalSonu = new Date(
    Date.parse(slot.start_at) - gecIptalSaati * 60 * 60 * 1000
  ).toISOString();
  return (
    <div className={`${KART} space-y-3`}>
      <div>
        <p className={ETIKET}>{formatIstanbulDay(slot.start_at)}</p>
        <p className={ACIKLAMA}>
          {saatAraligi(slot.start_at, slot.end_at)} · {MOD_ETIKETI[mode] ?? mode}
        </p>
      </div>
      {ucretsiz ? (
        <p className={ETIKET}>İlk ders ücretsiz</p>
      ) : (
        <>
          {ucret !== null && <p className={ETIKET}>{formatTRY(ucret)}</p>}
          <p className={KUCUK_ACIKLAMA}>
            {emanetli
              ? "Şimdi ödeme alınmaz. Öğretmen kabul edince ödersin; para ders onaylanana kadar bekletilir."
              : "Şimdi ödeme alınmaz. Öğretmen kabul edince ders takvimine eklenir; ücreti öğretmenine doğrudan ödersin."}
          </p>
        </>
      )}
      <p className={KUCUK_ACIKLAMA}>
        Öğretmen kabul etmeden önce istediğin zaman, kabul ettikten sonra{" "}
        {formatIstanbulDay(iptalSonu)} {formatIstanbulTime(iptalSonu)} tarihine kadar ücretsiz
        iptal.
      </p>
    </div>
  );
}

/** Talep gönderildikten sonra modal içinde kalan başarı ekranı. */
function BasariEkrani({
  booking,
  tutor,
  onClose,
}: {
  booking: BookingOut;
  tutor: TutorSearchOut;
  onClose: () => void;
  isTrial?: boolean;
}) {
  const baslik = `${tutor.display_name} ile ders`;
  const detay = `Ders talebi: ${window.location.origin}${ROUTES.lesson(booking.id)}`;
  return (
    <div className="space-y-5">
      <div>
        <h3 className={BOLUM_BASLIGI}>Ders talebin öğretmene iletildi</h3>
        <p className={`mt-2 ${ACIKLAMA}`}>
          {formatIstanbulDay(booking.start_at)}, {saatAraligi(booking.start_at, booking.end_at)}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <a
          href={googleTakvimLinki(booking, baslik, detay)}
          target="_blank"
          rel="noopener noreferrer"
          className={DUGME_SATIR_IKINCIL}
        >
          Google Takvim&apos;e ekle
        </a>
        <button
          type="button"
          className={DUGME_SATIR_IKINCIL}
          onClick={() => icsIndir(icsIcerigi(booking, baslik, detay), `ders-${booking.id}.ics`)}
        >
          Takvim dosyası indir (.ics)
        </button>
        <Link
          to={ROUTES.messageWith(tutor.id, tutor.display_name, "TUTOR")}
          className={DUGME_SATIR_IKINCIL}
          onClick={onClose}
        >
          Öğretmene mesaj gönder
        </Link>
        <Link to={ROUTES.lesson(booking.id)} className={DUGME_SATIR_BIRINCIL} onClick={onClose}>
          Ders talebimi gör
        </Link>
      </div>
    </div>
  );
}
