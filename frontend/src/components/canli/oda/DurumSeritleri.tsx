/**
 * Sahnenin üstündeki durum şeritleri: "yeniden bağlanılıyor", tarayıcı
 * sesi engellediğinde "Sesi aç" ve cihaz hatası. Meet
 * `ConnectionStateToast` / `StartMediaButton` karşılığı (La Suite Meet, MIT —
 * DINUM/Etalab).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI } from "../stiller";
import { sesiAc } from "../zoom/istemci";
import { useBaglanti, useOdaDeposu, useOdaHatasi, useSesEngellendi } from "../zoom/odaDeposu";

export function DurumSeritleri({ mikTercihi }: { mikTercihi: boolean }) {
  const { t } = useTranslation();
  const baglanti = useBaglanti();
  const engellendi = useSesEngellendi();
  const hata = useOdaHatasi();
  const [aciliyor, setAciliyor] = useState(false);

  const sesiBaslat = async () => {
    setAciliyor(true);
    try {
      await sesiAc(mikTercihi);
    } catch (e) {
      console.warn("Zoom startAudio", e);
      useOdaDeposu.setState({ hata: "media.deviceError" });
    } finally {
      setAciliyor(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-4">
      {baglanti === "yenidenBaglaniyor" && (
        <p
          role="status"
          className="inline-flex items-center gap-2 rounded-full bg-ders-yuzey/95 px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ders-cizgi border-t-white" aria-hidden />
          {t("connection.reconnecting")}
        </p>
      )}
      {engellendi && (
        <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-ders bg-ders-yuzey/95 p-2 pl-4 text-sm text-white shadow-lg">
          <p className="min-w-0 flex-1">{t("media.startAudioHint")}</p>
          <PlainButton
            onClick={() => void sesiBaslat()}
            disabled={aciliyor}
            className={`${DUGME_TABANI} h-10 rounded bg-marka px-4 text-marka-fg hover:bg-marka-hover`}
          >
            <Icon name="speaker" className="h-5 w-5" />
            {t("media.startAudio")}
          </PlainButton>
        </div>
      )}
      {hata && (
        <div
          role="alert"
          className="pointer-events-auto flex max-w-md items-center gap-2 rounded-ders bg-ders-hata px-4 py-2 text-sm text-ders-hata-fg shadow-lg"
        >
          <p className="min-w-0 flex-1">{t(hata)}</p>
          <PlainButton
            onClick={() => useOdaDeposu.setState({ hata: null })}
            aria-label="Uyarıyı kapat"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-ders-hata-hover"
          >
            <Icon name="dismiss" className="h-4 w-4" />
          </PlainButton>
        </div>
      )}
    </div>
  );
}
