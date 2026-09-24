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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";

import { BaglantiCubugu, useBaglantiMetni } from "./BaglantiCubugu";

/** Meet `MOUSE_IDLE_TIME`: fare bu kadar durunca kutu kaybolur. */
const HAREKETSIZLIK_MS = 3000;

export function KaroBilgisi({
  ad,
  mikKapali,
  agSeviyesi,
  yenidenBaglaniyor = false,
  kucuk = false,
}: {
  ad: string;
  mikKapali: boolean;
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
        <div className={`inline-flex shrink-0 rounded bg-black/50 ${kucuk ? "p-0.5" : "p-1"}`}>
          <BaglantiCubugu seviye={agSeviyesi} kucuk={kucuk} />
        </div>
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
  ad,
  konusuyor,
  agSeviyesi,
  telefon,
  children,
}: {
  className: string;
  ad: string | undefined;
  konusuyor: boolean;
  agSeviyesi: number | null;
  telefon: boolean;
  children: ReactNode;
}) {
  const katman = useRef<HTMLDivElement>(null);
  const [etkin, setEtkin] = useState(false);
  const [klavye, setKlavye] = useState(false);
  const { etiket, ipucu } = useBaglantiMetni(agSeviyesi);
  const kutuAcik = !telefon && ad !== undefined && (etkin || klavye);

  useEffect(() => {
    const el = katman.current;
    if (!el || telefon) return;
    let zamanlayici: number | undefined;
    const hareket = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      setEtkin(true);
      window.clearTimeout(zamanlayici);
      zamanlayici = window.setTimeout(() => setEtkin(false), HAREKETSIZLIK_MS);
    };
    const ayrildi = () => {
      window.clearTimeout(zamanlayici);
      setEtkin(false);
    };
    el.addEventListener("pointerenter", hareket);
    el.addEventListener("pointermove", hareket);
    el.addEventListener("pointerleave", ayrildi);
    return () => {
      window.clearTimeout(zamanlayici);
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
      className={`absolute overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marka ${
        telefon ? "pointer-events-none" : ""
      } ${className}`}
    >
      {children}
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
