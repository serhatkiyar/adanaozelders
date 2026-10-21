import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/AppIcon";
import { SegmentedControl } from "@/components/SegmentedControl";
import { DUGME_SATIR_IKINCIL, KUCUK_ACIKLAMA, METIN_BAGLANTI } from "@/components/pano/stil";
import { useTutorSlots } from "@/hooks/useTutorSlots";
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, weekdayOfDateStr } from "@/lib/availability";
import { formatIstanbulTime, istanbulNow } from "@/lib/datetime";
import type { SlotDayOut, SlotOut } from "@/types";

/*
 * Profildeki "Program" — Preply öğretmen profilindeki haftalık saat ızgarası
 * (28 Eyl 2026 incelemesi) bizim kurallarımıza uyarlanmış hâli:
 *
 * - Veri `GET /tutors/{id}/slots`; boş/dolu, 24 saat ön bildirim, 14 günlük
 *   pencere ve izinler SUNUCUDA hesaplanır. Istemci saat üretmez.
 * - Hafta bugünden başlar ve ders penceresiyle AYNI sayfalanır (`from = bugün
 *   + 7·hafta`): rezervasyon penceresi aynı sorgu anahtarını kullanır, açılınca
 *   önbellekten gelir.
 * - Süreler sunucunun listesinden (30 dk / 1 saat); Preply'ın 25/50'si ücret
 *   kuralını değiştireceği için alınmadı.
 * - Saatler Türkiye saatiyle (üründe saat dilimi alanı yok).
 * - Saatler gerçek `<button>`: klavyeyle ulaşılır, tam tarihli ad taşır
 *   (Preply'da tabIndex=-1 div).
 */

export interface ProgramSaati {
  /** Sunucunun İstanbul günü ("YYYY-MM-DD"). */
  date: string;
  start_at: string;
  duration: number;
}



// Kare 44px ok düğmesi: taban sınıfın px-4/h-10'u ek sınıfla ezilemiyor
// (CSS sırası), bu yüzden değerler yerinde değiştirilir.
// Yükleme sırasında `disabled` yerine `aria-disabled` (odak düğmede kalır);
// görünüm `disabled:` ile aynı olsun diye `aria-disabled:` eşlenir.
const OK_DUGMESI = `${DUGME_SATIR_IKINCIL.replace("h-10", "h-11").replace("px-4", "px-0")} w-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

/** Kapalıyken sütun başına gösterilen saat sayısı. */
export const KAPALI_SATIR = 8;

function gunEkle(gun: string, n: number): string {
  return new Date(Date.parse(`${gun}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const kisaTarih = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const uzunTarih = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "UTC" });
const gunTarihi = (d: string) => new Date(`${d}T12:00:00Z`);

/** "28 Eyl – 4 Eki 2026" (aynı aydaysa "5–11 Eki 2026"). */
export function haftaEtiketi(ilk: string, son: string): string {
  const yil = son.slice(0, 4);
  if (ilk.slice(0, 7) === son.slice(0, 7)) {
    return `${Number(ilk.slice(8))}–${kisaTarih.format(gunTarihi(son))} ${yil}`;
  }
  return `${kisaTarih.format(gunTarihi(ilk))} – ${kisaTarih.format(gunTarihi(son))} ${yil}`;
}

/** Sütunlar: yalnız BOŞ saatler (dolu/ön bildirim içindekiler gösterilmez). */
export function programSutunlari(gunler: SlotDayOut[]) {
  return gunler.map((g) => ({
    date: g.date,
    gun: weekdayOfDateStr(g.date),
    saatler: g.slots.filter((s) => s.status === "available"),
  }));
}

const DEFAULT_DURATIONS = [60];

export function ProgramTakvimi({
  tutorId,
  onSaatSec,
  kendiProfili = false,
  isTrial = false,
  offeredDurations = DEFAULT_DURATIONS,
}: {
  tutorId: number;
  /** Yoksa saatler salt okunur (öğretmen kendi profiline ya da üye olmayan hesap bakıyor). */
  onSaatSec?: (saat: ProgramSaati) => void;
  /** Salt okunur kipte açıklama metnini seçer: eğitmen kendi profiline mi bakıyor. */
  kendiProfili?: boolean;
  isTrial?: boolean;
  offeredDurations?: number[];
}) {
  const bugun = istanbulNow().dateStr;
  const [hafta, setHafta] = useState(0);
  
  // Deneme dersiyse 25 dakika zorunlu, değilse eğitmenin sunduğu ilk süre (varsayılan 60).
  const [sure, setSure] = useState<string>(
    isTrial ? "25" : (offeredDurations.includes(60) ? "60" : String(offeredDurations[0] || 60))
  );

  const [acik, setAcik] = useState(false);
  // Telefonda önce gün seçilir (BookingModal "Tarih ve Saat" deseni).
  const [mobilGun, setMobilGun] = useState("");
  const baslikRef = useRef<HTMLHeadingElement>(null);
  const oncekiRef = useRef<HTMLButtonElement>(null);
  const sonrakiRef = useRef<HTMLButtonElement>(null);
  // Pencere iki hafta: basılan hafta düğmesi sınırda kilitlenir ve odak
  // BODY'ye düşerdi. Hafta değişince odak açık kalan yöndeki düğmeye taşınır.
  const odakHedefi = useRef<"onceki" | "sonraki" | null>(null);
  useEffect(() => {
    const hedef = odakHedefi.current;
    odakHedefi.current = null;
    if (hedef === "onceki") oncekiRef.current?.focus();
    else if (hedef === "sonraki") sonrakiRef.current?.focus();
  }, [hafta]);
  const from = gunEkle(bugun, 7 * hafta);
  // Hafta/süre değişirken önceki hafta yerinde kalır (bölüm zıplamaz) ama
  // yeni yanıt gelene dek seçtirilmez.
  const slotlar = useTutorSlots(tutorId, from, Number(sure), { oncekiniTut: true });
  const veri = slotlar.data;
  const bekliyor = slotlar.isPlaceholderData;

  // Eğitmen hiç saat açmamışsa bölüm hiç çizilmez (eski "Müsait Saatler" gibi).
  if (veri && !veri.has_availability) return null;

  const sonrakiHaftaVar =
    !!veri &&
    hafta < 1 &&
    Date.parse(`${gunEkle(bugun, 7 * (hafta + 1))}T00:00:00+03:00`) < Date.parse(veri.window_end);
  const sutunlar = veri ? programSutunlari(veri.days) : [];
  const enUzun = Math.max(0, ...sutunlar.map((s) => s.saatler.length));
  const gorunen = acik ? enUzun : Math.min(enUzun, KAPALI_SATIR);
  
  const saatAdi = isTrial ? "25 dakikalık deneme" : `${sure} dakikalık`;
  const mobilSutun =
    sutunlar.find((s) => s.date === mobilGun) ??
    sutunlar.find((s) => s.saatler.length > 0) ??
    sutunlar[0];
  const saatSec = (date: string, sl: SlotOut) =>
    onSaatSec?.({ date, start_at: sl.start_at, duration: Number(sure) });

  const haftaDegistir = (yeni: number) => {
    // 0 → 1: "Sonraki" kilitlenir, odak "Önceki"ye; 1 → 0: tersi.
    odakHedefi.current = yeni > hafta ? "onceki" : "sonraki";
    setHafta(yeni);
    setAcik(false);
    setMobilGun("");
  };

  const surelerOptions = offeredDurations.map((d) => ({
    value: String(d),
    label: d === 60 ? "60 dk (Önerilen)" : `${d} dk`,
  }));

  return (
    <section className="border-t border-slate-200 pt-6" aria-labelledby="program-baslik">
      <h2 id="program-baslik" ref={baslikRef} className="scroll-mt-24 mb-2 text-xl font-bold text-slate-900">
        Program
      </h2>
      <p className={KUCUK_ACIKLAMA}>
        {onSaatSec
          ? "İlk dersinin saatini seç. Saatler Türkiye saatiyle gösterilir."
          : kendiProfili
            ? "Öğrencilerin gördüğü boş saatler. Saatler Türkiye saatiyle."
            : "Boş saatler, Türkiye saatiyle. Ders talebi üye hesabıyla yapılır."}
      </p>

      {/* Deneme dersi değilse ve birden fazla süre seçeneği varsa göster */}
      {!isTrial && offeredDurations.length > 1 && (
        <div className="mt-4 max-w-sm max-sm:[&_button]:min-h-11" role="group" aria-label="Ders süresi">
          <SegmentedControl
            options={surelerOptions}
            value={sure}
            onChange={(v) => {
              setSure(v);
              setAcik(false);
            }}
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex gap-2">
          <button
            ref={oncekiRef}
            type="button"
            className={OK_DUGMESI}
            onClick={() => haftaDegistir(hafta - 1)}
            disabled={hafta === 0}
            aria-label="Önceki hafta"
          >
            <Icon name="chevronLeft" className="h-5 w-5" />
          </button>
          <button
            ref={sonrakiRef}
            type="button"
            className={OK_DUGMESI}
            onClick={() => {
              if (!bekliyor) haftaDegistir(hafta + 1);
            }}
            disabled={!sonrakiHaftaVar}
            aria-disabled={bekliyor || undefined}
            aria-label="Sonraki hafta"
          >
            <Icon name="chevronRight" className="h-5 w-5" />
          </button>
        </div>
        <p className="text-base font-semibold text-slate-900" aria-live="polite">
          {haftaEtiketi(from, gunEkle(from, 6))}
        </p>
      </div>

      {slotlar.isLoading ? (
        <p className={`mt-6 min-h-40 ${KUCUK_ACIKLAMA}`}>Saatler yükleniyor…</p>
      ) : slotlar.isError || !veri ? (
        <div className="mt-6 space-y-3">
          <p role="alert" className={KUCUK_ACIKLAMA}>
            Program yüklenemedi.
          </p>
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => slotlar.refetch()}>
            Tekrar dene
          </button>
        </div>
      ) : (
        <>
          {/* Telefon: gün şeridi + seçili günün saatleri (7 sütun 390px'te sıkışıyordu). */}
          <div
            className={`mt-5 sm:hidden ${bekliyor ? "opacity-50" : ""}`}
            aria-busy={bekliyor || undefined}
          >
            <div className="grid grid-cols-7 gap-1">
              {sutunlar.map((s) => {
                const secili = s.date === mobilSutun?.date;
                return (
                  <button
                    key={s.date}
                    type="button"
                    aria-pressed={secili}
                    aria-disabled={bekliyor || undefined}
                    aria-label={`${WEEKDAYS_LONG[s.gun]} ${uzunTarih.format(gunTarihi(s.date))}${s.saatler.length ? "" : ", boş saat yok"}`}
                    onClick={() => {
                      if (!bekliyor) setMobilGun(s.date);
                    }}
                    className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm leading-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus ${
                      secili ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
                    } ${!secili && !s.saatler.length ? "text-slate-400" : !secili ? "text-slate-900" : ""}`}
                  >
                    <span>{WEEKDAYS_SHORT[s.gun]}</span>
                    <span className="font-semibold">{Number(s.date.slice(8))}</span>
                  </button>
                );
              })}
            </div>
            {mobilSutun && mobilSutun.saatler.length > 0 ? (
              <ul className="mt-4 grid grid-cols-3 gap-2">
                {mobilSutun.saatler.map((sl) => (
                  <li key={sl.start_at}>
                    {onSaatSec ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!bekliyor) saatSec(mobilSutun.date, sl);
                        }}
                        aria-disabled={bekliyor || undefined}
                        aria-label={`${WEEKDAYS_LONG[mobilSutun.gun]} ${uzunTarih.format(gunTarihi(mobilSutun.date))}, ${formatIstanbulTime(sl.start_at)} — ${saatAdi} ders seç`}
                        className="flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium tabular-nums text-slate-900 transition hover:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus"
                      >
                        {formatIstanbulTime(sl.start_at)}
                      </button>
                    ) : (
                      // Salt okunur: kenarlıksız düz metin (masaüstüyle aynı), düğme sanılmasın.
                      <span className="flex min-h-11 items-center justify-center text-sm tabular-nums text-slate-900">
                        {formatIstanbulTime(sl.start_at)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              enUzun > 0 && <p className={`mt-4 ${KUCUK_ACIKLAMA}`}>{WEEKDAYS_LONG[mobilSutun.gun]} için boş saat yok.</p>
            )}
          </div>

          <div
            className={`mt-5 hidden grid-cols-7 gap-x-1 sm:grid ${bekliyor ? "opacity-50" : ""}`}
            aria-busy={bekliyor || undefined}
          >
            {sutunlar.map((s) => (
              <div key={s.date} className="min-w-0">
                <div
                  aria-hidden
                  className={`h-1 rounded-full ${s.saatler.length ? "bg-slate-900" : "bg-slate-200"}`}
                />
                <p className="mt-3 text-center text-sm leading-5 text-slate-600">
                  <span className="block">{WEEKDAYS_SHORT[s.gun]}</span>
                  <span className={`block ${s.saatler.length ? "font-semibold text-slate-900" : ""}`}>
                    {Number(s.date.slice(8))}
                  </span>
                </p>
                <ul className="mt-2 space-y-0.5">
                  {s.saatler.slice(0, gorunen).map((sl) => (
                    <li key={sl.start_at}>
                      <SaatHucresi
                        slot={sl}
                        gunAdi={`${WEEKDAYS_LONG[s.gun]} ${uzunTarih.format(gunTarihi(s.date))}`}
                        saatAdi={saatAdi}
                        onSec={onSaatSec ? () => saatSec(s.date, sl) : undefined}
                        disabled={bekliyor}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {enUzun === 0 && !bekliyor && (
            <div className="mt-4 space-y-3">
              <p className={KUCUK_ACIKLAMA}>Bu hafta {saatAdi} boş saat yok.</p>
              {sonrakiHaftaVar && (
                <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => haftaDegistir(hafta + 1)}>
                  Sonraki haftaya bak
                </button>
              )}
            </div>
          )}

          {enUzun > KAPALI_SATIR && !bekliyor && (
            <div className="mt-4 hidden text-center sm:block">
              <button
                type="button"
                className={`${METIN_BAGLANTI} inline-block py-2.5 -my-2.5 focus-visible:outline-none [&:focus-visible>span]:rounded-sm [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-marka-focus [&:focus-visible>span]:ring-offset-2`}
                aria-expanded={acik}
                onClick={() => {
                  if (acik) baslikRef.current?.scrollIntoView({ block: "start" });
                  setAcik((a) => !a);
                }}
              >
                <span>{acik ? "Daha az göster" : "Programın tamamını gör"}</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SaatHucresi({
  slot,
  gunAdi,
  saatAdi,
  onSec,
  disabled,
}: {
  slot: SlotOut;
  gunAdi: string;
  saatAdi: string;
  onSec?: () => void;
  disabled?: boolean;
}) {
  const saat = formatIstanbulTime(slot.start_at);
  const metin = "text-sm font-medium tabular-nums text-slate-900";
  if (!onSec) {
    return <span className={`block py-2 text-center ${metin}`}>{saat}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onSec();
      }}
      aria-disabled={disabled || undefined}
      aria-label={`${gunAdi}, ${saat} — ${saatAdi} ders seç`}
      className={`flex min-h-11 w-full items-center justify-center rounded-md underline decoration-slate-300 underline-offset-4 transition hover:bg-slate-100 hover:decoration-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus ${metin}`}
    >
      {saat}
    </button>
  );
}
