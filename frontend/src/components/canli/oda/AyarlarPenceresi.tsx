/**
 * Ders içi Ayarlar — Meet `SettingsDialogExtended` yalnız Ses ve Görüntü
 * sekmeleriyle (La Suite Meet, MIT — DINUM/Etalab). Sitenin açık `Modal`ı
 * içinde; geniş ekranda solda dikey sekme rayı, telefonda üstte yatay.
 *
 * Görüntü sekmesinde Meet'teki küçük ikinci kamera önizlemesi YOK: aynı
 * kamerayı ikinci kez açmak telefonda VIDEO_CAMERA_IS_TAKEN verir.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { Modal } from "@/components/ui/Modal";

import { gorunenCihazId, odaSeviyeOrani } from "../zoom/indirgeyiciler";
import { aynala, hoparlorSecilebilir } from "../zoom/istemci";
import {
  useBen,
  useCihazlar,
  useOdaDeposu,
  useSeciliCihazlar,
  useSesSeviyesi,
} from "../zoom/odaDeposu";
import { tercihleriOku } from "../zoom/tercihler";
import { cihazDegistir } from "../zoom/useMedyaKontrolleri";
import { CihazSecici, HoparlorTesti } from "./CihazSecici";
import { SesSeviyesi } from "./SesSeviyesi";

export type AyarSekmesi = "ses" | "goruntu";

const SEKMELER: Array<{ id: AyarSekmesi; ikon: IconName; anahtar: string }> = [
  { id: "ses", ikon: "speaker", anahtar: "settings.tabs.audio" },
  { id: "goruntu", ikon: "video", anahtar: "settings.tabs.video" },
];

export function AyarlarPenceresi({
  acik,
  sekme,
  onSekme,
  onKapat,
}: {
  acik: boolean;
  sekme: AyarSekmesi;
  onSekme: (s: AyarSekmesi) => void;
  onKapat: () => void;
}) {
  const { t } = useTranslation();
  const kok = useId();
  const sekmeler = useRef<Array<HTMLButtonElement | null>>([]);

  // Meet `Tabs`: ok tuşlarıyla sekmeler arasında dolaşma (dolaşan tabindex).
  const tus = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SEKMELER.findIndex((s) => s.id === sekme);
    const ileri = e.key === "ArrowDown" || e.key === "ArrowRight";
    const geri = e.key === "ArrowUp" || e.key === "ArrowLeft";
    if (!ileri && !geri) return;
    e.preventDefault();
    const j = (i + (ileri ? 1 : SEKMELER.length - 1)) % SEKMELER.length;
    onSekme(SEKMELER[j].id);
    sekmeler.current[j]?.focus();
  };

  return (
    <Modal
      open={acik}
      onClose={onKapat}
      title={t("settings.dialog.heading")}
      maxWidth="max-w-3xl"
    >
      <div className="flex min-h-[20rem] flex-col gap-4 sm:flex-row sm:gap-6">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("settings.dialog.heading")}
          onKeyDown={tus}
          className="flex shrink-0 gap-1 border-b border-slate-200 pb-2 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4"
        >
          {SEKMELER.map((s, i) => {
            const secili = s.id === sekme;
            return (
              <PlainButton
                key={s.id}
                ref={(el) => {
                  sekmeler.current[i] = el;
                }}
                role="tab"
                id={`${kok}-sekme-${s.id}`}
                aria-selected={secili}
                aria-controls={`${kok}-panel-${s.id}`}
                tabIndex={secili ? 0 : -1}
                onClick={() => onSekme(s.id)}
                className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marka-focus ${
                  secili ? "bg-marka/15 text-slate-900" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon name={s.ikon} className="h-5 w-5" />
                {t(s.anahtar)}
              </PlainButton>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${kok}-panel-${sekme}`}
          aria-labelledby={`${kok}-sekme-${sekme}`}
          className="min-w-0 flex-1"
        >
          {sekme === "ses" ? <SesSekmesi /> : <GoruntuSekmesi />}
        </div>
      </div>
    </Modal>
  );
}

/** Meet `RowWrapper`: başlık, solda denetim, sağda durum. */
function Satir({
  baslik,
  children,
  yan,
}: {
  baslik: string;
  children: ReactNode;
  yan?: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-base font-semibold text-slate-900">{baslik}</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">{children}</div>
        {yan && <div className="min-w-0 sm:w-44 sm:shrink-0">{yan}</div>}
      </div>
    </section>
  );
}

function SesSekmesi() {
  const { t } = useTranslation();
  const cihazlar = useCihazlar();
  const secili = useSeciliCihazlar();
  const seviye = useSesSeviyesi();
  const ben = useBen();
  const mikAcik = Boolean(ben && !ben.mikKapali);

  return (
    <>
      <Satir
        baslik={t("settings.audio.microphone.heading")}
        yan={
          <SesSeviyesi
            gorunum="acik"
            oran={mikAcik ? odaSeviyeOrani(seviye) : null}
            kapaliMetni={t("settings.audio.microphone.disabled")}
          />
        }
      >
        <CihazSecici
          tur="mikrofon"
          gorunum="acik"
          etiket={t("settings.audio.microphone.label")}
          cihazlar={cihazlar.mikrofon}
          secili={gorunenCihazId(secili.mikrofon, cihazlar.mikrofon)}
          onSec={(id) => void cihazDegistir("mikrofon", id)}
          bosMetin={t("settings.audio.permissionsRequired")}
        />
      </Satir>
      {hoparlorSecilebilir() ? (
        <Satir
          baslik={t("settings.audio.speakers.heading")}
          yan={
            <HoparlorTesti
              gorunum="acik"
              hoparlorId={secili.hoparlor}
              etiket={t("settings.audio.speakers.test")}
              caliyorEtiketi={t("settings.audio.speakers.ongoingTest")}
            />
          }
        >
          <CihazSecici
            tur="hoparlor"
            gorunum="acik"
            etiket={t("settings.audio.speakers.label")}
            cihazlar={cihazlar.hoparlor}
            secili={gorunenCihazId(secili.hoparlor, cihazlar.hoparlor)}
            onSec={(id) => void cihazDegistir("hoparlor", id)}
            bosMetin={t("settings.audio.permissionsRequired")}
          />
        </Satir>
      ) : (
        <Satir baslik={t("settings.audio.speakers.heading")}>
          <p className="text-sm text-amber-800">{t("settings.audio.speakers.safariWarning")}</p>
        </Satir>
      )}
    </>
  );
}

function GoruntuSekmesi() {
  const { t } = useTranslation();
  const cihazlar = useCihazlar();
  const secili = useSeciliCihazlar();
  const ben = useBen();
  const kameraAcik = Boolean(ben?.videoAcik);
  const [ayna, setAyna] = useState(() => tercihleriOku().ayna);
  const ipucuId = useId();

  const aynayiDegistir = async () => {
    const yeni = !ayna;
    setAyna(yeni);
    try {
      await aynala(yeni);
    } catch (e) {
      console.warn("Zoom mirrorVideo", e);
      useOdaDeposu.setState({ hata: "media.deviceError" });
    }
  };

  return (
    <>
      <Satir
        baslik={t("settings.video.camera.heading")}
        yan={
          <p role="status" className="text-sm text-slate-600">
            {t(kameraAcik ? "settings.video.camera.enabled" : "settings.video.camera.disabled")}
          </p>
        }
      >
        <CihazSecici
          tur="kamera"
          gorunum="acik"
          etiket={t("settings.video.camera.label")}
          cihazlar={cihazlar.kamera}
          secili={gorunenCihazId(secili.kamera, cihazlar.kamera)}
          onSec={(id) => void cihazDegistir("kamera", id)}
          bosMetin={t("settings.video.permissionsRequired")}
        />
      </Satir>
      <Satir baslik={t("settings.video.mirror.heading")}>
        <PlainButton
          role="switch"
          aria-checked={ayna}
          aria-describedby={ipucuId}
          onClick={() => void aynayiDegistir()}
          className="inline-flex items-center gap-3 rounded-ders py-1 text-left text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marka-focus"
        >
          <span
            aria-hidden
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
              ayna ? "bg-marka" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                ayna ? "translate-x-[1.375rem]" : "translate-x-0.5"
              }`}
            />
          </span>
          {t("settings.video.mirror.label")}
        </PlainButton>
        <p id={ipucuId} className="mt-1 text-xs text-slate-500">
          {t("settings.video.mirror.hint")}
        </p>
      </Satir>
    </>
  );
}
