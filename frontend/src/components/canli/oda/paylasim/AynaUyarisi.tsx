/**
 * Tüm ekranı paylaşırken sonsuz yansıma uyarısı — Meet
 * `FullScreenShareWarning` (La Suite Meet, MIT — DINUM/Etalab): kendi
 * paylaşımımın üstünde %90 koyu katman, "Sunumu durdur" ve "Yoksay".
 * "Yoksay" bu ders boyunca geçerlidir (Meet'te de kalıcı değil).
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../../stiller";

export function AynaUyarisi({
  onDurdur,
  onYoksay,
}: {
  onDurdur: () => void;
  onYoksay: () => void;
}) {
  const { t } = useTranslation();
  const durdur = useRef<HTMLButtonElement>(null);

  // Meet `autoFocus`: uyarı çıkınca odak "Sunumu durdur"a.
  useEffect(() => {
    durdur.current?.focus();
  }, []);

  const tus = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onYoksay();
    }
  };

  return (
    <div className="absolute inset-0 z-10 bg-ders-zemin/90 p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row">
        <p role="alert" className="basis-[55%] text-pretty font-medium text-white">
          {t("fullScreenWarning.message")}
        </p>
        <div className="flex h-fit gap-4">
          <PlainButton
            ref={durdur}
            onClick={onDurdur}
            onKeyDown={tus}
            className={`${DUGME_TABANI} h-9 rounded-ders bg-white px-3 text-sm text-ders-zemin hover:bg-white/90`}
          >
            {t("fullScreenWarning.stop")}
          </PlainButton>
          <PlainButton
            onClick={onYoksay}
            onKeyDown={tus}
            className={`${DUGME_TABANI} h-9 rounded-ders px-3 text-sm ${ODA_DUGMESI.metin}`}
          >
            {t("fullScreenWarning.ignore")}
          </PlainButton>
        </div>
      </div>
    </div>
  );
}
