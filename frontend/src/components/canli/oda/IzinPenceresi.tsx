/**
 * Kamera/mikrofon izni yönlendirmesi — Meet `Permissions` +
 * `SystemPermissions` (La Suite Meet, MIT — DINUM/Etalab). Adımlar işletim
 * sistemine ve tarayıcıya göre değişir; istenen izin verilince pencere
 * kendiliğinden kapanır (`izinDegisti`).
 *
 * Sitenin açık `Modal`ı kullanılır (Meet'in pencereleri de açık yüzeydir).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";
import { Modal } from "@/components/ui/Modal";
import {
  isletimSistemi,
  sistemAyarlariAdresi,
  tarayiciOrtami,
  tarayiciTuru,
  telefonMu,
} from "@/lib/canliDers";

import { DUGME_TABANI } from "../stiller";
import { izinPenceresiniAc, useIzinler, useIzinPenceresi } from "../zoom/odaDeposu";

type IzinEtiketi = "camera" | "microphone" | "cameraAndMicrophone";

const SISTEM_CIHAZI: Record<IzinEtiketi, "kamera" | "mikrofon" | "ikisi"> = {
  camera: "kamera",
  microphone: "mikrofon",
  cameraAndMicrophone: "ikisi",
};

export function IzinPenceresi({ onYenidenDene }: { onYenidenDene: () => void }) {
  const { t } = useTranslation();
  const acik = useIzinPenceresi();
  const izinler = useIzinler();

  const ortam = useMemo(() => {
    const o = tarayiciOrtami();
    const os = isletimSistemi(o.ua, o.dokunmatik);
    return { os, tarayici: tarayiciTuru(o.ua, os), telefon: telefonMu(o) };
  }, []);

  const kameraRed = izinler.kamera === "denied";
  const mikRed = izinler.mikrofon === "denied";
  // İzin durumu okunamıyorsa (Firefox/Safari) ikisi birden anlatılır.
  const etiket: IzinEtiketi =
    kameraRed && !mikRed ? "camera" : mikRed && !kameraRed ? "microphone" : "cameraAndMicrophone";

  const menuAdimi =
    ortam.os === "ios"
      ? t("permissionErrorDialog.body.openMenu.ios")
      : ortam.tarayici === "safari"
        ? t("permissionErrorDialog.body.openMenu.safari", { alan: window.location.host })
        : ortam.tarayici === "firefox"
          ? t("permissionErrorDialog.body.openMenu.firefox")
          : ortam.telefon
            ? t("permissionErrorDialog.body.openMenu.chromiumTelefon")
            : t("permissionErrorDialog.body.openMenu.chromium");

  const ayarAdresi = sistemAyarlariAdresi(ortam.os, SISTEM_CIHAZI[etiket]);
  const kapat = () => izinPenceresiniAc(false);

  return (
    <Modal
      open={acik}
      onClose={kapat}
      title={t(`permissionErrorDialog.heading.${etiket}`)}
      maxWidth="max-w-lg"
    >
      <ol className="list-decimal space-y-2 pl-6 text-base text-slate-700">
        <li>{menuAdimi}</li>
        <li>{t(`permissionErrorDialog.body.details.${etiket}`)}</li>
        <li>{t("permissionErrorDialog.body.retry")}</li>
      </ol>
      <PlainButton
        onClick={() => {
          kapat();
          onYenidenDene();
        }}
        className={`${DUGME_TABANI} mt-5 h-11 w-full rounded-ders bg-marka px-5 text-base font-semibold text-marka-fg hover:bg-marka-hover sm:w-auto`}
      >
        {t("permissionErrorDialog.retry")}
      </PlainButton>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="text-base font-semibold text-slate-900">
          {t("systemPermissionDialog.heading")}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {t("systemPermissionDialog.intro", {
            device: t(`systemPermissionDialog.device.${etiket}`),
          })}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {t(`systemPermissionDialog.steps.${ortam.os}`)}
        </p>
        {ayarAdresi && (
          <a
            href={ayarAdresi}
            className={`${DUGME_TABANI} mt-3 h-10 rounded-ders bg-slate-100 px-4 text-sm text-slate-900 hover:bg-slate-200`}
          >
            {t("systemPermissionDialog.openSettings")}
          </a>
        )}
      </div>
    </Modal>
  );
}
