import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Link } from "react-router-dom";

import { PlainButton } from "@/components/ui/PlainButton";

/**
 * Dairesel ok düğmesi — **TEK KAYNAK**.
 *
 * ## Neden var (kullanıcı, 7 Eyl 2026)
 *
 * Aynı vitrin satırında iki farklı dairesel düğme vardı: başlığın yanındaki
 * "tümünü gör" oku (`h-7`, `bg-slate-100`, kenarlıksız) ve kaydırma okları
 * (`h-8`, beyaz + kenarlık). Üçüncüsü `ScrollableRow`daydı (beyaz + gölge +
 * halka, üstelik ikon yerine `❮ ❯` KARAKTERİ). Üç ayrı el yazımı, üç ayrı
 * görünüm.
 *
 * Kullanıcının itirazı buydu: *"her yeni butonda farklı bir buton mu
 * kullanacağız."* Haklı — bu bir tasarım kararı ve tek yerde yaşamalı.
 * Görünüm, ikisinden ESKİ olanı ("tümünü gör" oku) esas alır; yeni yazdığım
 * kenarlıklı sürüm terk edildi.
 *
 * ## Sözleşme
 *
 * Çağrı yeri **yalnız yön ve durum** verir; ölçü, renk, hover ve ikon burada
 * yaşar. `to` verilirse bağlantı, verilmezse düğme olur — ikisi de aynı
 * görünür.
 *
 * Nöbetçi: `__guards__/daireDugmeTekligi.test.tsx`.
 */
export type DaireYon = "sol" | "sag" | "ileri";

const YOL: Record<DaireYon, string> = {
  sol: "M15 19l-7-7 7-7",
  sag: "M9 5l7 7-7 7",
  ileri: "M5 12h14m-6-6 6 6-6 6",
};

/**
 * Ölçü, renk ve hover TEK yerde. Çağrı yerleri bu dizeyi kopyalamaz.
 *
 * DOKUNMA ALANI ile GÖRÜNEN DAİRE ayrıdır (9 Eyl 2026, kullanıcı itirazı).
 * Telefonda önce dairenin kendisi 44px yapılmıştı; 20px'lik kuşak başlığının
 * yanında kocaman duruyordu ("vitrindeki buton çok büyük"). Doğrusu: kabuk
 * 44px kalır (proje eşiği, `scripts/sihirbaz_mobil_turu.mjs`) ama ZEMİNSİZDİR;
 * gri daire içerideki 32px'lik yuvarlaktır. Parmak aynı alanı bulur, göz daha
 * küçük bir düğme görür.
 */
const TEMEL =
  "inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full transition md:h-7 md:w-7";
const ETKIN = "text-slate-700";
const PASIF = "text-slate-300 cursor-default";
/** Görünen daire — kabuğun içinde, ondan küçük. */
const DAIRE = "flex h-8 w-8 items-center justify-center rounded-full transition md:h-7 md:w-7";
const DAIRE_ETKIN = "bg-slate-100 group-hover:bg-slate-200 hover:bg-slate-200";
const DAIRE_PASIF = "bg-slate-50";

function Glif({ yon, pasif = false }: { yon: DaireYon; pasif?: boolean }) {
  return (
    <span className={`${DAIRE} ${pasif ? DAIRE_PASIF : DAIRE_ETKIN}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        className="h-[13px] w-[13px]"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={YOL[yon]} />
      </svg>
    </span>
  );
}

interface OrtakProps {
  yon: DaireYon;
  /** Erişilebilir ad — ikon tek başına anlam taşımaz. */
  "aria-label": string;
}

/** Bağlantı biçimi ("tümünü gör" gibi bir hedefe götürür). */
export function DaireBaglanti({
  to,
  yon,
  ...rest
}: OrtakProps & { to: string }) {
  return (
    <Link to={to} className={`group ${TEMEL} ${ETKIN}`} {...rest}>
      <Glif yon={yon} />
    </Link>
  );
}

/** Düğme biçimi (kaydırma okları gibi sayfada iş yapar). */
export const DaireDugme = forwardRef<
  HTMLButtonElement,
  OrtakProps & ButtonHTMLAttributes<HTMLButtonElement>
>(function DaireDugme({ yon, disabled, className = "", ...rest }, ref) {
  return (
    // Ham `<button>` DEĞİL: projenin düğme primitive'i `PlainButton`.
    // Ölçüm tabanı ham düğme sayısını tavanla sınırlıyor ve bu dosya o tavana
    // yeni bir kalem eklememeli (`scripts/ui-baseline-sayim.mjs`).
    <PlainButton
      ref={ref}
      disabled={disabled}
      className={`group ${TEMEL} ${disabled ? PASIF : ETKIN} ${className}`}
      {...rest}
    >
      <Glif yon={yon} pasif={disabled} />
    </PlainButton>
  );
});
