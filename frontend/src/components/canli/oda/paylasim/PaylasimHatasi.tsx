/**
 * Ekran paylaşımı izin hatası — Meet `ScreenShareErrorModal` (La Suite
 * Meet, MIT — DINUM/Etalab). Yalnız izin/sistem reddinde açılır; seçiciden
 * vazgeçmek sessizdir (`paylasimHatasiTuru`). Meet'in yardım bağlantısı
 * (Crisp) taşınmadı; işletim sistemine göre ekran kaydı ayarı bağlantısı
 * korunur.
 *
 * Sitenin açık `Modal`ı kullanılır (IzinPenceresi ile aynı).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";
import { ekranKaydiAyarAdresi, isletimSistemi, tarayiciOrtami } from "@/lib/canliDers";

import { DUGME_TABANI } from "../../stiller";

export function PaylasimHatasi({ acik, onKapat }: { acik: boolean; onKapat: () => void }) {
  const { t } = useTranslation();
  const os = useMemo(() => {
    const o = tarayiciOrtami();
    return isletimSistemi(o.ua, o.dokunmatik);
  }, []);
  const ayarAdresi = ekranKaydiAyarAdresi(os);

  return (
    <Modal
      open={acik}
      onClose={onKapat}
      title={t("error.screenShare.title")}
      ariaLabel={t("error.screenShare.title")}
      maxWidth="max-w-md"
    >
      <p role="alert" className="text-base text-slate-700">
        {t("error.screenShare.message")}
      </p>
      {ayarAdresi && (os === "macos" || os === "windows") && (
        <p className="mt-3 text-sm text-slate-600">
          {t("error.screenShare.settingsInstructions")}{" "}
          <a href={ayarAdresi} className="font-medium text-marka-metin underline hover:text-marka-metin-hover">
            {t(`error.screenShare.settingsLabel.${os}`)}
          </a>
          . {t("error.screenShare.retryHint")}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <PlainButton
          onClick={onKapat}
          className={`${DUGME_TABANI} h-10 rounded-ders bg-marka px-5 text-sm font-semibold text-marka-fg hover:bg-marka-hover`}
        >
          {t("error.screenShare.closeButton")}
        </PlainButton>
      </div>
    </Modal>
  );
}
