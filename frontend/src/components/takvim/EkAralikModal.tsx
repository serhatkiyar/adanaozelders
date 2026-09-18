import { useId, useState, type FormEvent } from "react";

import {
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { izinAraligiMetni } from "@/components/takvim/IzinModal";
import { Modal } from "@/components/ui/Modal";
import { useCreateEkAralik, useDeleteEkAralik, useEkAraliklar } from "@/hooks/useEkAralik";
import { istanbulInputToIso } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";

export interface EkAralik {
  baslangic: Date;
  bitis: Date;
}

type Sekme = "ekle" | "liste";

/** Liste sekmesinin ufku — sunucunun liste sınırı (62 gün). */
const LISTE_GUN = 62;

/** 00:00 … 23:30 — sunucu 30 dakikalık adım ister. */
const SAATLER = Array.from({ length: 48 }, (_, i) => {
  const s = String(Math.floor(i / 2)).padStart(2, "0");
  return `${s}:${i % 2 === 0 ? "00" : "30"}`;
});

const istanbulBicim = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Tarih → Türkiye duvar saatiyle "yyyy-MM-dd" ve 30 dakikaya aşağı yuvarlanmış
 * "HH:mm". Sunucu sabit UTC+3 çalışır; tarayıcı saat dilimi farklı olsa da
 * alanlar Türkiye saatini gösterir ve geri çevrim `istanbulInputToIso` ile olur.
 */
function istanbulParcalari(d: Date): { gun: string; saat: string } {
  const p = istanbulBicim.formatToParts(d);
  const al = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const saat = al("hour") === "24" ? "00" : al("hour");
  const dakika = Number(al("minute")) >= 30 ? "30" : "00";
  return { gun: `${al("year")}-${al("month")}-${al("day")}`, saat: `${saat}:${dakika}` };
}

/**
 * Ek zaman aralığı penceresi. Haftalık müsaitlik şablonuna dokunmadan yalnız
 * belirli bir tarihte ek müsait saat açar (Preply: "Ek zaman aralığı ekle").
 * Kurallar (geçmiş, 24 saat, 14 gün, izin, çakışma) sunucudadır; burası formdur.
 */
export function EkAralikModal({
  aralik,
  ilkSekme = "ekle",
  onClose,
}: {
  aralik?: EkAralik;
  ilkSekme?: Sekme;
  onClose: () => void;
}) {
  const kimlik = useId();
  const [sekme, setSekme] = useState<Sekme>(ilkSekme);

  const sekmeDugmesi = (deger: Sekme, etiket: string) => (
    <button
      type="button"
      role="tab"
      id={`${kimlik}-sekme-${deger}`}
      aria-selected={sekme === deger}
      aria-controls={`${kimlik}-panel`}
      className={`h-10 flex-1 border-b-2 text-base font-semibold transition sm:flex-none sm:px-4 ${
        sekme === deger
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-900"
      }`}
      onClick={() => setSekme(deger)}
    >
      {etiket}
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Ek zaman aralığı" maxWidth="max-w-lg">
      <div role="tablist" aria-label="Ek zaman aralığı" className="-mt-2 mb-5 flex border-b border-slate-200">
        {sekmeDugmesi("ekle", "Ekle")}
        {sekmeDugmesi("liste", "Eklenen aralıklar")}
      </div>
      <div role="tabpanel" id={`${kimlik}-panel`} aria-labelledby={`${kimlik}-sekme-${sekme}`}>
        {sekme === "ekle" ? (
          <EkleFormu aralik={aralik} onClose={onClose} />
        ) : (
          <AralikListesi onClose={onClose} />
        )}
      </div>
    </Modal>
  );
}

function EkleFormu({ aralik, onClose }: { aralik?: EkAralik; onClose: () => void }) {
  const kimlik = useId();
  const [ilk] = useState(() => {
    const bas = aralik?.baslangic ?? new Date();
    const son = aralik?.bitis ?? new Date(bas.getTime() + 2 * 60 * 60 * 1000);
    return { bas: istanbulParcalari(bas), son: istanbulParcalari(son) };
  });
  const [basGun, setBasGun] = useState(ilk.bas.gun);
  const [basSaat, setBasSaat] = useState(ilk.bas.saat);
  const [sonGun, setSonGun] = useState(ilk.son.gun);
  const [sonSaat, setSonSaat] = useState(ilk.son.saat);
  const [hata, setHata] = useState<string | null>(null);

  const olustur = useCreateEkAralik();

  const kaydet = (e: FormEvent) => {
    e.preventDefault();
    setHata(null);
    if (!basGun || !sonGun) {
      setHata("Başlangıç ve bitiş tarihini seç.");
      return;
    }
    const start_at = istanbulInputToIso(`${basGun}T${basSaat}`);
    const end_at = istanbulInputToIso(`${sonGun}T${sonSaat}`);
    if (new Date(end_at) <= new Date(start_at)) {
      setHata("Bitiş başlangıçtan sonra olmalı.");
      return;
    }
    olustur.mutate(
      { start_at, end_at },
      {
        onSuccess: (sonuc) => {
          toast.success("Aralık eklendi. Öğrenciler artık bu saatleri ayırtabilir.");
          if (sonuc.warnings?.includes("MIN_NOTICE")) {
            toast.warning(
              "Aralığın 24 saatten yakın kısmı öğrencilere kapalı; ders yalnız sonrasına ayırtılabilir."
            );
          }
          onClose();
        },
        onError: (err) => setHata(getErrorDetail(err, "Aralık eklenemedi.")),
      }
    );
  };

  const saatSecimi = (id: string, deger: string, degis: (v: string) => void, etiket: string) => (
    <select
      id={id}
      aria-label={etiket}
      className="input text-base"
      value={deger}
      onChange={(e) => degis(e.target.value)}
    >
      {SAATLER.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={kaydet} className="space-y-4">
      <p className={ACIKLAMA}>En fazla 24 saatlik aralık seç. Haftalık müsaitliğin değişmez.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${kimlik}-bas`} className={ETIKET}>
            Başlangıç
          </label>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <input
              id={`${kimlik}-bas`}
              type="date"
              className="input text-base"
              value={basGun}
              onChange={(e) => setBasGun(e.target.value)}
              required
            />
            {saatSecimi(`${kimlik}-bas-saat`, basSaat, setBasSaat, "Başlangıç saati")}
          </div>
        </div>
        <div>
          <label htmlFor={`${kimlik}-son`} className={ETIKET}>
            Bitiş
          </label>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <input
              id={`${kimlik}-son`}
              type="date"
              className="input text-base"
              value={sonGun}
              onChange={(e) => setSonGun(e.target.value)}
              required
            />
            {saatSecimi(`${kimlik}-son-saat`, sonSaat, setSonSaat, "Bitiş saati")}
          </div>
        </div>
      </div>
      <p className={KUCUK_ACIKLAMA}>
        Saatler Türkiye saatidir ve 30 dakikalık adımlarla seçilir; en fazla 14 gün sonrasına kadar
        açılabilir.
      </p>
      {hata && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
          {hata}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 pt-2">
        <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
          Vazgeç
        </button>
        <button type="submit" className={DUGME_SATIR_BIRINCIL} disabled={olustur.isPending}>
          {olustur.isPending ? "Ekleniyor…" : "Aralığı ekle"}
        </button>
      </div>
    </form>
  );
}

function AralikListesi({ onClose }: { onClose: () => void }) {
  // Pencere açılırken bir kez sabitlenir; her çizimde yeni sorgu anahtarı doğmasın.
  const [pencere] = useState(() => {
    const simdi = new Date();
    const son = new Date(simdi.getTime() + LISTE_GUN * 24 * 60 * 60 * 1000);
    return { start: simdi.toISOString(), end: son.toISOString() };
  });
  const liste = useEkAraliklar(pencere);
  const silme = useDeleteEkAralik();
  const [silinen, setSilinen] = useState<number | null>(null);

  const kaldir = (id: number) => {
    setSilinen(id);
    silme.mutate(id, {
      onSuccess: () => toast.success("Aralık kaldırıldı."),
      onError: (e) => toast.error(getErrorDetail(e, "Aralık kaldırılamadı.")),
      onSettled: () => setSilinen(null),
    });
  };

  const satirlar = liste.data ?? [];

  return (
    <div className="space-y-4">
      <p className={ACIKLAMA}>
        Müsait olmadığın aralıkları silerek kaldırabilirsin. Bu aralıktaki mevcut dersler
        etkilenmez.
      </p>
      {liste.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" aria-busy />
      ) : liste.isError ? (
        <div className="space-y-3">
          <p role="alert" className="text-base leading-6 text-red-700">
            {getErrorDetail(liste.error, "Aralıklar yüklenemedi.")}
          </p>
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => void liste.refetch()}>
            Tekrar dene
          </button>
        </div>
      ) : satirlar.length === 0 ? (
        <p className={KUCUK_ACIKLAMA}>Önümüzdeki günler için eklenmiş aralık yok.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {satirlar.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="min-w-0 text-base leading-6 text-slate-900">
                {izinAraligiMetni(a.start_at, a.end_at)}
              </p>
              <button
                type="button"
                className={DUGME_SATIR_TEHLIKE}
                onClick={() => kaldir(a.id)}
                disabled={silme.isPending}
              >
                {silinen === a.id ? "Kaldırılıyor…" : "Kaldır"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end pt-2">
        <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  );
}
