import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { DENEMELER_ACIK, KUTUPHANELER_ACIK } from "@/lib/ozellikBayraklari";

/**
 * Airbnb tarzı üst-seviye kategori çubuğu: küçük 3D ikon + altında etiket,
 * aktif olanın altı kalın çizgili ve etiketi koyu. Landing'de arama çubuğunun
 * altında, ders karuselinin üstünde durur.
 */

// "hepsi" sekmesi KALDIRILDI (29 Ağu, kullanıcı kararı): varsayılan yüzey
// artık Eğitmenler.
export type CategoryKey =
  | "egitmenler"
  | "kutuphaneler"
  | "denemeler";

type Category = {
  key: CategoryKey | "magaza";
  label: string;
  icon: string;
  to: string;
  /** Bölüm donduruldu: görünür kalır ama tıklanamaz (bkz. ozellikBayraklari). */
  donuk?: boolean;
  /** Bölüm tamamen gizli: HİÇ render edilmez (kullanıcı kararı, 29 Ağu). */
  gizli?: boolean;
};

const CATEGORIES: Category[] = [
  { key: "egitmenler", label: "Eğitmenler", icon: "/icons/categories/egitmenler.webp", to: ROUTES.tutors },
  { key: "kutuphaneler", label: "Kütüphaneler", icon: "/icons/categories/kutuphaneler.webp", to: ROUTES.libraries, donuk: !KUTUPHANELER_ACIK },
  // Deneme oturumları kütüphane profillerinde yer alır. Kütüphaneler'den farklı
  // olarak donuk-görünür DEĞİL, kapalıyken tamamen gizli; bayrak açılınca döner.
  { key: "denemeler", label: "Denemeler", icon: "/icons/categories/denemeler.webp", to: ROUTES.libraries, gizli: !DENEMELER_ACIK },
  // Mağaza: kategori sekmesi değil, mağazaya geçiş kapısı (kullanıcı isteği, 29 Ağu).
  { key: "magaza", label: "Mağaza", icon: "/icons/categories/magaza.webp", to: ROUTES.store },
];


/** Tek bir kategorinin meta'sı (ikon/label) — kompakt arama çubuğu için. */
export function categoryMeta(key: CategoryKey): Category {
  return CATEGORIES.find((c) => c.key === key)!;
}

/**
 * `onSelect` verilirse kategoriler sekme gibi davranır (yeni sayfaya gitmez,
 * üstteki state'i değiştirir — Airbnb davranışı). Verilmezse klasik link.
 */
export function CategoryBar({
  active,
}: {
  active?: CategoryKey;
}) {
  return (
    <div className="w-full">
      {/* Kaydırma kabında justify-center KULLANILMAZ: içerik ekrandan genişse
          sol uç erişilmez kesilir (telefonda "Eğitmenler taşmış" hatası).
          İç sarmalayıcının mx-auto'su dar içerikte ortalar, geniş içerikte
          soldan kaydırmaya izin verir. */}
      <div
        className="flex items-end overflow-x-auto px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="mx-auto flex items-end gap-6 sm:gap-8">
        {CATEGORIES.filter((c) => !c.gizli).map((c) => {
          const isActive = active === c.key;
          // Airbnb düzeni (29 Ağu): ikon ETİKETİN YANINDA; yazı yarı-kalın ve
          // koyu gri, hover/aktifte tam siyah.
          const cls = `group flex shrink-0 flex-row items-center gap-2 border-b-2 pb-2 pt-0 transition-colors duration-200 ${
            isActive
              ? "border-slate-900 "
              : "border-transparent hover:border-slate-200 "
          }`;
          const inner = (
            <>
              {/* 96px WebP (48px'te 2x retina). Kaynaklar 1024px PNG'ydi:
                  beş ikon 4,21 MB tutuyordu ve ana sayfada anında indiriliyordu.
                  width/height layout kaymasını (CLS) önler. */}
              <img
                src={c.icon}
                alt=""
                aria-hidden
                width={40}
                height={40}
                decoding="async"
                className={`h-10 w-10 object-contain transition-all duration-200 group-hover:scale-105 ${
                  isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100"
                }`}
              />
              <span
                className={`whitespace-nowrap text-[15px] font-semibold transition-colors duration-200 ${
                  isActive
                    ? "text-slate-900 "
                    : "text-slate-600 group-hover:text-slate-900 "
                }`}
              >
                {c.label}
              </span>
            </>
          );
          // Donmuş kategori: ne <Link> ne <button>. Anchor'ı `href`siz
          // bırakmak fare kullanıcısı için hiçbir şeyi değiştirmezdi; öğe
          // baştan etkileşimsiz bir <span> olarak basılır.
          if (c.donuk) {
            return (
              <span
                key={c.key}
                aria-disabled="true"
                tabIndex={-1}
                className={`${cls} cursor-default opacity-60`}
              >
                {inner}
              </span>
            );
          }

          /*
           * HER KATEGORİ BİR BAĞLANTIDIR (kullanıcı kararı, 9 Eyl 2026).
           *
           * Burada eskiden `onSelect` verilirse `<button>`, verilmezse
           * `<Link>` basan ikinci bir kip vardı. Ana sayfa buton kipini
           * kullanıyordu, yani sekmeye tıklamak adresi DEĞİŞTİRMİYORDU:
           * "Kütüphaneler" seçili bir ekran paylaşılamıyor, geri tuşu
           * sekmeyi geri almıyor, sayfa yenilenince ilk sekmeye düşülüyordu.
           * Üstelik aynı çubukta Mağaza her zaman `<Link>`ti — bir çubuk,
           * iki tür öğe. Kullanıcı: *"tıklayınca /egitmenler /kutuphaneler
           * olsa daha mantıklı değil mi?"*
           */
          return (
            <Link
              key={c.key}
              to={c.to}
              aria-current={isActive ? "page" : undefined}
              className={cls}
            >
              {inner}
            </Link>
          );
        })}
        </div>
      </div>
    </div>
  );
}
