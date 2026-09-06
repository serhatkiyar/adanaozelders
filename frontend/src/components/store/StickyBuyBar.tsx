/**
 * Mobilde ekranın altına sabitlenen satın alma çubuğu.
 *
 * ## NEDEN
 *
 * Ürün sayfası mobilde uzundur (galeri → künye → yorumlar → benzer ürünler) ve
 * asıl aksiyon en üstte kalır. Kullanıcı aşağı indiğinde satın alma yolu
 * ekrandan çıkıyordu.
 *
 * ## NEDEN YALNIZ ASIL DÜĞME GÖRÜNMEZKEN
 *
 * Çubuk her zaman görünseydi, sayfanın en üstünde asıl düğmenin hemen altında
 * ikinci bir "Sepete Ekle" durur ve hangisinin ne yaptığı belirsizleşirdi.
 * `IntersectionObserver` ile asıl düğme görünürken çubuk gizlenir.
 *
 * ## WCAG 2.4.11 (Focus Not Obscured)
 *
 * Sabit çubuk odaklanmış bir ögeyi ÖRTEMEZ. Bu yüzden çubuk görünürken
 * sayfanın altına çubuk yüksekliği kadar boşluk eklenir; aksi hâlde klavyeyle
 * gezen kullanıcı sayfanın son etkileşimli ögesine ulaştığında onu göremezdi.
 */
import { useEffect, useRef, useState } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { formatTL } from "@/lib/money";

export function StickyBuyBar({
  price,
  label,
  disabled,
  variantOzeti,
  onAdd,
  /** Asıl "Sepete Ekle" düğmesi — görünürken çubuk gizlenir. */
  anchorRef,
}: {
  price: string;
  label: string;
  disabled: boolean;
  /** Seçili varyantın kısa özeti ("Sarı · M") — hangi varyantın alındığı belli olsun. */
  variantOzeti?: string | null;
  onAdd: () => void;
  anchorRef: React.RefObject<HTMLElement>;
}) {
  const [gorunur, setGorunur] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hedef = anchorRef.current;
    if (!hedef || typeof IntersectionObserver === "undefined") return;
    const gozlemci = new IntersectionObserver(
      ([giris]) => setGorunur(!giris.isIntersecting),
      { rootMargin: "0px" }
    );
    gozlemci.observe(hedef);
    return () => gozlemci.disconnect();
  }, [anchorRef]);

  if (!gorunur) return null;

  return (
    <>
      {/* Odak örtülmesin diye ayrılan yer (WCAG 2.4.11). */}
      <div aria-hidden="true" className="h-[72px] md:hidden" />
      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 flex min-h-[56px] items-center gap-3 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-2px_12px_rgba(15,23,42,0.08)] md:hidden"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight text-slate-900">
            {formatTL(price)}
          </p>
          {variantOzeti && (
            <p className="truncate text-xs text-slate-500">{variantOzeti}</p>
          )}
        </div>
        <PlainButton
          disabled={disabled}
          onClick={onAdd}
          className="ml-auto flex h-11 flex-1 items-center justify-center rounded-lg bg-marka px-6 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          {label}
        </PlainButton>
      </div>
    </>
  );
}
