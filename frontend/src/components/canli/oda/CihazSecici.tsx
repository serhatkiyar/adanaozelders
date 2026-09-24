/**
 * Cihaz seçici — Meet `SelectDevice` + `OutputSoundTester` (La Suite Meet,
 * MIT — DINUM/Etalab). react-aria listbox yerine yerel `<select>`: klavye,
 * ekran okuyucu ve telefonun kendi seçim ekranı hazır gelir.
 *
 * İki görünüm: `koyu` (önizleme ve oda menüsü) ve `acik` (Ayarlar penceresi,
 * sitenin açık Modal'ı içinde). Tema değil, yüzeye göre iki sınıf takımı.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI } from "../stiller";
import type { Cihaz, CihazTuru } from "../zoom/indirgeyiciler";
import { hoparloruDene } from "../zoom/onizleme";

export type SeciciGorunumu = "koyu" | "acik";

const KIND: Record<CihazTuru, string> = {
  mikrofon: "audioinput",
  hoparlor: "audiooutput",
  kamera: "videoinput",
};

const IKON: Record<CihazTuru, IconName> = {
  mikrofon: "mic",
  hoparlor: "speaker",
  kamera: "video",
};

const SELECT: Record<SeciciGorunumu, string> = {
  koyu: "border-ders-cizgi bg-ders-dugme text-white hover:border-ders-hover",
  acik: "border-slate-300 bg-white text-slate-900 hover:border-slate-500",
};

export function CihazSecici({
  tur,
  cihazlar,
  secili,
  onSec,
  gorunum = "koyu",
  bosMetin,
  etiket,
}: {
  tur: CihazTuru;
  cihazlar: readonly Cihaz[];
  secili: string | undefined;
  onSec: (id: string) => void;
  gorunum?: SeciciGorunumu;
  /** Liste boşken (izin yok / cihaz yok) görünen metin. */
  bosMetin?: string;
  /** Görünür etiket yoksa erişilebilir ad; verilmezse "…seç". */
  etiket?: string;
}) {
  const { t } = useTranslation();
  const bos = cihazlar.length === 0;
  const ad = etiket ?? t(`selectDevice.${KIND[tur]}.choose`);
  return (
    <div className="relative w-full min-w-0">
      <span
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${
          gorunum === "koyu" ? "text-white/80" : "text-slate-500"
        }`}
        aria-hidden
      >
        <Icon name={IKON[tur]} className="h-5 w-5" />
      </span>
      <select
        aria-label={ad}
        title={ad}
        disabled={bos}
        value={bos ? "" : (secili ?? cihazlar[0]?.id ?? "")}
        onChange={(e) => onSec(e.target.value)}
        className={`h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-ders border pl-10 pr-9 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marka-focus disabled:cursor-default disabled:opacity-60 ${SELECT[gorunum]}`}
      >
        {bos ? (
          <option value="">{bosMetin ?? t("selectDevice.permissionsNeeded")}</option>
        ) : (
          cihazlar.map((c) => (
            <option key={c.id} value={c.id}>
              {c.ad}
            </option>
          ))
        )}
      </select>
      <span
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-180 ${
          gorunum === "koyu" ? "text-white/80" : "text-slate-500"
        }`}
        aria-hidden
      >
        <Icon name="chevronUp" className="h-4 w-4" />
      </span>
    </div>
  );
}

const TEST_SURESI_MS = 4000;

/**
 * Hoparlör testi: Zoom'un örnek sesini seçili hoparlörden çalar, birkaç
 * saniye sonra (ya da bileşen kalkınca) durdurur. Mikrofon açılmaz.
 */
export function HoparlorTesti({
  hoparlorId,
  gorunum = "koyu",
  etiket,
  caliyorEtiketi,
}: {
  hoparlorId: string | undefined;
  gorunum?: SeciciGorunumu;
  etiket?: string;
  caliyorEtiketi?: string;
}) {
  const { t } = useTranslation();
  const [caliyor, setCaliyor] = useState(false);
  const durdur = useRef<(() => void) | null>(null);
  const zamanlayici = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(zamanlayici.current);
      durdur.current?.();
    },
    [],
  );

  const baslat = () => {
    const dur = hoparloruDene(hoparlorId);
    if (!dur) return;
    durdur.current = dur;
    setCaliyor(true);
    zamanlayici.current = window.setTimeout(() => {
      dur();
      durdur.current = null;
      setCaliyor(false);
    }, TEST_SURESI_MS);
  };

  return (
    <PlainButton
      onClick={baslat}
      disabled={caliyor}
      aria-live="polite"
      className={`${DUGME_TABANI} h-10 w-full rounded-ders px-3 text-sm ${
        gorunum === "koyu"
          ? "text-white hover:bg-ders-dugme"
          : "text-slate-800 hover:bg-slate-100"
      }`}
    >
      <Icon name="speaker" className="h-5 w-5" />
      {caliyor
        ? (caliyorEtiketi ?? t("selectDevice.audiooutput.testing"))
        : (etiket ?? t("selectDevice.audiooutput.test"))}
    </PlainButton>
  );
}
