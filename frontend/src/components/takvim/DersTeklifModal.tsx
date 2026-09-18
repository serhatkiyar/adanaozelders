import { useId, useMemo, useState, type FormEvent } from "react";

import {
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { Modal } from "@/components/ui/Modal";
import {
  useMyStudents,
  useOfferLesson,
  useSeriOlustur,
  useSeriOnizleme,
} from "@/hooks/useDersTeklifi";
import { formatIstanbulTime, formatRange } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ADSIZ_UYE } from "@/lib/roles";
import { toast } from "@/store/toastStore";
import type {
  LessonSeriesCreate,
  LessonSeriesPreview,
  SeriesConflictReason,
  SeriesDuration,
} from "@/types";

export interface TeklifAraligi {
  baslangic: Date;
  bitis: Date;
}

type DersTipi = "tek" | "haftalik";

const SURELER: SeriesDuration[] = [30, 60, 90, 120];
const HAFTALAR = Array.from({ length: 11 }, (_, i) => i + 2); // 2–12
const VARSAYILAN_HAFTA = 4;

const NEDEN_METNI: Record<SeriesConflictReason, string> = {
  TOO_SOON: "24 saatten yakın",
  TIME_OFF: "iznin var",
  OUTSIDE_AVAILABILITY: "müsaitliğin dışında",
  TUTOR_BUSY: "o saatte dersin var",
  STUDENT_BUSY: "öğrencinin başka dersi var",
};

// Seri günü sunucuda Türkiye saatiyle hesaplanır; özet de aynı saati gösterir.
const istanbulGunAdi = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  weekday: "long",
});

const SECIM = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900";

/**
 * Ders teklifi penceresi (Modül 8).
 *
 * Preply'da eğitmen takvimden doğrudan ders planlar; orada öğrencinin ön
 * ödemeli ders bakiyesi olduğu için ödeme adımı yoktur. Bizde ödeme ders
 * başınadır, bu yüzden aynı yer TEKLİF üretir: ders `PENDING` doğar, öğrenci
 * kabul edip ödeyince kesinleşir. Kurallar (24 saat, müsaitlik, izin, çakışma)
 * ve ücret sınırı sunucudadır; burası yalnız formdur.
 *
 * "Haftalık" tipinde aynı gün ve saatte 2–12 haftalık seri kurulur. Önce
 * sunucuya simülasyon sorulur (hangi haftalar şimdi, hangileri pencere
 * açıldıkça teklif edilir, hangileri çakışır); her ders yine ayrı tekliftir.
 */
export function DersTeklifModal({
  aralik,
  onClose,
}: {
  aralik: TeklifAraligi;
  onClose: () => void;
}) {
  const kimlik = useId();
  const [ogrenciId, setOgrenciId] = useState<number | "">("");
  const [ucret, setUcret] = useState("");
  const [not, setNot] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [tip, setTip] = useState<DersTipi>("tek");

  const dakika = useMemo(
    () => Math.round((aralik.bitis.getTime() - aralik.baslangic.getTime()) / 60000),
    [aralik]
  );
  const [sure, setSure] = useState<SeriesDuration>(() =>
    SURELER.includes(dakika as SeriesDuration) ? (dakika as SeriesDuration) : 60
  );
  const [hafta, setHafta] = useState(VARSAYILAN_HAFTA);
  const [onizleme, setOnizleme] = useState<LessonSeriesPreview | null>(null);

  const ogrenciler = useMyStudents(true);
  const teklif = useOfferLesson();
  const onizle = useSeriOnizleme();
  const seri = useSeriOlustur();
  const mesgul = teklif.isPending || onizle.isPending || seri.isPending;

  /** Alan değişince önceki simülasyon geçersizdir: yeniden "Kontrol et" istenir. */
  function degisti<T>(ayarla: (v: T) => void) {
    return (v: T) => {
      ayarla(v);
      setOnizleme(null);
      setHata(null);
    };
  }

  const seriIstegi = (): LessonSeriesCreate => ({
    client_id: Number(ogrenciId),
    first_start_at: aralik.baslangic.toISOString(),
    duration_min: sure,
    weeks: hafta,
    notes: not.trim() || null,
    price: ucret.trim() ? ucret.trim() : null,
  });

  const seriGonder = () => {
    if (!onizleme) {
      onizle.mutate(seriIstegi(), {
        onSuccess: setOnizleme,
        onError: (err) => setHata(getErrorDetail(err, "Seri kontrol edilemedi.")),
      });
      return;
    }
    seri.mutate(seriIstegi(), {
      onSuccess: (sonuc) => {
        toast.success(
          sonuc.offered.length > 0
            ? `Haftalık seri kuruldu; ${sonuc.offered.length} ders teklifi öğrenciye iletildi.`
            : "Haftalık seri kuruldu; dersler pencere açıldıkça teklif edilecek."
        );
        if (sonuc.skipped.length > 0) {
          toast.warning(`${sonuc.skipped.length} ders planlanamadı; o haftalar atlandı.`);
        }
        onClose();
      },
      onError: (err) => {
        setHata(getErrorDetail(err, "Seri oluşturulamadı."));
        // Kayıt anında durum değişmiş olabilir: önizleme yeniden istensin.
        setOnizleme(null);
      },
    });
  };

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    setHata(null);
    if (ogrenciId === "") {
      setHata("Önce öğrenci seç.");
      return;
    }
    if (tip === "haftalik") {
      seriGonder();
      return;
    }
    teklif.mutate(
      {
        client_id: Number(ogrenciId),
        start_at: aralik.baslangic.toISOString(),
        end_at: aralik.bitis.toISOString(),
        notes: not.trim() || null,
        price: ucret.trim() ? ucret.trim() : null,
      },
      {
        onSuccess: () => {
          toast.success("Ders teklifin öğrenciye iletildi.");
          onClose();
        },
        onError: (err) => setHata(getErrorDetail(err, "Ders teklifi gönderilemedi.")),
      }
    );
  };

  const liste = ogrenciler.data ?? [];
  const baslangicIso = aralik.baslangic.toISOString();
  const seriBitisIso = new Date(aralik.baslangic.getTime() + sure * 60_000).toISOString();
  const aciklama =
    tip === "tek"
      ? `${formatRange(baslangicIso, aralik.bitis.toISOString())} · ${dakika} dk`
      : `İlk ders: ${formatRange(baslangicIso, seriBitisIso)} · ${sure} dk`;
  const gunAdi = istanbulGunAdi.format(aralik.baslangic);
  const gunAdiBuyuk = gunAdi.charAt(0).toLocaleUpperCase("tr-TR") + gunAdi.slice(1);
  const catismalar = onizleme?.occurrences.filter((o) => o.status === "CONFLICT") ?? [];

  let birincilMetin: string;
  if (tip === "tek") birincilMetin = teklif.isPending ? "Gönderiliyor…" : "Teklifi gönder";
  else if (onizle.isPending) birincilMetin = "Kontrol ediliyor…";
  else if (seri.isPending) birincilMetin = "Gönderiliyor…";
  else birincilMetin = onizleme ? "Seriyi gönder" : "Kontrol et";

  const tipDugmesi = (deger: DersTipi, etiket: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={tip === deger}
      className={`h-10 flex-1 rounded-lg border-2 bg-white px-4 text-base font-semibold transition ${
        tip === deger
          ? "border-slate-900 text-slate-900"
          : "border-slate-200 text-slate-600 hover:border-slate-400"
      }`}
      onClick={() => degisti(setTip)(deger)}
    >
      {etiket}
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Ders planla" description={aciklama}>
      <form className="space-y-5" onSubmit={gonder}>
        <div className="space-y-2">
          <label className={ETIKET} htmlFor={`${kimlik}-ogrenci`}>
            Öğrenci
          </label>
          {ogrenciler.isLoading ? (
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
          ) : liste.length === 0 ? (
            <p className={ACIKLAMA}>
              Henüz ders ilişkin olan bir öğrenci yok. Teklif yalnız daha önce dersi olan
              öğrenciye gönderilebilir.
            </p>
          ) : (
            <select
              id={`${kimlik}-ogrenci`}
              className={SECIM}
              value={ogrenciId}
              onChange={(e) =>
                degisti(setOgrenciId)(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Seç</option>
              {liste.map((o) => (
                <option key={o.client_id} value={o.client_id}>
                  {o.full_name || ADSIZ_UYE} · {o.lesson_count} ders
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <p className={ETIKET} id={`${kimlik}-tip`}>
            Ders tipi
          </p>
          <div role="radiogroup" aria-labelledby={`${kimlik}-tip`} className="flex gap-3">
            {tipDugmesi("tek", "Tek")}
            {tipDugmesi("haftalik", "Haftalık")}
          </div>
        </div>

        {tip === "haftalik" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className={ETIKET} htmlFor={`${kimlik}-sure`}>
                  Süre
                </label>
                <select
                  id={`${kimlik}-sure`}
                  className={SECIM}
                  value={sure}
                  onChange={(e) => degisti(setSure)(Number(e.target.value) as SeriesDuration)}
                >
                  {SURELER.map((s) => (
                    <option key={s} value={s}>
                      {s} dk
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className={ETIKET} htmlFor={`${kimlik}-hafta`}>
                  Hafta sayısı
                </label>
                <select
                  id={`${kimlik}-hafta`}
                  className={SECIM}
                  value={hafta}
                  onChange={(e) => degisti(setHafta)(Number(e.target.value))}
                >
                  {HAFTALAR.map((h) => (
                    <option key={h} value={h}>
                      {h} hafta
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className={ACIKLAMA}>
              Her {gunAdiBuyuk} {formatIstanbulTime(baslangicIso)} · {hafta} hafta
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className={ETIKET} htmlFor={`${kimlik}-ucret`}>
            {tip === "haftalik" ? "Ders başı ücret (isteğe bağlı)" : "Ücret (isteğe bağlı)"}
          </label>
          <input
            id={`${kimlik}-ucret`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="İlanındaki ücret"
            className={SECIM}
            value={ucret}
            onChange={(e) => degisti(setUcret)(e.target.value)}
          />
          <p className={KUCUK_ACIKLAMA}>
            Boş bırakırsan ilanındaki saatlik ücret uygulanır. İndirim yapabilirsin; ilan
            ücretinin üstüne çıkamazsın.
            {ucret.trim() && tip === "tek" ? ` Öğrenci ${formatTRY(ucret)} ödeyecek.` : ""}
          </p>
        </div>

        <div className="space-y-2">
          <label className={ETIKET} htmlFor={`${kimlik}-not`}>
            Öğrenciye not (isteğe bağlı)
          </label>
          <textarea
            id={`${kimlik}-not`}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-900"
            value={not}
            onChange={(e) => degisti(setNot)(e.target.value)}
          />
        </div>

        {tip === "tek" ? (
          <p className={KUCUK_ACIKLAMA}>
            Ders, öğrenci kabul edip ödeme yapınca kesinleşir. Ödeme ders onaylanana kadar
            bekletilir.
          </p>
        ) : (
          <p className={KUCUK_ACIKLAMA}>
            Her ders ayrı teklif olarak gider; öğrenci kabul edip ödeyince kesinleşir. Seriyi sen
            ya da öğrencin istediğiniz an bitirebilirsiniz.
          </p>
        )}

        {tip === "haftalik" && onizleme && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-4" aria-live="polite">
            <p className={ETIKET}>Şimdi teklif edilecek: {onizleme.offer_now_count}</p>
            <p className={ETIKET}>Pencere açıldıkça teklif edilecek: {onizleme.later_count}</p>
            {onizleme.offer_now_count === 0 && (
              <p className="text-base leading-6 text-red-700">
                İlk iki haftada planlanabilir ders yok; seriyi başka bir tarihle başlat.
              </p>
            )}
            {catismalar.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-base font-semibold leading-6 text-red-700">
                  {catismalar.length} ders planlanamıyor
                </p>
                <ul className="space-y-1">
                  {catismalar.map((o) => (
                    <li key={o.index} className={KUCUK_ACIKLAMA}>
                      {formatRange(o.start_at, o.end_at)}
                      {o.reason ? ` · ${NEDEN_METNI[o.reason]}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {onizleme.price.amount && (
              <p className={`pt-1 ${KUCUK_ACIKLAMA}`}>
                Öğrenci ders başına {formatTRY(onizleme.price.amount)} ödeyecek.
              </p>
            )}
          </div>
        )}

        {hata && (
          <p role="alert" className="text-base leading-6 text-red-700">
            {hata}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
            Vazgeç
          </button>
          <button
            type="submit"
            className={DUGME_SATIR_BIRINCIL}
            disabled={mesgul || liste.length === 0 || (tip === "haftalik" && onizleme?.offer_now_count === 0)}
          >
            {birincilMetin}
          </button>
        </div>
      </form>
    </Modal>
  );
}
