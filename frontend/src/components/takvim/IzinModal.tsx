import { useId, useState, type FormEvent } from "react";

import {
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { Modal } from "@/components/ui/Modal";
import { useCreateTimeOff, usePreviewTimeOff } from "@/hooks/useTimeOff";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { ADSIZ_UYE } from "@/lib/roles";
import { toast } from "@/store/toastStore";
import type { BookingOut, TimeOffPreview } from "@/types";

export interface IzinAraligi {
  baslangic: Date;
  bitis: Date;
  tumGun: boolean;
}

/** Aynı gün: "17 Eyl 2026 14:00 – 18:00"; günler farklıysa iki uç da tarihli. */
export function izinAraligiMetni(startIso: string, endIso: string): string {
  const a = new Date(startIso);
  const b = new Date(endIso);
  return a.toDateString() === b.toDateString()
    ? formatRange(startIso, endIso)
    : `${formatDateTime(startIso)} – ${formatDateTime(endIso)}`;
}

const iki = (n: number) => String(n).padStart(2, "0");

/** Yerel "yyyy-MM-dd". */
function gunDegeri(d: Date): string {
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
}

/** Yerel "yyyy-MM-ddTHH:mm" (`datetime-local`). */
function anDegeri(d: Date): string {
  return `${gunDegeri(d)}T${iki(d.getHours())}:${iki(d.getMinutes())}`;
}

/** "yyyy-MM-dd" → yerel gece yarısı. */
function gunBasi(deger: string): Date {
  const [y, m, g] = deger.split("-").map(Number);
  return new Date(y, m - 1, g);
}

const ILK_GORUNEN = 3;
const NOT_EN_AZ = 3;

/**
 * İzin ekleme penceresi (Modül 7). Önce sunucuya önizleme sorulur; üç dal:
 *  • engelli: 12 saatten yakın onaylı ders var → kaydetme yok,
 *  • iptal edilecek dersler var → öğrenciye zorunlu not + tehlike düğmesi,
 *  • çakışma yok → doğrudan kaydedilir.
 * Karar ve iade sunucudadır; burası yalnız sonucu gösterir.
 */
export function IzinModal({ aralik, onClose }: { aralik: IzinAraligi; onClose: () => void }) {
  const kimlik = useId();
  const [tumGun, setTumGun] = useState(aralik.tumGun);
  const [baslangic, setBaslangic] = useState(() =>
    aralik.tumGun ? gunDegeri(aralik.baslangic) : anDegeri(aralik.baslangic)
  );
  const [bitis, setBitis] = useState(() => {
    if (!aralik.tumGun) return anDegeri(aralik.bitis);
    // Tüm gün aralığının bitişi ertesi gece yarısıdır; alanda son gün görünür.
    const son = new Date(aralik.bitis.getTime() - 1);
    return gunDegeri(son);
  });
  const [baslik, setBaslik] = useState("");
  const [not, setNot] = useState("");
  const [onizleme, setOnizleme] = useState<TimeOffPreview | null>(null);
  const [hepsiAcik, setHepsiAcik] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const onizle = usePreviewTimeOff();
  const olustur = useCreateTimeOff();
  const mesgul = onizle.isPending || olustur.isPending;

  const tumGunDegisti = (acik: boolean) => {
    setTumGun(acik);
    setBaslangic((v) => (acik ? v.slice(0, 10) : `${v.slice(0, 10)}T09:00`));
    setBitis((v) => (acik ? v.slice(0, 10) : `${v.slice(0, 10)}T18:00`));
  };

  /** Alanlardan ISO aralık; geçersizse null ve hata metni. */
  const isoAralik = (): { start_at: string; end_at: string } | null => {
    if (!baslangic || !bitis) {
      setHata("Başlangıç ve bitişi seç.");
      return null;
    }
    let bas: Date;
    let son: Date;
    if (tumGun) {
      bas = gunBasi(baslangic);
      son = gunBasi(bitis);
      son.setDate(son.getDate() + 1);
    } else {
      bas = new Date(baslangic);
      son = new Date(bitis);
    }
    if (Number.isNaN(bas.getTime()) || Number.isNaN(son.getTime())) {
      setHata("Tarihleri kontrol et.");
      return null;
    }
    if (son <= bas) {
      setHata("Bitiş başlangıçtan sonra olmalı.");
      return null;
    }
    return { start_at: bas.toISOString(), end_at: son.toISOString() };
  };

  const kaydet = (range: { start_at: string; end_at: string }, ogrenciNotu: string | null) => {
    setHata(null);
    olustur.mutate(
      { ...range, title: baslik.trim() || null, note: ogrenciNotu },
      {
        onSuccess: (sonuc) => {
          toast.success(
            sonuc.cancelled_count > 0
              ? `İzin eklendi; ${sonuc.cancelled_count} ders iptal edildi.`
              : "İzin eklendi."
          );
          if (sonuc.skipped_ids.length > 0) {
            toast.warning(
              `${sonuc.skipped_ids.length} dersin durumu bu sırada değişti ve iptal edilmedi; takviminden kontrol et.`
            );
          }
          onClose();
        },
        onError: (e) => {
          setHata(getErrorDetail(e, "İzin eklenemedi."));
          // Engel ya da çakışma arada değişmiş olabilir: güncel tabloyu yeniden sor.
          setOnizleme(null);
        },
      }
    );
  };

  const devam = (e: FormEvent) => {
    e.preventDefault();
    setHata(null);
    const range = isoAralik();
    if (!range) return;
    onizle.mutate(range, {
      onSuccess: (sonuc) => {
        if (!sonuc.blocked && sonuc.bookings.length === 0) {
          kaydet(range, null);
          return;
        }
        setHepsiAcik(false);
        setOnizleme(sonuc);
      },
      onError: (err) => setHata(getErrorDetail(err, "İzin kontrol edilemedi.")),
    });
  };

  const iptalliKaydet = (e: FormEvent) => {
    e.preventDefault();
    if (not.trim().length < NOT_EN_AZ) {
      setHata("İptal edilecek dersler için öğrencilere kısa bir not yaz.");
      return;
    }
    const range = isoAralik();
    if (range) kaydet(range, not.trim());
  };

  const hataKutusu = hata && (
    <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
      {hata}
    </p>
  );

  // ── Dal 1: engelli ──
  if (onizleme?.blocked) {
    const yakinlar = onizleme.bookings.filter((s) => !s.can_cancel).map((s) => s.booking);
    return (
      <Modal open onClose={onClose} title="Bu aralığa izin eklenemez" maxWidth="max-w-lg">
        <p className={ACIKLAMA}>
          Derse 12 saatten az kala iptal edemezsin. Bu aralıkta yakın derslerin var; izni bu
          derslerden sonra başlat ya da öğrencinle konuşup çözüm bul.
        </p>
        <DersListesi dersler={yakinlar} />
        {hataKutusu}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => setOnizleme(null)}>
            Tarihleri değiştir
          </button>
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
            Kapat
          </button>
        </div>
      </Modal>
    );
  }

  // ── Dal 2: iptal edilecek dersler var ──
  if (onizleme && onizleme.bookings.length > 0) {
    const tum = onizleme.bookings.map((s) => s.booking);
    const gorunen = hepsiAcik ? tum : tum.slice(0, ILK_GORUNEN);
    return (
      <Modal open onClose={onClose} title="Dersler iptal edilecek" maxWidth="max-w-lg">
        <form onSubmit={iptalliKaydet}>
          <p className={ACIKLAMA}>
            Bu izin {tum.length} dersi iptal eder; ödenmiş ücretler öğrencilere iade edilir. Onay
            bekleyen istekler reddedilir.
          </p>
          <DersListesi dersler={gorunen} />
          {tum.length > ILK_GORUNEN && (
            <button
              type="button"
              className="mt-2 text-base font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900"
              onClick={() => setHepsiAcik((v) => !v)}
              aria-expanded={hepsiAcik}
            >
              {hepsiAcik ? "Daha az göster" : `Daha fazla göster (${tum.length - ILK_GORUNEN})`}
            </button>
          )}
          <label htmlFor={`${kimlik}-not`} className={`mt-5 block ${ETIKET}`}>
            Öğrencilere not
          </label>
          <textarea
            id={`${kimlik}-not`}
            className="input mt-2 min-h-24 text-base"
            maxLength={500}
            value={not}
            onChange={(e) => setNot(e.target.value)}
            placeholder="Ör. Bu tarihlerde şehir dışındayım, yeni saat için mesaj atabilirsin."
            required
          />
          <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>Not, iptal bildirimiyle öğrencilere gider.</p>
          {hataKutusu}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => setOnizleme(null)}>
              Geri
            </button>
            <button type="submit" className={DUGME_SATIR_TEHLIKE} disabled={olustur.isPending}>
              {olustur.isPending ? "Kaydediliyor…" : "İzni ekle, dersleri iptal et"}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  // ── Form ──
  const alanTuru = tumGun ? "date" : "datetime-local";
  return (
    <Modal open onClose={onClose} title="İzin ekle" maxWidth="max-w-lg">
      <form onSubmit={devam} className="space-y-4">
        <label className="flex items-center gap-3 text-base leading-6 text-slate-900">
          <input
            type="checkbox"
            className="h-5 w-5 accent-marka"
            checked={tumGun}
            onChange={(e) => tumGunDegisti(e.target.checked)}
          />
          Tüm gün
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${kimlik}-bas`} className={ETIKET}>
              Başlangıç
            </label>
            <input
              id={`${kimlik}-bas`}
              key={`bas-${alanTuru}`}
              type={alanTuru}
              step={tumGun ? undefined : 900}
              className="input mt-2 text-base"
              value={baslangic}
              onChange={(e) => setBaslangic(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={`${kimlik}-son`} className={ETIKET}>
              {tumGun ? "Son gün" : "Bitiş"}
            </label>
            <input
              id={`${kimlik}-son`}
              key={`son-${alanTuru}`}
              type={alanTuru}
              step={tumGun ? undefined : 900}
              className="input mt-2 text-base"
              value={bitis}
              onChange={(e) => setBitis(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${kimlik}-baslik`} className={ETIKET}>
            Başlık <span className="font-normal text-slate-500">(isteğe bağlı)</span>
          </label>
          <input
            id={`${kimlik}-baslik`}
            type="text"
            className="input mt-2 text-base"
            maxLength={100}
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            placeholder="Ör. Tatil"
          />
          <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
            Saatler 15 dakikalık adımlarla seçilir; en fazla 60 gün.
          </p>
        </div>
        {hataKutusu}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className={DUGME_SATIR_BIRINCIL} disabled={mesgul}>
            {mesgul ? "Kontrol ediliyor…" : "Devam"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DersListesi({ dersler }: { dersler: BookingOut[] }) {
  return (
    <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
      {dersler.map((b) => (
        <li key={b.id} className="px-4 py-3">
          <p className={ETIKET}>{b.client_name || ADSIZ_UYE}</p>
          <p className={KUCUK_ACIKLAMA}>{formatRange(b.start_at, b.end_at)}</p>
        </li>
      ))}
    </ul>
  );
}
