/**
 * Tahta izin pencereleri (`lib/tahtaIzin.ts` kuralları):
 *
 * - `PdfYeriPenceresi`: PDF'i açan taraf (öğretmen ya da tam yetkili
 *   öğrenci) yeri seçer — "Yeni sayfalarda aç" (varsayılan) / "Bu sayfada aç".
 * - `IzinIstegiPenceresi`: öğretmende, öğrencinin isteği (çizim değişikliği
 *   ya da PDF açma). Kapatmak (X/Esc) reddetmektir: öğrenci yanıt bekler.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import type { PdfYeri } from "@/lib/tahtaSenkron";

const IKINCIL =
  "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const BIRINCIL =
  "rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg hover:bg-marka-hover";

export function PdfYeriPenceresi({
  dosya,
  onSec,
  onVazgec,
}: {
  /** Açık pencerede seçilen dosyanın adı; `null` kapalı. */
  dosya: string | null;
  onSec: (yer: PdfYeri) => void;
  onVazgec: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={dosya !== null}
      onClose={onVazgec}
      title={t("tahta.pdfAc.baslik")}
      description={dosya ?? undefined}
    >
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <PlainButton onClick={onVazgec} className={IKINCIL}>
          {t("tahta.pdfAc.vazgec")}
        </PlainButton>
        <PlainButton onClick={() => onSec("bu")} className={IKINCIL}>
          {t("tahta.pdfAc.buSayfada")}
        </PlainButton>
        <PlainButton onClick={() => onSec("yeni")} className={BIRINCIL}>
          {t("tahta.pdfAc.yeniSayfalarda")}
        </PlainButton>
      </div>
    </Modal>
  );
}

export type GelenIstek =
  | { k: string; tur: "degisiklik"; sayi: number }
  | { k: string; tur: "pdf"; dosya: string };

export function IzinIstegiPenceresi({
  istek,
  ad,
  onDegisiklik,
  onPdf,
}: {
  istek: GelenIstek | null;
  /** Öğrencinin adı. */
  ad: string;
  onDegisiklik: (karar: "onay" | "ret" | "tam") => void;
  onPdf: (karar: PdfYeri | "ret", tam: boolean) => void;
}) {
  const { t } = useTranslation();
  const [tam, setTam] = useState(false);
  // Her yeni istekte kutu boşalır.
  const [gorulen, setGorulen] = useState<string | null>(null);
  if (istek && istek.k !== gorulen) {
    setGorulen(istek.k);
    setTam(false);
  }

  const reddet = () => {
    if (!istek) return;
    if (istek.tur === "pdf") onPdf("ret", false);
    else onDegisiklik("ret");
  };

  return (
    <Modal
      open={istek !== null}
      onClose={reddet}
      title={
        istek?.tur === "pdf"
          ? t("tahta.izin.pdfIstegi", { ad, dosya: istek.dosya })
          : t("tahta.izin.degisiklikIstegi", { ad, n: istek?.sayi ?? 0 })
      }
    >
      {istek?.tur === "pdf" ? (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={tam}
              onChange={(e) => setTam(e.target.checked)}
              className="h-4 w-4"
            />
            {t("tahta.izin.tamYetki")}
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <PlainButton onClick={() => onPdf("ret", false)} className={IKINCIL}>
              {t("tahta.izin.reddet")}
            </PlainButton>
            <PlainButton onClick={() => onPdf("bu", tam)} className={IKINCIL}>
              {t("tahta.pdfAc.buSayfada")}
            </PlainButton>
            <PlainButton onClick={() => onPdf("yeni", tam)} className={BIRINCIL}>
              {t("tahta.pdfAc.yeniSayfalarda")}
            </PlainButton>
          </div>
        </>
      ) : (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <PlainButton onClick={() => onDegisiklik("ret")} className={IKINCIL}>
            {t("tahta.izin.reddet")}
          </PlainButton>
          <PlainButton onClick={() => onDegisiklik("tam")} className={IKINCIL}>
            {t("tahta.izin.tamYetki")}
          </PlainButton>
          <PlainButton onClick={() => onDegisiklik("onay")} className={BIRINCIL}>
            {t("tahta.izin.izinVer")}
          </PlainButton>
        </div>
      )}
    </Modal>
  );
}
