import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Masaüstü filtre şeridinin AÇILIR ÇİPİ — Airbnb "Fiyat ⌄ / Yerin türü ⌄"
 * deseni (kullanıcı kararı, 16 Eyl 2026).
 *
 * Çip: hap biçimli, 1px kenarlık, etiket + ok. Açıkken ve filtre etkinken
 * kenarlık koyu, ok yukarı döner. Altında sola hizalı bir pencere: gövde
 * `children`, altta "Temizle" (soluk, etkin filtre yoksa pasif) ve koyu
 * "Sonuçları göster" (yalnız kapatır — filtre zaten adrese anında yazılır).
 * Dışarı tıklama ve Escape kapatır. Tek seferde tek pencere açık olması
 * sayfanın işidir (`acik` prop'u).
 *
 * Pencere PORTAL ile gövdeye çizilir: şerit yatay kaydırılabilir bir kap
 * (`overflow-x-auto`) ve içindeki mutlak konumlu pencereyi kesiyordu
 * (ölçüldü, 16 Eyl 2026). Konum çipin kutusundan alınır; kaydırma ve
 * yeniden boyutlanmada tazelenir.
 */
export function FiltreAcilir({
  etiket,
  aktif,
  acik,
  onAc,
  onKapat,
  onTemizle,
  genislik = "w-[400px]",
  children,
}: {
  etiket: string;
  /** Filtre adreste etkin mi (çip koyu kenarlıkla çizilir). */
  aktif: boolean;
  acik: boolean;
  onAc: () => void;
  onKapat: () => void;
  onTemizle: () => void;
  genislik?: string;
  children: ReactNode;
}) {
  const kok = useRef<HTMLDivElement>(null);
  const pencere = useRef<HTMLDivElement>(null);
  const [yer, setYer] = useState<{ sol: number; ust: number } | null>(null);

  useLayoutEffect(() => {
    if (!acik) {
      setYer(null);
      return;
    }
    const olc = () => {
      const r = kok.current?.getBoundingClientRect();
      if (r) setYer({ sol: r.left, ust: r.bottom + 8 });
    };
    olc();
    window.addEventListener("resize", olc);
    window.addEventListener("scroll", olc, true);
    return () => {
      window.removeEventListener("resize", olc);
      window.removeEventListener("scroll", olc, true);
    };
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    const disari = (e: MouseEvent) => {
      const h = e.target as Node;
      if (kok.current?.contains(h) || pencere.current?.contains(h)) return;
      onKapat();
    };
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKapat();
    };
    document.addEventListener("mousedown", disari);
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("mousedown", disari);
      document.removeEventListener("keydown", tus);
    };
  }, [acik, onKapat]);

  return (
    <div ref={kok} className="relative shrink-0">
      <button
        type="button"
        onClick={acik ? onKapat : onAc}
        aria-expanded={acik}
        className={`flex h-[34px] items-center gap-1.5 rounded-full border bg-white px-3.5 text-sm font-medium text-slate-900 transition ${
          acik || aktif ? "border-slate-900" : "border-slate-300 hover:border-slate-500"
        }`}
      >
        {etiket}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3.5 w-3.5 transition-transform ${acik ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {acik && yer && createPortal(
        <div
          ref={pencere}
          role="dialog"
          aria-label={etiket}
          style={{ left: yer.sol, top: yer.ust }}
          className={`fixed z-50 ${genislik} overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 animate-in fade-in zoom-in-95 duration-150`}
        >
          <div className="p-6">{children}</div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={onTemizle}
              disabled={!aktif}
              className="rounded-lg px-2 py-2 text-sm font-semibold text-slate-900 underline-offset-2 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline"
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={onKapat}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95"
            >
              Sonuçları göster
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
