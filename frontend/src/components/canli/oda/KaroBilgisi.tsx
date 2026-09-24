/**
 * Kart bilgisi ve kart katmanı — Meet `ParticipantMetadata` +
 * `MutedMicIndicator` + `ConnectionQualityIndicator`, `ParticipantTileFocus`
 * (`FadeOverlay`) ve `.lk-participant-metadata` ölçüleri (La Suite Meet,
 * MIT — DINUM/Etalab).
 *
 * Katman video oyuncusunun KARDEŞİ olarak mutlak konumlanır; oyuncunun üstüne
 * opak zemin koymaz. Fare hareketleri yalnız bu katmanda dinlenir: sahne ve
 * video yeniden çizilmez.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { agKalitesi } from "@/lib/canliDers";

import { BaglantiCubugu, useBaglantiMetni } from "./BaglantiCubugu";

/** Meet `MOUSE_IDLE_TIME`: fare bu kadar durunca kutu kaybolur. */
const HAREKETSIZLIK_MS = 3000;
/** Preply `rl`: karo üstü düğmeler fare hareketinde 1 sn görünür. */
const UST_DUGME_MS = 1000;

export function KaroBilgisi({
  ad,
  mikKapali,
  agSeviyesi,
  elKalkik = false,
  yenidenBaglaniyor = false,
  kucuk = false,
}: {
  ad: string;
  mikKapali: boolean;
  /** El kaldırdı (Meet `RaisedHandMetadataWrapper`). */
  elKalkik?: boolean;
  agSeviyesi: number | null;
  yenidenBaglaniyor?: boolean;
  kucuk?: boolean;
}) {
  const { t } = useTranslation();
  const kutu = kucuk ? "p-0.5 text-xs" : "p-1 text-sm";
  return (
    <>
      {yenidenBaglaniyor && (
        <p
          role="status"
          className={`pointer-events-none absolute left-1 top-1 inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1.5 rounded bg-black/60 text-white ${kutu}`}
        >
          <span
            className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden
          />
          <span className="truncate px-0.5">{t("connection.participantReconnecting")}</span>
        </p>
      )}
      <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-end justify-between gap-1">
        <div className={`flex min-w-0 items-center gap-1 rounded bg-black/50 text-white ${kutu}`}>
          {elKalkik && (
            <span
              className="inline-flex shrink-0 rounded bg-marka p-0.5 text-marka-fg"
              title={t("participantTile.handRaised")}
            >
              <Icon name="handRight" className={kucuk ? "h-3 w-3" : "h-4 w-4"} />
              <span className="sr-only">{t("participantTile.handRaised")}</span>
            </span>
          )}
          {mikKapali && (
            <span
              className="inline-flex shrink-0 rounded bg-ders-tehlike p-0.5"
              title={t("participantTile.muted")}
            >
              <Icon name="micOff" className={kucuk ? "h-3 w-3" : "h-4 w-4"} />
              <span className="sr-only">{t("participantTile.muted")}</span>
            </span>
          )}
          <span className="truncate px-0.5 font-medium">{ad}</span>
        </div>
        {agKalitesi(agSeviyesi) !== "bilinmiyor" && (
          <div className={`inline-flex shrink-0 rounded bg-black/50 ${kucuk ? "p-0.5" : "p-1"}`}>
            <BaglantiCubugu seviye={agSeviyesi} kucuk={kucuk} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Kart katmanı: konuşma halkası ve fare üzerindeyken beliren, hareketsiz
 * kalınca kaybolan bilgi kutusu (bağlantı durumu ve ipucu). Telefonda kutu
 * yok (dokunma `mouseenter` doğurur); katman orada tıklamayı da yutmaz.
 */
export function KaroKatmani({
  className,
  style,
  ad,
  konusuyor,
  agSeviyesi,
  telefon,
  ust,
  onPointerDown,
  children,
}: {
  className: string;
  style?: CSSProperties;
  ad: string | undefined;
  konusuyor: boolean;
  agSeviyesi: number | null;
  telefon: boolean;
  /** Sağ üstte fare hareketinde 1 sn beliren denetim (Preply "Düzeni değiştir"). */
  ust?: ReactNode;
  /** Sürüklenebilir karo/kutu (Preply yüzen kutu, araçsız kendi karon). */
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const katman = useRef<HTMLDivElement>(null);
  const [etkin, setEtkin] = useState(false);
  const [ustGorunur, setUstGorunur] = useState(false);
  const [klavye, setKlavye] = useState(false);
  const { kalite, etiket, ipucu } = useBaglantiMetni(agSeviyesi);
  // Gerçek ölçüm yoksa bağlantı kutusu da yok ("bilinmiyor" yazılmaz).
  const kutuAcik =
    !telefon && ad !== undefined && kalite !== "bilinmiyor" && (etkin || klavye);

  useEffect(() => {
    const el = katman.current;
    if (!el || telefon) return;
    let zamanlayici: number | undefined;
    let ustZamanlayici: number | undefined;
    const hareket = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      setEtkin(true);
      setUstGorunur(true);
      window.clearTimeout(zamanlayici);
      window.clearTimeout(ustZamanlayici);
      zamanlayici = window.setTimeout(() => setEtkin(false), HAREKETSIZLIK_MS);
      ustZamanlayici = window.setTimeout(() => setUstGorunur(false), UST_DUGME_MS);
    };
    const ayrildi = () => {
      window.clearTimeout(zamanlayici);
      window.clearTimeout(ustZamanlayici);
      setEtkin(false);
      setUstGorunur(false);
    };
    el.addEventListener("pointerenter", hareket);
    el.addEventListener("pointermove", hareket);
    el.addEventListener("pointerleave", ayrildi);
    return () => {
      window.clearTimeout(zamanlayici);
      window.clearTimeout(ustZamanlayici);
      el.removeEventListener("pointerenter", hareket);
      el.removeEventListener("pointermove", hareket);
      el.removeEventListener("pointerleave", ayrildi);
    };
  }, [telefon]);

  return (
    <div
      ref={katman}
      role={ad !== undefined && !telefon ? "group" : undefined}
      aria-label={ad !== undefined && !telefon ? ad : undefined}
      tabIndex={ad !== undefined && !telefon ? 0 : undefined}
      onFocus={(e) => setKlavye(e.target.matches(":focus-visible"))}
      onBlur={() => setKlavye(false)}
      data-konusuyor={konusuyor || undefined}
      onPointerDown={onPointerDown}
      style={style}
      className={`absolute overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marka-focus ${
        telefon && !onPointerDown ? "pointer-events-none" : "pointer-events-auto"
      } ${onPointerDown ? "cursor-move touch-none" : ""} ${className}`}
    >
      {children}
      {ust && (
        <div
          className={`absolute right-2 top-2 z-10 ${ustGorunur || klavye ? "" : "invisible"}`}
          onFocus={() => setUstGorunur(true)}
        >
          {ust}
        </div>
      )}
      {/* Konuşma halkası: içeriğin ÜSTÜNDE (video/avatar kaplamasın). */}
      {konusuyor && (
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] animate-ders-konusma" aria-hidden />
      )}
      {kutuAcik && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
          <div className="max-w-[90%] animate-ders-belir rounded bg-ders-yuzey/90 px-3 py-2 text-center text-sm text-white shadow-lg">
            <p className="flex items-center justify-center gap-2 font-medium">
              <BaglantiCubugu seviye={agSeviyesi} />
              {etiket}
            </p>
            {ipucu && <p className="mt-1 text-xs text-white/75">{ipucu}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
