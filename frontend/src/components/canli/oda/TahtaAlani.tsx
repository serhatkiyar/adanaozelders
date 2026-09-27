/**
 * Tahta paneli — Preply araç paneli (`tools-panel`) ve başlığı (`Lx` /
 * `ToolsHeader`), spesifikasyon §4:
 *
 * - 48px koyu başlık (4 + 40 + 4), üst köşeler 8px.
 * - Sol: 18px tahta ikonu + "Beyaz tahta" (14px/600) + 1×24 ayırıcı.
 * - Sağ: "Paylaşımlı" (kişiler ikonu + metin; üzerine gelince açıklama),
 *   "Tam alana genişlet" (40×40, iki tarafta; uygulama içi odak, yalnız
 *   bakan kişide — tarayıcı tam ekranı değil), ayırıcı + X (40×40) — X
 *   YALNIZ öğretmende.
 * - Beyaz yüzey çerçeveden 4px içeride.
 *
 * Yüzey (Excalidraw) `lazy()` ile: Excalidraw/pdf.js/jsPDF yalnız tahta ilk
 * açıldığında iner; başlık yüklenirken de görünür.
 */
import { Component, Suspense, lazy, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import type { DersKanali } from "../tahta/dersKanali";

const TahtaPaneli = lazy(() => import("../tahta/TahtaPaneli"));

/** Tahta parçası yüklenemese ya da çökse bile görüşme sürer. */
class TahtaSiniri extends Component<{ hata: ReactNode; children: ReactNode }, { hata: boolean }> {
  state = { hata: false };
  static getDerivedStateFromError() {
    return { hata: true };
  }
  render() {
    return this.state.hata ? this.props.hata : this.props.children;
  }
}

export function TahtaAlani({
  kanal,
  dersId,
  ogretmen,
  karsiAd,
  onKapat,
  odakta,
  onOdak,
}: {
  kanal: DersKanali;
  dersId: number;
  ogretmen: boolean;
  /** "Paylaşımlı" açıklamasındaki, imleç etiketindeki ve izin pencerelerindeki karşı taraf adı. */
  karsiAd: string;
  /** Başlıktaki X (yalnız öğretmen). */
  onKapat: () => void;
  /** Tahta odakta (tüm sahneyi alıyor) mı. */
  odakta: boolean;
  onOdak: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("tahta.baslik")}
      data-tahta-alani
      className="flex h-full w-full flex-col rounded-t-ders bg-ders-yuzey p-1 text-white"
    >
      <header data-tahta-basligi className="flex h-10 shrink-0 items-center gap-3 pl-3 pr-0">
        <Icon name="whiteboard" className="h-[18px] w-[18px]" />
        <h2 className="text-sm font-semibold">{t("tahta.baslik")}</h2>
        <span aria-hidden className="h-6 w-px bg-white/20" />
        <div className="flex-1" />
        <div className="group relative">
          <PlainButton
            aria-describedby="tahta-paylasimli-ipucu"
            className="inline-flex h-10 items-center gap-2 rounded px-2 text-sm font-semibold hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
          >
            <Icon name="people" className="h-5 w-5" />
            {t("tahta.paylasimli")}
          </PlainButton>
          <div
            id="tahta-paylasimli-ipucu"
            role="tooltip"
            className="pointer-events-none invisible absolute right-0 top-full z-40 mt-2 w-72 rounded-lg bg-white p-3 text-sm text-slate-800 shadow-xl group-focus-within:visible group-hover:visible"
          >
            <p className="font-semibold">{t("tahta.paylasimli")}</p>
            <p className="mt-1">
              {karsiAd
                ? t("tahta.paylasimliIpucu", { ad: karsiAd })
                : t("tahta.paylasimliIpucuAdsiz")}
            </p>
          </div>
        </div>
        <PlainButton
          onClick={onOdak}
          aria-label={t("duzen.odak")}
          aria-pressed={odakta}
          title={t(odakta ? "duzen.odaktanCik" : "duzen.odak")}
          className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
        >
          <Icon name={odakta ? "fullScreenMinimize" : "fullScreenMaximize"} className="h-5 w-5" />
        </PlainButton>
        {ogretmen && (
          <>
            <span aria-hidden className="h-6 w-px bg-white/20" />
            <PlainButton
              onClick={onKapat}
              aria-label={t("tahta.kapat")}
              title={t("tahta.kapat")}
              className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-ders-dugme focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
            >
              <Icon name="dismiss" className="h-5 w-5" />
            </PlainButton>
          </>
        )}
      </header>
      <div className="mt-1 min-h-0 flex-1 overflow-hidden bg-white text-slate-900">
        <TahtaSiniri
          hata={
            <p role="alert" className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-600">
              {t("tahta.acilamadi")}
            </p>
          }
        >
        <Suspense
          fallback={
            <p role="status" className="flex h-full items-center justify-center text-sm text-slate-500">
              {t("tahta.yukleniyor")}
            </p>
          }
        >
          <TahtaPaneli kanal={kanal} dersId={dersId} ogretmen={ogretmen} karsiAd={karsiAd} />
        </Suspense>
        </TahtaSiniri>
      </div>
    </section>
  );
}
