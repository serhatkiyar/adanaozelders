/**
 * Telefon kontrol çubuğu — Meet `MobileControlBar` (La Suite Meet, MIT —
 * DINUM/Etalab): ortalanmış tek satır kare düğmeler
 * kırmızı Ayrıl · Mikrofon · Kamera · Tepkiler · El kaldır · ⋮ Seçenekler.
 * Telefonda cihaz okları yok (Meet `hideMenu`). Satır sığmazsa önce El
 * kaldır, sonra Tepkiler menüye taşınır (Meet `COLLAPSIBLE_COUNT`).
 *
 * Menü (Meet `ResponsiveMenu` sırası): [taşan Tepkiler] [taşan El kaldır]
 * Sohbet · Katılımcılar · Ayarlar · Kamerayı çevir. Meet'teki Ekran paylaş
 * telefonda desteklenmediği için, Araçlar/Efektler/Geri bildirim bizde
 * olmadığı için yok (arka plan efektleri Ayarlar'da). Okunmamış mesaj varsa
 * ⋮ ve menüdeki Sohbet köşesinde kırmızı nokta (sayı yok, Preply).
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { AltCekmece } from "./AltCekmece";
import type { AyarSekmesi } from "./AyarlarPenceresi";
import {
  AraclarDugmesi,
  OkunmamisNoktasi,
  type AracDenetimi,
  type PanelDenetimi,
} from "./KontrolCubugu";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { ElDugmesi, TelefonTepkileri, TepkiDugmesi } from "./Tepkiler";

const CEKMECE_OGESI =
  "flex flex-col items-center gap-2 rounded-ders p-3 text-sm text-white hover:bg-ders-dugme disabled:opacity-40";

/** Meet: önce El, sonra Tepkiler menüye taşınır. */
const TASINABILIR = 2;

/** Meet `useSize` + kalibrasyon: kaç düğmenin menüye taşınacağı. */
function useTasanSayi() {
  const kap = useRef<HTMLDivElement>(null);
  const satir = useRef<HTMLDivElement>(null);
  const tasinabilir = useRef<HTMLDivElement>(null);
  const [gizli, setGizli] = useState(0);
  const olcu = useRef<{ zorunlu: number; yuva: number } | null>(null);

  const hesapla = useCallback(() => {
    const k = kap.current;
    const s = satir.current;
    if (!k || !s) return;
    const tw = tasinabilir.current?.getBoundingClientRect().width ?? 0;
    if (gizli === 0 && tw > 0) {
      const bosluk = parseFloat(getComputedStyle(s).columnGap) || 0;
      olcu.current = {
        zorunlu: s.getBoundingClientRect().width - tw - bosluk,
        yuva: (tw + bosluk) / TASINABILIR,
      };
    }
    const genislik = k.getBoundingClientRect().width;
    if (!olcu.current || genislik <= 0) return;
    const sigan = Math.floor((genislik - olcu.current.zorunlu) / olcu.current.yuva);
    const sonraki = Math.min(TASINABILIR, Math.max(0, TASINABILIR - sigan));
    if (sonraki !== gizli) setGizli(sonraki);
  }, [gizli]);

  useLayoutEffect(() => {
    hesapla();
    if (typeof ResizeObserver === "undefined") return;
    const g = new ResizeObserver(hesapla);
    if (kap.current) g.observe(kap.current);
    if (satir.current) g.observe(satir.current);
    if (tasinabilir.current) g.observe(tasinabilir.current);
    return () => g.disconnect();
  }, [hesapla]);

  return { kap, satir, tasinabilir, gizli };
}

/** Preply: yatay telefonda "Araçlar" alt çubuğa gelir, dikeyde "Daha fazla"da. */
function useYatay(): boolean {
  const sorgu = "(orientation: landscape)";
  const [yatay, setYatay] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(sorgu).matches,
  );
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(sorgu);
    const degisti = () => setYatay(mq.matches);
    mq.addEventListener?.("change", degisti);
    return () => mq.removeEventListener?.("change", degisti);
  }, []);
  return yatay;
}

export function TelefonCubugu({
  onAyril,
  onAyarlar,
  panel,
  arac,
}: {
  onAyril?: () => void;
  onAyarlar: (sekme: AyarSekmesi) => void;
  panel: PanelDenetimi;
  /** Yalnız öğretmende (bkz. `AracDenetimi`). */
  arac?: AracDenetimi;
}) {
  const yatay = useYatay();
  const { t } = useTranslation();
  const m = useMedyaKontrolleri();
  const [menuAcik, setMenuAcik] = useState(false);
  const menuyuKapat = useCallback(() => setMenuAcik(false), []);
  const { kap, satir, tasinabilir, gizli } = useTasanSayi();
  const elGizli = gizli >= 1;
  const tepkiGizli = gizli >= 2;
  const nokta = panel.sohbetVar && panel.okunmamis > 0 && panel.panel !== "sohbet";

  return (
    <>
      <div className="w-full shrink-0 bg-ders-zemin p-[1.125rem] pb-[max(1.125rem,env(safe-area-inset-bottom))]">
        <div ref={kap} className="flex w-full justify-center">
          <div
            role="region"
            aria-label={t("controls.region")}
            className="flex w-full items-center justify-center gap-[0.65rem]"
          >
            <div ref={satir} className="inline-flex shrink-0 items-center gap-[inherit]">
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
              <MedyaDugmesi
                tur="mik"
                gorunum="oda"
                acik={m.mikAcik}
                mesgul={m.mesgul === "mik"}
                onDegistir={(ac) => void m.mikDegistir(ac)}
              />
              <MedyaDugmesi
                tur="kamera"
                gorunum="oda"
                acik={m.kameraAcik}
                mesgul={m.mesgul === "kamera"}
                onDegistir={(ac) => void m.kameraDegistir(ac)}
              />
              {arac && yatay && <AraclarDugmesi {...arac} />}
              {!tepkiGizli && (
                <div ref={tasinabilir} className="inline-flex shrink-0 items-center gap-[inherit]">
                  <TepkiDugmesi />
                  {!elGizli && <ElDugmesi />}
                </div>
              )}
              <div className="relative inline-block">
                <PlainButton
                  onClick={() => setMenuAcik(true)}
                  aria-label={t("options.buttonLabel")}
                  title={t("options.buttonLabel")}
                  aria-haspopup="dialog"
                  aria-expanded={menuAcik}
                  className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${ODA_DUGMESI.acik}`}
                >
                  <Icon name="moreVertical" className="h-6 w-6" />
                </PlainButton>
                {nokta && <OkunmamisNoktasi />}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AltCekmece acik={menuAcik} onKapat={menuyuKapat} baslik={t("options.buttonLabel")}>
        <TelefonTepkileri
          onKapat={menuyuKapat}
          ogeSinifi={CEKMECE_OGESI}
          tepkiler={tepkiGizli}
          el={elGizli}
        />
        {arac && !yatay && (
          <PlainButton
            onClick={() => {
              menuyuKapat();
              if (arac.tahtaAcik) arac.onTahtaKapat();
              else arac.onTahtaAc();
            }}
            className={`${CEKMECE_OGESI} ${arac.tahtaAcik ? "text-[#F65E55]" : ""}`}
          >
            <Icon name={arac.tahtaAcik ? "dismiss" : "whiteboard"} className="h-6 w-6" />
            {t(arac.tahtaAcik ? "araclarMenu.kapat" : "araclarMenu.beyazTahta")}
          </PlainButton>
        )}
        {panel.sohbetVar && (
          <PlainButton
            onClick={() => {
              menuyuKapat();
              panel.onPanel("sohbet");
            }}
            aria-label={
              nokta ? `${t("options.items.chat")}, ${t("controls.chat.unread")}` : undefined
            }
            aria-pressed={panel.panel === "sohbet"}
            className={CEKMECE_OGESI}
          >
            <span className="relative">
              <Icon name={panel.panel === "sohbet" ? "chatFilled" : "chat"} className="h-6 w-6" />
              {nokta && <OkunmamisNoktasi />}
            </span>
            {t("options.items.chat")}
          </PlainButton>
        )}
        <PlainButton
          onClick={() => {
            menuyuKapat();
            panel.onPanel("katilimcilar");
          }}
          aria-pressed={panel.panel === "katilimcilar"}
          className={CEKMECE_OGESI}
        >
          <Icon name="people" className="h-6 w-6" />
          {t("options.items.participants")}
        </PlainButton>
        <PlainButton
          onClick={() => {
            menuyuKapat();
            onAyarlar("ses");
          }}
          className={CEKMECE_OGESI}
        >
          <Icon name="settings" className="h-6 w-6" />
          {t("options.items.settings")}
        </PlainButton>
        <PlainButton
          onClick={() => {
            menuyuKapat();
            void m.kameraCevir();
          }}
          disabled={!m.kameraAcik || m.mesgul !== null}
          className={CEKMECE_OGESI}
        >
          <Icon name="cameraSwitch" className="h-6 w-6" />
          {t("options.items.switchCamera")}
        </PlainButton>
      </AltCekmece>
    </>
  );
}
