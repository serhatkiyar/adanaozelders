import type { ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";

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
 * ## İçerik: adımlı arama (10 Eyl 2026'da DEĞİŞTİ)
 *
 * Buraya eskiden masaüstü hapının kendisi (`DersArama`/`KutuphaneArama`)
 * geçiliyordu; dikey düzen onun duyarlı sınıflarından geliyordu. Karar
 * kullanıcı referansıyla değişti: telefonda üç alan alt alta AÇIK durunca
 * ekran doluyor ve hiçbiri önceliklenmiyordu. Artık `AramaAdimlari` geçiyor —
 * tek açık kart, altında kapalı satırlar (Airbnb deseni).
 *
 * `aramaHapiIkizligi` nöbetçisinin koruduğu teklik BOZULMADI: masaüstündeki
 * iki hap hâlâ tek tasarım; bu farklı bir YÜZEY, üçüncü bir hap değil.
 *
 * ## Başlık
 *
 * Üstte kategori sekmeleri, sağda yuvarlak kapatma düğmesi (referans ekranın
 * aynısı). Sekmeler gerçek bağlantı olduğu için dokunmak kategoriyi
 * değiştirir ve yüzey AÇIK KALIR — keşif kabuğu remount olmadığı için
 * `open` durumu hayatta kalıyor.
 */
export function MobilAramaSheet({
  open,
  onClose,
  ust,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Başlık alanı — kategori sekmeleri. Sağdaki kapatma düğmesi sabittir. */
  ust?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Arama"
      hideCloseButton
      // Tam ekran: yükseklik `Modal`ın KENDİ kabından (`fixed top-0 bottom-0`)
      // gelir. `h-[100dvh]` denendi ve ÖLÇÜLDÜ (10 Eyl 2026): `dvh` ile kabın
      // gerçek yüksekliği 9px ayrışıyor, alttaki "Ara" düğmesi o kadar
      // ekranın dışında kalıyordu. `h-full` kabı birebir izler; `vh`ın mobil
      // adres çubuğu sorunu da doğmaz çünkü ölçüyü biz vermiyoruz.
      // Zemin gri: içerideki beyaz kartlar (açık adım, kapalı satırlar)
      // ancak gri bir yüzeyde kart gibi okunuyor.
      panelClassName="flex h-full w-full flex-col overflow-hidden bg-slate-50"
      // Çocuk kabı flex zincirine KATILMALI, yoksa içeriğe göre büyüyüp
      // paneli taşırıyor (bkz. `Modal.icerikClassName`).
      icerikClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3">
        <div className="min-w-0 flex-1">{ust}</div>
        <PlainButton
          onClick={onClose}
          aria-label="Aramayı kapat"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100 active:scale-95"
        >
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
        </PlainButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4">{children}</div>
    </Modal>
  );
}
