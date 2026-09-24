/**
 * Yan panel yuvası — Preply sınıfının `sidebar-panel`i (spesifikasyon
 * `preply-sinif-sohbet.md` §2, §5): aynı yuvada bir anda tek içerik
 * (Katılımcılar ya da Sohbet), odanın EN SAĞINDA tam yükseklik.
 *
 * - Geniş masaüstü (>880px): akışta; sahneyi ve kontrol çubuğunu DARALTIR,
 *   üstüne binmez. Varsayılan ve en küçük 375px, sol kenardaki 4px görünmez
 *   tutamaçla 712px'e kadar genişler. Animasyon yok (Preply `expand()` anlık).
 * - Dar masaüstü (≤880px): sağa sabit, en fazla 500px kaplayan pencere +
 *   solda `rgba(18,17,23,.56)` karartma; sahne daralmaz.
 * - Telefon: tam ekran; sahne altta çizili kalır, ses sürer; sayfa kaydırması
 *   kilitli. Klavye açılınca yükseklik görünür alana (`visualViewport`) iner.
 *
 * Katılımcılar Meet `SidePanel` başlığını ve Esc ile kapanmayı korur; sohbet
 * kendi Preply başlığını çizer ve Esc ile kapanmaz (Preply). Açılınca odak
 * panele geçer (masaüstü sohbette yazma alanına, `DersSohbeti`), kapanınca
 * açan düğmeye döner. Kapalıyken `inert` ve gizli.
 */
import { useEffect, useRef, useState, type PointerEvent as IsaretciOlayi, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

export type PanelTuru = "katilimcilar" | "sohbet";

/** Preply `eD()`: en küçük (ve varsayılan) / en büyük genişlik. */
const EN_DAR = 375;
const EN_GENIS = 712;

/** Telefonda klavye açıkken görünür alanın yüksekliği ve üst kayması. */
function useGorunurAlan(etkin: boolean): { height: number; top: number } | null {
  const [alan, setAlan] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!etkin || !vv) {
      setAlan(null);
      return;
    }
    const uyarla = () => setAlan({ height: vv.height, top: vv.offsetTop });
    uyarla();
    vv.addEventListener("resize", uyarla);
    vv.addEventListener("scroll", uyarla);
    return () => {
      vv.removeEventListener("resize", uyarla);
      vv.removeEventListener("scroll", uyarla);
    };
  }, [etkin]);
  return alan;
}

/** Preply `disallowBodyScroll`: telefonda panel açıkken `body` sabitlenir. */
function useKaydirmaKilidi(etkin: boolean) {
  useEffect(() => {
    if (!etkin) return;
    const s = document.body.style;
    const onceki = { position: s.position, width: s.width, height: s.height };
    s.position = "fixed";
    s.width = "100%";
    s.height = "100%";
    return () => {
      s.position = onceki.position;
      s.width = onceki.width;
      s.height = onceki.height;
    };
  }, [etkin]);
}

export function YanPanel({
  panel,
  telefon,
  dar,
  onKapat,
  children,
}: {
  /** Açık panel; kapalıysa `null`. */
  panel: PanelTuru | null;
  telefon: boolean;
  /** Masaüstünde pencere ≤880px: kaplayan pencere düzeni. */
  dar: boolean;
  onKapat: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const kutu = useRef<HTMLElement>(null);
  const oncekiOdak = useRef<HTMLElement | null>(null);
  const acik = panel !== null;
  const [genislik, setGenislik] = useState(EN_DAR);
  const alan = useGorunurAlan(telefon && acik);
  useKaydirmaKilidi(telefon && acik);

  // React 18 `inert`i tanımıyor: öznitelik elle.
  useEffect(() => {
    kutu.current?.toggleAttribute("inert", !acik);
  }, [acik]);

  // Meet `useEscapeToClose`: yalnız Katılımcılar (Preply sohbeti Esc ile kapanmaz).
  const kapat = useRef(onKapat);
  kapat.current = onKapat;
  useEffect(() => {
    const el = kutu.current;
    if (panel !== "katilimcilar" || !el) return;
    const tus = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      kapat.current();
    };
    el.addEventListener("keydown", tus);
    return () => el.removeEventListener("keydown", tus);
  }, [panel]);

  // Odak: açılınca panele (masaüstü sohbeti yazma alanını kendi odaklar).
  useEffect(() => {
    if (!acik) return;
    if (!oncekiOdak.current) oncekiOdak.current = document.activeElement as HTMLElement | null;
    if (panel === "sohbet" && !telefon) return;
    const kare = requestAnimationFrame(() => kutu.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(kare);
  }, [acik, panel, telefon]);

  useEffect(() => {
    if (acik) return;
    const geri = oncekiOdak.current;
    oncekiOdak.current = null;
    const aktif = document.activeElement;
    if (geri && (!aktif || aktif === document.body || kutu.current?.contains(aktif))) {
      geri.focus?.({ preventScroll: true });
    }
  }, [acik]);

  // Sol kenar tutamacı: sürükleyerek 375–712px.
  const surukle = (e: IsaretciOlayi<HTMLDivElement>) => {
    const el = kutu.current;
    if (!el) return;
    e.preventDefault();
    const sag = el.getBoundingClientRect().right;
    const hedef = e.currentTarget;
    hedef.setPointerCapture(e.pointerId);
    const hareket = (h: PointerEvent) =>
      setGenislik(Math.min(EN_GENIS, Math.max(EN_DAR, Math.round(sag - h.clientX))));
    const birak = () => {
      hedef.removeEventListener("pointermove", hareket);
      hedef.removeEventListener("pointerup", birak);
      hedef.removeEventListener("pointercancel", birak);
    };
    hedef.addEventListener("pointermove", hareket);
    hedef.addEventListener("pointerup", birak);
    hedef.addEventListener("pointercancel", birak);
  };

  const duzen = telefon ? "telefon" : dar ? "dar" : "genis";
  const yerlesim =
    duzen === "telefon"
      ? "fixed inset-x-0 top-0 z-40 h-[100dvh]"
      : duzen === "dar"
        ? "absolute right-0 top-0 z-[5] h-full w-full max-w-[500px]"
        : "relative h-full shrink-0";
  const baslik = t(`sidePanel.heading.${panel === "sohbet" ? "chat" : "participants"}`);

  return (
    <>
      {duzen === "dar" && acik && (
        <div aria-hidden className="absolute inset-0 z-[4] bg-[rgba(18,17,23,0.56)]" />
      )}
      <aside
        ref={kutu}
        tabIndex={-1}
        aria-hidden={!acik}
        aria-label={t("sidePanel.ariaLabel", { title: baslik })}
        className={`flex-col overflow-hidden bg-white text-slate-900 outline-none ${yerlesim} ${
          acik ? "flex" : "hidden"
        }`}
        style={
          duzen === "telefon" && alan
            ? { height: alan.height, top: alan.top }
            : duzen === "genis"
              ? { width: genislik }
              : undefined
        }
      >
        {duzen === "genis" && (
          // Odaklanabilir `separator` ARIA'da etkileşimli bir pencere bölücüdür
          // (ok tuşlarıyla genişlik); kural bunu statik ayırıcı sanıyor.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidePanel.resize")}
            aria-valuemin={EN_DAR}
            aria-valuemax={EN_GENIS}
            aria-valuenow={genislik}
            tabIndex={0}
            onPointerDown={surukle}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const adim = e.key === "ArrowLeft" ? 16 : -16;
                setGenislik((g) => Math.min(EN_GENIS, Math.max(EN_DAR, g + adim)));
              }
            }}
            className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize touch-none outline-none focus-visible:bg-marka-focus"
          />
        )}
        {panel === "katilimcilar" && (
          <>
            <span id="ders-yan-panel-ipucu" className="sr-only">
              {t("sidePanel.escapeHint")}
            </span>
            <div className="flex shrink-0 items-center justify-between gap-2 py-3 pl-6 pr-3">
              <h2 className="truncate text-xl font-semibold">{baslik}</h2>
              <PlainButton
                onClick={onKapat}
                aria-label={t("sidePanel.closeButton")}
                aria-describedby="ders-yan-panel-ipucu"
                title={t("sidePanel.closeButton")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
              >
                <Icon name="dismiss" className="h-5 w-5" />
              </PlainButton>
            </div>
          </>
        )}
        {children}
      </aside>
    </>
  );
}
