/**
 * Yan panel — Meet `SidePanel` (La Suite Meet, MIT — DINUM/Etalab).
 *
 * Masaüstü: sahnenin sağında 360px açık renkli kutu (Meet `box.bg`), sağdan
 * kayarak (`translateX`, .5s) girer; sahne yalnız sağ boşluğunu değiştirir,
 * video kapları yeniden kurulmaz (`ZoomOdasi`). Telefon: tam ekran; sahne
 * altta çizili kalır, ses sürer. Klavye açılınca yükseklik görünür alana
 * (`visualViewport`) iner ki yazma alanı klavyenin altında kalmasın.
 *
 * Esc (odak paneldeyken) kapatır, açılınca odak panele (sohbette yazma alanına) geçer,
 * kapanınca açan düğmeye döner (Meet `useEscapeToClose` / `useRestoreFocus`).
 * Kapalıyken `inert`: ekran dışındaki içerik sekme sırasına girmez.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

export type PanelTuru = "katilimcilar" | "sohbet";

const ANAHTAR: Record<PanelTuru, "participants" | "chat"> = {
  katilimcilar: "participants",
  sohbet: "chat",
};

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

export function YanPanel({
  panel,
  telefon,
  onKapat,
  children,
}: {
  /** Açık panel; kapalıysa `null`. */
  panel: PanelTuru | null;
  telefon: boolean;
  onKapat: () => void;
  /** Gösterilen panelin içeriği (kapanış geçişi boyunca son içerik kalır). */
  children: (tur: PanelTuru) => ReactNode;
}) {
  const { t } = useTranslation();
  const kutu = useRef<HTMLElement>(null);
  const oncekiOdak = useRef<HTMLElement | null>(null);
  const acik = panel !== null;
  // Kapanırken son içerik kayarak çıkar; hiç açılmadıysa içerik çizilmez.
  const [gosterilen, setGosterilen] = useState<PanelTuru | null>(panel);
  if (panel !== null && panel !== gosterilen) setGosterilen(panel);
  const alan = useGorunurAlan(telefon && acik);

  // React 18 `inert`i tanımıyor: öznitelik elle.
  useEffect(() => {
    kutu.current?.toggleAttribute("inert", !acik);
  }, [acik]);

  // Meet `useEscapeToClose(asideRef)`: Esc yalnız odak paneldeyken kapatır;
  // odadaki açılır kutular kendi Esc'lerini tüketir.
  const kapat = useRef(onKapat);
  kapat.current = onKapat;
  useEffect(() => {
    const el = kutu.current;
    if (!acik || !el) return;
    const tus = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      kapat.current();
    };
    el.addEventListener("keydown", tus);
    return () => el.removeEventListener("keydown", tus);
  }, [acik]);

  // Odak: açılınca panele (sohbette yazma alanına), kapanınca açan düğmeye.
  useEffect(() => {
    if (!acik) return;
    if (!oncekiOdak.current) oncekiOdak.current = document.activeElement as HTMLElement | null;
    const kare = requestAnimationFrame(() => {
      const hedef =
        panel === "sohbet" ? kutu.current?.querySelector<HTMLElement>("textarea") : null;
      (hedef ?? kutu.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(kare);
  }, [acik, panel]);

  useEffect(() => {
    if (acik) return;
    const geri = oncekiOdak.current;
    oncekiOdak.current = null;
    // Odak paneldeyse ya da (`inert` onu düşürdüyse) hiçbir yerde değilse
    // açan düğmeye döner; kullanıcı başka bir yere geçtiyse dokunulmaz.
    const aktif = document.activeElement;
    if (geri && (!aktif || aktif === document.body || kutu.current?.contains(aktif))) {
      geri.focus?.({ preventScroll: true });
    }
  }, [acik]);

  const anahtar = gosterilen ? ANAHTAR[gosterilen] : "participants";
  const baslik = t(`sidePanel.heading.${anahtar}`);
  const kapatEtiketi = t("sidePanel.closeButton", {
    content: t(`sidePanel.content.${anahtar}`),
  });

  const yerlesim = telefon
    ? `fixed inset-x-0 top-0 z-40 h-[100dvh] ${acik ? "" : "hidden"}`
    : `absolute bottom-0 right-3 top-3 z-30 w-ders-panel rounded-ders border border-slate-200 transition-transform duration-500 ease-in-out ${
        acik ? "" : "translate-x-[calc(100%+0.75rem)]"
      }`;

  return (
    <aside
      ref={kutu}
      tabIndex={-1}
      aria-hidden={!acik}
      aria-label={t("sidePanel.ariaLabel", { title: baslik })}
      aria-describedby="ders-yan-panel-ipucu"
      className={`flex flex-col overflow-hidden bg-white text-slate-900 outline-none ${yerlesim}`}
      style={telefon && alan ? { height: alan.height, top: alan.top } : undefined}
    >
      <span id="ders-yan-panel-ipucu" className="sr-only">
        {t("sidePanel.escapeHint")}
      </span>
      <div className="flex shrink-0 items-center justify-between gap-2 py-3 pl-6 pr-3">
        <h2 className="truncate text-xl font-semibold">{baslik}</h2>
        <PlainButton
          onClick={onKapat}
          aria-label={kapatEtiketi}
          title={kapatEtiketi}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <Icon name="dismiss" className="h-5 w-5" />
        </PlainButton>
      </div>
      {gosterilen && children(gosterilen)}
    </aside>
  );
}
