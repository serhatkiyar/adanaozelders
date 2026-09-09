import type { ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";

/**
 * Telefonda tam ekran arama yüzeyi (Airbnb deseni).
 *
 * ## Neden ayrı bir yüzey
 *
 * Arama hapı masaüstünde tek satırda iki-üç bölmedir. 390px'te aynı hap
 * basıldığında bölme başına ~122px, "Yüz yüze" seçilip üçüncü bölme açıldığında
 * ~74px kalıyordu; placeholder'lar ve seçili mahalle adları okunamıyordu
 * (ölçüldü). Üstelik hap üst barda durduğu için ekranın %27'sini yiyordu.
 *
 * Çözüm hapı KÜÇÜLTMEK değil, YERİNİ değiştirmek: üst barda tek satırlık bir
 * tetikleyici (`CompactSearch`) durur, gerçek hap dokunulunca burada tam
 * ekran açılır ve alanlar alt alta rahat rahat yerleşir.
 *
 * ## Neden ikinci bir form yazılmadı
 *
 * İçeriye AYNI `DersArama` / `KutuphaneArama` bileşeni geçilir; dikey düzen
 * onların kendi duyarlı sınıflarından gelir (`flex-col md:flex-row`). Kopya
 * bir mobil form, `__guards__/aramaHapiIkizligi.test.ts`in koruduğu tekliği
 * sessizce üçe çıkarır ve iki yüzey ayrı ayrı evrilirdi.
 */
export function MobilAramaSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Arama"
      hideCloseButton
      // Tam ekran: `dvh` şart — `vh` mobil tarayıcılarda adres çubuğu gizliyken
      // de gizli değilken de aynı değeri döndürür ve panel taşar.
      panelClassName="flex h-[100dvh] w-full flex-col overflow-y-auto bg-white"
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:scale-95"
        >
          <span className="sr-only">Aramayı kapat</span>
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <p className="text-base font-semibold text-slate-900">Ara</p>
      </div>
      <div className="px-4 pb-6">{children}</div>
    </Modal>
  );
}
