import { AxiosError } from "axios";
import { FormEvent, useState } from "react";

import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";
import { useBlockClient } from "@/hooks/useMessages";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BlockReason } from "@/types";

export const ENGEL_GEREKCESI: Record<BlockReason, string> = {
  OFF_PLATFORM: "Platform dışı ödeme ya da iletişim teklifi",
  HARASSMENT: "Taciz ya da hakaret",
  SCAM: "Dolandırıcılık girişimi",
  NOT_A_FIT: "Bu öğrenciye ders vermek istemiyorum",
  PRICE_MISMATCH: "Ücrette anlaşamadık",
  NO_SHOW: "Dersleri sık kaçırıyor ya da erteliyor",
  OTHER: "Diğer",
};

const GEREKCELER = Object.keys(ENGEL_GEREKCESI) as BlockReason[];
const NOT_UST_SINIR = 500;

/**
 * Eğitmenin öğrenciyi gerekçeyle engellemesi (Modül 5).
 *
 * Gönder düğmesi geçerlilikle KAPANMAZ (`__guards__/gonderDugmesi.test.ts`
 * kararı): eksik alan basınca alanın altında yazılır. Engel sürerken iki yön
 * de kapalıdır; öğrenci bu eğitmene yeni ders talebi de açamaz.
 */
export function EngelleModal({
  clientId,
  ogrenciAdi,
  onKapat,
  onEngellendi,
}: {
  clientId: number;
  ogrenciAdi: string;
  onKapat: () => void;
  /** Başarıdan sonra çağrılır (başlık engel durumunu hemen göstersin). */
  onEngellendi?: () => void;
}) {
  const [gerekce, setGerekce] = useState<BlockReason | null>(null);
  const [not, setNot] = useState("");
  const [hata, setHata] = useState<{ gerekce?: string; not?: string }>({});
  const engelle = useBlockClient();

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    const temizNot = not.trim();
    const yeniHata: typeof hata = {};
    if (!gerekce) yeniHata.gerekce = "Bir gerekçe seç.";
    if (gerekce === "OTHER" && temizNot.length < 3)
      yeniHata.not = "“Diğer” seçtiğinde kısa bir açıklama yaz.";
    if (temizNot.length > NOT_UST_SINIR)
      yeniHata.not = `Açıklama en fazla ${NOT_UST_SINIR} karakter olabilir.`;
    setHata(yeniHata);
    if (yeniHata.gerekce || yeniHata.not || !gerekce) return;

    engelle.mutate(
      { client_id: clientId, reason: gerekce, note: temizNot || null },
      {
        onSuccess: () => {
          toast.success("Öğrenci engellendi.");
          onEngellendi?.();
          onKapat();
        },
        // 409 ("zaten engelli") sunucu metniyle gösterilir.
        onError: (err) =>
          toast.error(
            err instanceof AxiosError && err.response?.status === 409
              ? getErrorDetail(err, "Öğrenci engellenemedi.")
              : getErrorMessage(err, "Öğrenci engellenemedi.")
          ),
      }
    );
  };

  return (
    <Modal
      open
      onClose={onKapat}
      title="Bu öğrenciyi engelle"
      description={`${ogrenciAdi} sana mesaj gönderemez ve yeni ders talebi açamaz. Mevcut dersler iptal edilmez. Engeli istediğin zaman kaldırabilirsin.`}
      maxWidth="max-w-lg"
    >
      <form onSubmit={gonder} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">Gerekçe</legend>
          <div className="mt-2 space-y-1">
            {GEREKCELER.map((g) => (
              <label
                key={g}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-800 transition hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="engel-gerekcesi"
                  value={g}
                  checked={gerekce === g}
                  onChange={() => {
                    setGerekce(g);
                    setHata((h) => ({ ...h, gerekce: undefined }));
                  }}
                  className="h-4 w-4 accent-marka"
                />
                {ENGEL_GEREKCESI[g]}
              </label>
            ))}
          </div>
          {hata.gerekce && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {hata.gerekce}
            </p>
          )}
        </fieldset>

        <Field label={gerekce === "OTHER" ? "Açıklama" : "Açıklama (isteğe bağlı)"}>
          {(id) => (
            <>
              <textarea
                id={id}
                value={not}
                onChange={(e) => setNot(e.target.value)}
                rows={3}
                maxLength={NOT_UST_SINIR}
                placeholder="Yalnız ekibimiz görür."
                aria-invalid={!!hata.not}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
              />
              <div className="mt-1 flex items-start justify-between gap-3">
                {hata.not ? (
                  <p role="alert" className="text-sm text-red-700">
                    {hata.not}
                  </p>
                ) : (
                  <span />
                )}
                <span className={`${KUCUK_ACIKLAMA} shrink-0 text-slate-400`}>
                  {not.length}/{NOT_UST_SINIR}
                </span>
              </div>
            </>
          )}
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" onClick={onKapat} className={DUGME_SATIR_IKINCIL}>
            Vazgeç
          </button>
          <button type="submit" disabled={engelle.isPending} className={DUGME_SATIR_TEHLIKE}>
            {engelle.isPending ? "Engelleniyor…" : "Engelle"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
