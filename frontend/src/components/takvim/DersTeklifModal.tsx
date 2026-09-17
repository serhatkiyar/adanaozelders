import { useId, useMemo, useState, type FormEvent } from "react";

import {
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { Modal } from "@/components/ui/Modal";
import { useMyStudents, useOfferLesson } from "@/hooks/useDersTeklifi";
import { formatRange } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ADSIZ_UYE } from "@/lib/roles";
import { toast } from "@/store/toastStore";

export interface TeklifAraligi {
  baslangic: Date;
  bitis: Date;
}

/**
 * Ders teklifi penceresi (Modül 8).
 *
 * Preply'da eğitmen takvimden doğrudan ders planlar; orada öğrencinin ön
 * ödemeli ders bakiyesi olduğu için ödeme adımı yoktur. Bizde ödeme ders
 * başınadır, bu yüzden aynı yer TEKLİF üretir: ders `PENDING` doğar, öğrenci
 * kabul edip ödeyince kesinleşir. Kurallar (24 saat, müsaitlik, izin, çakışma)
 * ve ücret sınırı sunucudadır; burası yalnız formdur.
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

  const ogrenciler = useMyStudents(true);
  const teklif = useOfferLesson();

  const dakika = useMemo(
    () => Math.round((aralik.bitis.getTime() - aralik.baslangic.getTime()) / 60000),
    [aralik]
  );

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    setHata(null);
    if (ogrenciId === "") {
      setHata("Önce öğrenci seç.");
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

  return (
    <Modal
      open
      onClose={onClose}
      title="Ders planla"
      description={`${formatRange(aralik.baslangic.toISOString(), aralik.bitis.toISOString())} · ${dakika} dk`}
    >
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
              className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900"
              value={ogrenciId}
              onChange={(e) => setOgrenciId(e.target.value === "" ? "" : Number(e.target.value))}
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
          <label className={ETIKET} htmlFor={`${kimlik}-ucret`}>
            Ücret (isteğe bağlı)
          </label>
          <input
            id={`${kimlik}-ucret`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="İlanındaki ücret"
            className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900"
            value={ucret}
            onChange={(e) => setUcret(e.target.value)}
          />
          <p className={KUCUK_ACIKLAMA}>
            Boş bırakırsan ilanındaki saatlik ücret uygulanır. İndirim yapabilirsin; ilan
            ücretinin üstüne çıkamazsın.
            {ucret.trim() ? ` Öğrenci ${formatTRY(ucret)} ödeyecek.` : ""}
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
            onChange={(e) => setNot(e.target.value)}
          />
        </div>

        <p className={KUCUK_ACIKLAMA}>
          Ders, öğrenci kabul edip ödeme yapınca kesinleşir. Ödeme ders onaylanana kadar
          bekletilir.
        </p>

        {hata && <p className="text-base leading-6 text-red-700">{hata}</p>}

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={onClose}>
            Vazgeç
          </button>
          <button
            type="submit"
            className={DUGME_SATIR_BIRINCIL}
            disabled={teklif.isPending || liste.length === 0}
          >
            {teklif.isPending ? "Gönderiliyor…" : "Teklifi gönder"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
