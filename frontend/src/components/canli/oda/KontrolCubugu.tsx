/**
 * Masaüstü kontrol çubuğu — Meet `DesktopControlBar` + `ControlBarRegion` +
 * `MoreOptions` (La Suite Meet, MIT — DINUM/Etalab): 80px, üç bölge.
 * Sol boş. Orta: Mikrofon▴ · Kamera▴ · Tepki · Ekran paylaş · El kaldır ·
 * ⋯ · kırmızı Ayrıl (Meet'teki Altyazı bizde yok; Tepki ve El yalnız Zoom
 * command channel varsa). Sağ: Sohbet · Katılımcılar (Meet
 * `NavigationControls` sırası; Bilgi/Araçlar/Yönetici yok); çubuk ≤1050px
 * olunca tek ▲ düğmesine toplanır (Meet `LateralMenu`). Ayrıl, sayfanın ONAYLI
 * çıkış penceresini açar; ders karşı taraf için sürer.
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { useOdaDeposu } from "../zoom/odaDeposu";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { Acilir } from "./Acilir";
import type { AyarSekmesi } from "./AyarlarPenceresi";
import { CihazMenusu } from "./CihazMenusu";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { PaylasimDugmesi } from "./PaylasimDugmesi";
import { ElDugmesi, TepkiDugmesi } from "./Tepkiler";
import type { PanelTuru } from "./YanPanel";

/**
 * Araçlar (Preply `btn-open-tools`): yalnız öğretmende — öğrencinin Preply
 * araç menüsündeki öğeler (Kelimeler/Notlar/Ödev) bizde yok, menü boş kalırdı.
 */
export interface AracDenetimi {
  tahtaAcik: boolean;
  onTahtaAc: () => void;
  /** Kapatma onayı ("öğrenci için de kapanacak") çağıranda. */
  onTahtaKapat: () => void;
}

/** Yan panel düğmelerinin ortak girdisi (masaüstü ve telefon çubuğu). */
export interface PanelDenetimi {
  panel: PanelTuru | null;
  onPanel: (tur: PanelTuru) => void;
  /** Ders içi sohbet var mı (ders bilgisi yüklenmediyse yok). */
  sohbetVar: boolean;
  okunmamis: number;
  /** Sohbet ipucu: "{ad} ile sohbet" (Preply `tooltip_chat`). */
  karsiAd: string;
}

export function KontrolCubugu({
  onAyril,
  onAyarlar,
  panel,
  arac,
}: {
  onAyril?: () => void;
  onAyarlar: (sekme: AyarSekmesi) => void;
  panel: PanelDenetimi;
  arac?: AracDenetimi;
}) {
  const { t } = useTranslation();
  const m = useMedyaKontrolleri();
  const cubuk = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={cubuk}
      className="flex h-ders-cubuk w-full shrink-0 items-center bg-ders-zemin px-[1.125rem]"
    >
      <div className="flex flex-1 basis-1/3" />
      <div
        role="region"
        aria-label={t("controls.region")}
        className="flex flex-1 basis-1/3 items-center justify-center gap-[0.65rem]"
      >
        <div className="flex gap-px">
          <MedyaDugmesi
            tur="mik"
            gorunum="oda"
            grup
            acik={m.mikAcik}
            mesgul={m.mesgul === "mik"}
            onDegistir={(ac) => void m.mikDegistir(ac)}
          />
          <CihazMenusu tur="mik" acik={m.mikAcik} onAyarlar={onAyarlar} />
        </div>
        <div className="flex gap-px">
          <MedyaDugmesi
            tur="kamera"
            gorunum="oda"
            grup
            acik={m.kameraAcik}
            mesgul={m.mesgul === "kamera"}
            onDegistir={(ac) => void m.kameraDegistir(ac)}
          />
          <CihazMenusu tur="kamera" acik={m.kameraAcik} onAyarlar={onAyarlar} />
        </div>
        <TepkiDugmesi />
        {arac && <AraclarDugmesi {...arac} />}
        <PaylasimDugmesi />
        <ElDugmesi />
        <SecenekMenusu onAyarlar={() => onAyarlar("ses")} />
        {onAyril && (
          <PlainButton
            onClick={onAyril}
            aria-label={t("controls.leave")}
            title={t("controls.leave")}
            className={`${DUGME_TABANI} h-[46px] min-w-[46px] rounded px-4 ${ODA_DUGMESI.tehlike}`}
          >
            <Icon name="callEnd" className="h-6 w-6" />
          </PlainButton>
        )}
      </div>
      <SagBolge cubuk={cubuk} {...panel} />
    </div>
  );
}

/** Meet `MoreOptions` eşikleri: >1100 geniş, ≤1050 dar, arası öncekini korur. */
const CUBUK_GENIS = 1100;
const CUBUK_DAR = 1050;

/** Meet `BreakpointObserver`: çubuğun (pencerenin değil) genişliği. */
function useCubukGenisMi(cubuk: RefObject<HTMLDivElement | null>): boolean | null {
  const [genis, setGenis] = useState<boolean | null>(null);
  useEffect(() => {
    const el = cubuk.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const olc = (w: number) => {
      if (!w) return;
      if (w > CUBUK_GENIS) setGenis(true);
      else if (w <= CUBUK_DAR) setGenis(false);
      else setGenis((g) => (g === null ? false : g));
    };
    olc(el.getBoundingClientRect().width);
    const g = new ResizeObserver(([k]) => olc(k.contentRect.width));
    g.observe(el);
    return () => g.disconnect();
  }, [cubuk]);
  return genis;
}

/** Meet `MoreOptions`: geniş çubukta düğmeler, darda tek ok (`LateralMenu`). */
function SagBolge({
  cubuk,
  ...panel
}: PanelDenetimi & { cubuk: RefObject<HTMLDivElement | null> }) {
  const genis = useCubukGenisMi(cubuk);
  return (
    <nav className="flex flex-1 basis-1/3 items-center justify-end gap-2 pr-1">
      {genis !== null && (genis ? <GezinmeDugmeleri {...panel} /> : <YanMenu {...panel} />)}
    </nav>
  );
}

/** Meet `LateralMenu`: ▲/▼ ok, açılır dikey kutuda Sohbet + Katılımcılar. */
function YanMenu(panel: PanelDenetimi) {
  const { t } = useTranslation();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const kapat = () => setAcik(false);
  return (
    <div className="relative">
      <PlainButton
        ref={dugme}
        onClick={() => setAcik((a) => !a)}
        aria-label={t("controls.moreOptions")}
        title={t("controls.moreOptions")}
        aria-haspopup="dialog"
        aria-expanded={acik}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${ODA_DUGMESI.acik}`}
      >
        <Icon name={acik ? "chevronDown" : "chevronUp"} className="h-6 w-6" />
      </PlainButton>
      <Acilir acik={acik} onKapat={kapat} tetikleyici={dugme} etiket={t("controls.moreOptions")}>
        <div className="flex w-[65px] flex-col items-center gap-2 pt-2.5">
          <GezinmeDugmeleri {...panel} onSecildi={kapat} />
        </div>
      </Acilir>
    </div>
  );
}

/**
 * Meet `NavigationControls` sırası: Sohbet, Katılımcılar (Bilgi, Araçlar,
 * Yönetici bizde yok). Sohbet düğmesi Preply'daki gibi: adı "Sohbet", açıkken
 * ters renk + dolu balon, okunmamışta köşede yalnız 14px kırmızı nokta.
 */
function GezinmeDugmeleri({
  panel,
  onPanel,
  sohbetVar,
  okunmamis,
  karsiAd,
  onSecildi,
}: PanelDenetimi & { onSecildi?: () => void }) {
  const { t } = useTranslation();
  const sayi = useOdaDeposu((d) => d.katilimcilar.length);
  const sayiId = useId();
  const okunmamisId = useId();
  const katilimciAcik = panel === "katilimcilar";
  const sohbetAcik = panel === "sohbet";
  const noktaVar = okunmamis > 0 && !sohbetAcik;

  return (
    <>
      {sohbetVar && (
        <div className="relative inline-block">
          <PlainButton
            onClick={() => {
              onPanel("sohbet");
              onSecildi?.();
            }}
            aria-label={t("controls.chat.label")}
            title={t("controls.chat.tooltip", { name: karsiAd })}
            aria-describedby={noktaVar ? okunmamisId : undefined}
            aria-pressed={sohbetAcik}
            className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
              sohbetAcik ? ODA_DUGMESI.secili : ODA_DUGMESI.metin
            }`}
          >
            <Icon name={sohbetAcik ? "chatFilled" : "chat"} className="h-6 w-6" />
          </PlainButton>
          {noktaVar && <OkunmamisNoktasi id={okunmamisId} />}
        </div>
      )}
      <div className="relative inline-block">
        <PlainButton
          onClick={() => {
            onPanel("katilimcilar");
            onSecildi?.();
          }}
          aria-label={t(`controls.participants.${katilimciAcik ? "open" : "closed"}`)}
          title={t(`controls.participants.${katilimciAcik ? "open" : "closed"}`)}
          aria-describedby={sayiId}
          aria-pressed={katilimciAcik}
          className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
            katilimciAcik ? ODA_DUGMESI.secili : ODA_DUGMESI.metin
          }`}
        >
          <Icon name="people" className="h-6 w-6" />
        </PlainButton>
        <span id={sayiId} className="sr-only">
          {t("controls.participants.count", { count: sayi })}
        </span>
        {sayi > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] select-none items-center justify-center rounded-full bg-slate-500 px-1 text-xs text-white"
          >
            {sayi}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * Preply `Dot`: 14px `#F65E55`, köşeden -6px, 3px zemin rengi kenar ("kesik"
 * görünüm). Sayı yok; ekran okuyucuya yalnız "Okunmamış mesaj var".
 */
export function OkunmamisNoktasi({ id }: { id?: string }) {
  const { t } = useTranslation();
  return (
    <>
      {id && (
        <span id={id} className="sr-only">
          {t("controls.chat.unread")}
        </span>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 box-content h-3.5 w-3.5 rounded-full border-[3px] border-ders-zemin bg-[#F65E55]"
      />
    </>
  );
}

/** Meet `OptionsButton` → yalnız Ayarlar. */
function SecenekMenusu({ onAyarlar }: { onAyarlar: () => void }) {
  const { t } = useTranslation();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const kapat = () => setAcik(false);
  const oge = `${DUGME_TABANI} h-11 w-full justify-start rounded-ders px-3 text-sm ${ODA_DUGMESI.metin}`;

  return (
    <div className="relative">
      <PlainButton
        ref={dugme}
        onClick={() => setAcik((a) => !a)}
        aria-label={t("options.buttonLabel")}
        title={t("options.buttonLabel")}
        aria-haspopup="dialog"
        aria-expanded={acik}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${ODA_DUGMESI.acik}`}
      >
        <Icon name="moreHorizontal" className="h-6 w-6" />
      </PlainButton>
      <Acilir acik={acik} onKapat={kapat} tetikleyici={dugme} etiket={t("options.buttonLabel")}>
        <div className="flex w-56 flex-col">
          <PlainButton
            onClick={() => {
              kapat();
              onAyarlar();
            }}
            className={oge}
          >
            <Icon name="settings" className="h-5 w-5" />
            {t("options.items.settings")}
          </PlainButton>
        </div>
      </Acilir>
    </div>
  );
}

/**
 * Preply "Araçlar": yukarı açılan menü. Tahta kapalıyken "Beyaz tahta";
 * açıkken o öğe kalkar, yerine kırmızı "Beyaz tahtayı kapat" gelir. Tahta
 * açıkken düğme dolu (beyaz zemin + dolu ikon).
 */
export function AraclarDugmesi({ tahtaAcik, onTahtaAc, onTahtaKapat }: AracDenetimi) {
  const { t } = useTranslation();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const kapat = () => setAcik(false);
  const oge = `${DUGME_TABANI} h-11 w-full justify-start rounded-ders px-3 text-sm`;
  return (
    <div className="relative">
      <PlainButton
        ref={dugme}
        onClick={() => setAcik((a) => !a)}
        aria-label={t("araclarMenu.dugme")}
        title={t("araclarMenu.dugme")}
        aria-haspopup="dialog"
        aria-expanded={acik}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${tahtaAcik ? ODA_DUGMESI.secili : ODA_DUGMESI.acik}`}
      >
        <Icon name={tahtaAcik ? "shapesFilled" : "shapes"} className="h-6 w-6" />
      </PlainButton>
      <Acilir acik={acik} onKapat={kapat} tetikleyici={dugme} etiket={t("araclarMenu.dugme")}>
        <div className="flex w-60 flex-col">
          {tahtaAcik ? (
            <PlainButton
              onClick={() => {
                kapat();
                onTahtaKapat();
              }}
              className={`${oge} text-[#F65E55] hover:bg-ders-dugme`}
            >
              <Icon name="dismiss" className="h-5 w-5" />
              {t("araclarMenu.kapat")}
            </PlainButton>
          ) : (
            <PlainButton
              onClick={() => {
                kapat();
                onTahtaAc();
              }}
              className={`${oge} ${ODA_DUGMESI.metin}`}
            >
              <Icon name="whiteboard" className="h-5 w-5" />
              {t("araclarMenu.beyazTahta")}
            </PlainButton>
          )}
        </div>
      </Acilir>
    </div>
  );
}
