/**
 * Katılmadan önceki önizleme — Meet `Join` düzeni (La Suite Meet, MIT —
 * DINUM/Etalab), sade hâli: koyu yüzey, 16:9 aynalı kamera önizlemesi, üstte
 * ve altta gradyan, altta yuvarlak Mikrofon/Kamera düğmeleri, yanda (telefonda
 * altta) başlık ve "Derse katıl". Lobi, isim alanı ve cihaz seçimi yok
 * (cihaz seçimi Paket 2).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI } from "../stiller";
import { kameraHataAnahtari } from "../zoom/indirgeyiciler";
import { onizlemeBaslat, onizlemeDurdur } from "../zoom/onizleme";
import { MedyaDugmesi } from "./MedyaDugmeleri";

type KameraDurumu = "kapali" | "aciliyor" | "acik" | { hata: string };

export function OnIzleme({
  telefon,
  mikAcik,
  kameraAcik,
  onMik,
  onKamera,
  onKatil,
  onAyril,
  katiliyor,
  hata,
}: {
  telefon: boolean;
  mikAcik: boolean;
  kameraAcik: boolean;
  onMik: (ac: boolean) => void;
  onKamera: (ac: boolean) => void;
  onKatil: () => void;
  /** Telefonda üst şeritte çıkış yok; önizlemeden çıkış buradan. */
  onAyril?: () => void;
  katiliyor: boolean;
  hata: string | null;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [kamera, setKamera] = useState<KameraDurumu>(kameraAcik ? "aciliyor" : "kapali");

  useEffect(() => {
    const el = video.current;
    if (!kameraAcik || !el || katiliyor) {
      setKamera("kapali");
      return;
    }
    let gecerli = true;
    setKamera("aciliyor");
    onizlemeBaslat(el)
      .then(() => gecerli && setKamera("acik"))
      .catch((e: unknown) => gecerli && setKamera({ hata: kameraHataAnahtari(e) }));
    return () => {
      gecerli = false;
      void onizlemeDurdur();
    };
  }, [kameraAcik, katiliyor]);

  const ipucu =
    typeof kamera === "object"
      ? t(kamera.hata)
      : kamera === "aciliyor"
        ? t("join.cameraStarting")
        : kamera === "kapali"
          ? t("join.cameraDisabled")
          : null;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-ders-zemin text-white">
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-4 p-2 sm:gap-8 sm:p-4 lg:flex-row">
        <div className="flex w-full min-w-0 max-w-[764px] items-center justify-center lg:h-[540px] lg:flex-1">
          <div className="relative w-full min-w-0 overflow-hidden rounded-2xl sm:min-w-[320px]">
            <div className="relative aspect-video w-full">
              <div className="absolute inset-0 overflow-hidden bg-black">
                <video
                  ref={video}
                  autoPlay
                  playsInline
                  muted
                  aria-label={t(kamera === "acik" ? "join.cameraStarting" : "join.cameraDisabled")}
                  className={`absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
                    kamera === "acik" ? "opacity-100" : "opacity-0"
                  }`}
                />
                {ipucu && (
                  <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
                    <p className="text-balance text-base text-white sm:text-xl lg:text-2xl">{ipucu}</p>
                  </div>
                )}
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-20 bg-gradient-to-b from-black/60 via-black/20 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              <div className="absolute bottom-4 left-1/2 z-[2] flex -translate-x-1/2 gap-4">
                {/* Katılma sürerken tercih kilitli: görünen durum = derse girilen durum. */}
                <MedyaDugmesi
                  tur="mik"
                  gorunum="onizleme"
                  acik={mikAcik}
                  mesgul={katiliyor}
                  onDegistir={onMik}
                />
                <MedyaDugmesi
                  tur="kamera"
                  gorunum="onizleme"
                  acik={kameraAcik}
                  mesgul={katiliyor}
                  onDegistir={onKamera}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          className={`flex w-full flex-col items-center gap-4 text-center lg:w-ders-panel lg:flex-none ${
            telefon ? "pb-4" : ""
          }`}
        >
          <h2 className="text-2xl font-semibold">{t("join.heading")}</h2>
          <p className="text-sm text-white/70">
            {t("join.micHint", { durum: t(mikAcik ? "join.micOn" : "join.micOff") })}
          </p>
          <PlainButton
            onClick={onKatil}
            disabled={katiliyor}
            className={`${DUGME_TABANI} h-12 w-full max-w-xs rounded-ders bg-marka px-6 text-lg font-semibold text-marka-fg hover:bg-marka-hover`}
          >
            {katiliyor && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-marka-fg/30 border-t-marka-fg"
                aria-hidden
              />
            )}
            {t(katiliyor ? "join.joining" : "join.joinLabel")}
          </PlainButton>
          {telefon && onAyril && (
            <PlainButton
              onClick={onAyril}
              disabled={katiliyor}
              className={`${DUGME_TABANI} h-11 w-full max-w-xs rounded-ders bg-ders-dugme px-6 text-base text-white hover:bg-ders-hover`}
            >
              {t("controls.leave")}
            </PlainButton>
          )}
          {hata && (
            <p role="alert" className="max-w-xs text-sm text-ders-hata-fg">
              {t(hata)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
