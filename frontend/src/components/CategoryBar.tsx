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

/*
 * KATEGORİ HEDEFLERİ = O KATEGORİNİN KEŞİF YÜZEYİ (kullanıcı kararı,
 * 10 Eyl 2026).
 *
 * > *"eğitmenlere tıklayınca arama sonuçları gözüküyor; ana sayfadayken
 * >  kategori değiştirirken arama sonucu gösterilmeyecek."*
 *
 * "Eğitmenler" eskiden `/egitmenler`e, yani ARAMA SONUÇLARI ekranına
 * gidiyordu. Kategori değiştirmek bir arama değildir: kullanıcı keşfe
 * geliyor, sorgusuz bir sonuç listesine değil. Hedef artık kökteki eğitmen
 * vitrini; `/egitmenler` aramanın kendi adresi olarak kalır ve oraya arama
 * hapından gidilir.
 *
 * Yan kazanç: `/` ve `/kutuphaneler` aynı keşif kabuğunun çocukları olduğu
 * için iki yön de artık üst barı yerinde bırakıyor.
 * Nöbetçi: `__guards__/aramaSekmesiGezinir.test.tsx`.
 */
const CATEGORIES: Category[] = [
  { key: "egitmenler", label: "Eğitmenler", icon: "/icons/categories/egitmenler.webp", to: ROUTES.home },
  { key: "kutuphaneler", label: "Kütüphaneler", icon: "/icons/categories/kutuphaneler.webp", to: ROUTES.libraries, donuk: !KUTUPHANELER_ACIK },
  // Deneme oturumları kütüphane profillerinde yer alır. Kütüphaneler'den farklı
  // olarak donuk-görünür DEĞİL, kapalıyken tamamen gizli; bayrak açılınca döner.
  { key: "denemeler", label: "Denemeler", icon: "/icons/categories/denemeler.webp", to: ROUTES.libraries, gizli: !DENEMELER_ACIK },
  // Mağaza: kategori sekmesi değil, mağazaya geçiş kapısı (kullanıcı isteği, 29 Ağu).
  { key: "magaza", label: "Mağaza", icon: "/icons/categories/magaza.webp", to: ROUTES.store },
];


/* ─── KATEGORİNİN KODUNU ÖNDEN YÜKLE ──────────────────────────────────────
 *
 * Kullanıcı: *"kütüphaneler butonuna bastığımızda sayfa tamamen değişiyor.
 * Airbnb'de diğer kategoriye tıklayınca sayfa yenilenmiyor."*
 *
 * Şikâyetin en somut yarısı buydu ve `<Link>` ile ilgisi yoktu: kategori
 * sayfaları `App.tsx`te `lazy()` ile bölünmüş ve tek `&lt;Suspense&gt;` sınırı
 * `&lt;Routes&gt;`un DIŞINDA, `FullScreenSpinner` ile duruyor (`App.tsx:395`).
 * Yani kütüphane parçası daha indirilmemişken tıklamak, üst bar dahil TÜM
 * ekranı bir spinner'a çeviriyordu. "Sayfa tamamen değişiyor" tam olarak bu.
 *
 * Parmak düğmeye değdiği anda (masaüstünde imleç üstüne gelince, telefonda
 * dokunuş başlangıcında) parça arka planda inmeye başlar; tıklama geldiğinde
 * modül çoktan hazırdır ve geçiş anında olur. İnternet yavaşsa kazanç azalır
 * ama hiçbir şey bozulmaz — sadece bugünkü davranışa döner.
 *
 * Yollar `ROUTES` üzerinden eşlenir; `import()` yolları `App.tsx`teki
 * `lazy()` çağrılarıyla BİREBİR aynı olmalıdır, yoksa Vite ikinci bir parça
 * üretir ve ön yükleme boşa gider.
 */
const ONYUKLEYICILER: Record<string, () => Promise<unknown>> = {
  // `ROUTES.home` YOK: `Landing` eager import edilir (prerender/SEO hedefi),
  // ön yüklenecek ayrı bir parça da yoktur.
  [ROUTES.tutors]: () => import("@/pages/MarketplacePage"),
  [ROUTES.libraries]: () => import("@/pages/Libraries"),
  [ROUTES.store]: () => import("@/pages/store/StorePage"),
};

/** Aynı parçayı iki kez istemeyelim; `import()` zaten önbellekli ama ağ
 *  panelini gereksiz satırla doldurmanın da anlamı yok. */
const onYuklendi = new Set<string>();

function onYukle(yol: string) {
  if (onYuklendi.has(yol)) return;
  onYuklendi.add(yol);
  // Hata YUTULUR: ön yükleme bir iyileştirmedir, başarısızlığı kullanıcıya
  // yansımamalı — tıklama anında normal yükleme yolu zaten devreye girer.
  ONYUKLEYICILER[yol]?.().catch(() => onYuklendi.delete(yol));
}

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
  sekmeKipi = false,
}: {
  active?: CategoryKey;
  /**
   * SEKME kipini HER genişlikte zorla (alt çizgili), telefonda bile.
   *
   * Şeridin iki sunumu var ve normalde kırılım noktası seçiyor: telefonda
   * yuvarlak çip, `md:` üstünde alt çizgili sekme. Tam ekran arama
   * yüzeyinde (`MobilAramaSheet`) doğru olan İKİNCİSİ — kullanıcı kararı,
   * 10 Eyl 2026: *"masaüstündeki kategori seçimi... onun gibi bir mekanik
   * var o ekranda"*. Orada çip, altındaki beyaz kartlarla yarışan ikinci bir
   * kart dili üretiyordu; sekme ise başlık gibi davranıp kartlara yer
   * bırakıyor.
   *
   * Sunum YENİDEN YAZILMADI: aynı sınıflar `md:` öneki olmadan uygulanıyor,
   * yani iki yüzey tek kaynaktan besleniyor ve ayrışamaz.
   */
  sekmeKipi?: boolean;
}) {
  return (
    <div className="w-full">
      {/* Kaydırma kabında justify-center KULLANILMAZ: içerik ekrandan genişse
          sol uç erişilmez kesilir (telefonda "Eğitmenler taşmış" hatası).
          İç sarmalayıcının mx-auto'su dar içerikte ortalar, geniş içerikte
          soldan kaydırmaya izin verir. */}
      <div
        className="kategori-serit flex items-end gap-2 overflow-x-auto px-4 scroll-px-4 snap-x md:gap-6 lg:gap-8"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {CATEGORIES.filter((c) => !c.gizli).map((c) => {
          const isActive = active === c.key;
          // Airbnb düzeni (29 Ağu): ikon ETİKETİN YANINDA; yazı yarı-kalın ve
          // koyu gri, hover/aktifte tam siyah.
          // Telefonda Airbnb ÇİPİ (yuvarlak, kenarlıklı, hafif gölge), `md:`
          // üstünde bugünkü alt-çizgili sekme. Aktif çip marka rengiyle
          // DOLDURULMAZ: `__guards__/markaAksani.test.ts` aksanı aksiyona
          // ayırır ve `text-marka`yı yasaklar; burada seçim durumu, aksiyon
          // değil.
          const cls = sekmeKipi
            ? `group flex shrink-0 snap-start flex-row items-center gap-2 rounded-none border-0 border-b-2 px-0 py-0 pb-2 shadow-none transition-colors duration-200 ${
                isActive
                  ? "border-slate-900 bg-transparent "
                  : "border-transparent bg-transparent hover:border-slate-200 "
              }`
            : `group flex shrink-0 snap-start flex-row items-center gap-2 rounded-full border px-3.5 py-2.5 shadow-sm transition-colors duration-200 md:rounded-none md:border-0 md:border-b-2 md:px-0 md:py-0 md:pb-2 md:shadow-none ${
                isActive
                  ? "border-slate-900 bg-slate-900 md:bg-transparent "
                  : "border-slate-200 bg-white hover:border-slate-300 md:border-transparent md:bg-transparent md:hover:border-slate-200 "
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
                className={`object-contain transition-all duration-200 group-hover:scale-105 ${
                  sekmeKipi ? "h-9 w-9" : "h-6 w-6 md:h-10 md:w-10"
                } ${isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`}
              />
              <span
                className={`whitespace-nowrap font-semibold transition-colors duration-200 ${
                  sekmeKipi ? "text-[15px]" : "text-sm md:text-[15px]"
                } ${
                  isActive
                    ? sekmeKipi
                      ? "text-slate-900 "
                      : "text-white md:text-slate-900 "
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
              onPointerEnter={() => onYukle(c.to)}
              onTouchStart={() => onYukle(c.to)}
              onFocus={() => onYukle(c.to)}
            >
              {inner}
            </Link>
          );
        })}
      </div>
      <style>{`.kategori-serit::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
