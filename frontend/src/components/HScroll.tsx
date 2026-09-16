import { useEffect, useRef, useState, type ReactNode } from "react";

import { DaireDugme } from "@/components/ui/DaireDugme";

/**
 * Yatay tek satır kaydırıcı — vitrin kuşakları (eğitmen / kütüphane kartları).
 *
 * ## Buton yerleşimi (kullanıcı kararı, 7 Eyl 2026)
 *
 * Oklar eskiden kuşağın SOL/SAĞ kenarında, kartların ÜSTÜNE binen beyaz
 * dairelerdi ve sınıra gelince tamamen kayboluyorlardı. Kullanıcı bu görünümü
 * beğenmedi; Airbnb deseni istendi: oklar başlık satırının SAĞ UCUNDA, kartların
 * dışında; sınıra gelince kaybolmaz **soluklaşır**.
 *
 * Düğmenin GÖRÜNÜMÜ burada tanımlı değil: `ui/DaireDugme` tek kaynaktır.
 * İlk yazımda buraya ayrı bir stil (beyaz + kenarlık) elle yazılmıştı ve aynı
 * satırdaki "tümünü gör" okundan farklı görünüyordu — kullanıcı itirazı.
 *
 * Kaybolmak yerine solmanın bir bedeli var ve bilinçli: düğme yerinde kalınca
 * satırın kaydırılabilir olduğu görünür kalır ve üstteki düzen zıplamaz.
 *
 * `baslik` verilmezse (bugün her çağrı yeri veriyor) oklar hiç çizilmez —
 * kartların üstüne binen eski davranış geri gelmez.
 *
 * Nöbetçi: `__guards__/vitrinKaydirma.test.tsx`.
 */
export function HScroll({
  children,
  className = "",
  baslik,
  etiket = "Kuşak",
}: {
  children: ReactNode;
  className?: string;
  /** Başlık satırının SOL tarafı; oklar sağ uca yerleşir. */
  baslik?: ReactNode;
  /** Ok düğmelerinin erişilebilir adında geçen kuşak adı. */
  etiket?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
    // children değişince (örn. liste güncellenince) tekrar ölç.
  }, [children]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScroll = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  useEffect(() => {
    if (!canScrollLeft || !canScrollRight) stopScroll();
  }, [canScrollLeft, canScrollRight]);

  useEffect(() => stopScroll, []);

  const startScroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    /* Bir "sayfa" = görünen kart sayısı eksi bir (bir kart bağlam olarak
       ekranda kalır). Mesafe MUTLAKA gerçek kart başlangıçlarından türetilir.

       Eski `clientWidth - 80` değeri kart aralığının katı değildi; her ok
       tıklaması rayı kartın ortasında durduruyor, başlangıçta kusursuz olan
       sağ/sol hizayı ilk kaydırmada bozuyordu. Firefox'taki kesilme şikâyeti
       incelenirken Chrome'da da aynı hata gerçek tarayıcıda görüldü. */
    const kartlar = Array.from(el.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const kapSol = el.getBoundingClientRect().left;
    const konumlar = kartlar.map(
      (kart) => el.scrollLeft + kart.getBoundingClientRect().left - kapSol
    );
    const kartGenisligi = kartlar[0]?.getBoundingClientRect().width ?? 0;
    const kartAdimi = (konumlar[1] ?? 0) - (konumlar[0] ?? 0);

    if (kartlar.length > 1 && kartAdimi > 0 && kartGenisligi > 0) {
      const bosluk = Math.max(0, kartAdimi - kartGenisligi);
      const gorunenKart = Math.max(
        1,
        Math.round((el.clientWidth + bosluk) / kartAdimi)
      );
      const mevcut = konumlar.reduce(
        (enYakin, konum, index) =>
          Math.abs(konum - el.scrollLeft) <
          Math.abs(konumlar[enYakin] - el.scrollLeft)
            ? index
            : enYakin,
        0
      );
      const yon = dir === "left" ? -1 : 1;
      // Son kartın içindeki döndürülmüş/dekoratif görsel `scrollWidth`ü birkaç
      // piksel büyütebilir. Sona `scrollWidth - clientWidth` ile gitmek o
      // dekoru hizalar, son TAM KARTI 2px içeride bırakır. Azami başlangıç
      // indeksi doğrudan kart sayısından türetilince bu taşan boya hesaba
      // karışmaz: son görünümde tam `gorunenKart` kart kalır.
      const sonBaslangic = Math.max(0, kartlar.length - gorunenKart);
      const hedefIndex = Math.max(
        0,
        Math.min(sonBaslangic, mevcut + yon * Math.max(1, gorunenKart - 1))
      );
      const hedef = Math.max(0, konumlar[hedefIndex]);
      el.scrollBy({ left: hedef - el.scrollLeft, behavior: "smooth" });
    } else {
      // Düzen ölçümü bulunamazsa (örn. jsdom) eski güvenli davranış.
      const adim = Math.max(240, el.clientWidth - 80);
      el.scrollBy({ left: dir === "left" ? -adim : adim, behavior: "smooth" });
    }

    // Basılı tutunca sürekli kaydırma korundu — yeri değişti, davranışı değil.
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        scrollRef.current?.scrollBy({ left: dir === "left" ? -15 : 15, behavior: "auto" });
      }, 15);
    }, 400);

    const handleUp = () => {
      stopScroll();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  // İçerik zaten sığıyorsa okları hiç çizme (iki yön de kapalı = kaydırma yok).
  const kaydirilabilir = canScrollLeft || canScrollRight;

  return (
    <div className="w-full">
      {baslik !== undefined && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {baslik}
          {/* Oklar TELEFONDA GİZLİ — parmakla kaydırma zaten var, düğme yalnız
              28px'lik yanlış bir dokunma hedefi üretiyordu. Gizleme YALNIZ CSS
              ile: `__guards__/vitrinKaydirma.test.tsx` okların DOM'da ve başlık
              satırında doğmasını sabitler. */}
          {kaydirilabilir && (
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              <DaireDugme
                yon="sol"
                disabled={!canScrollLeft}
                onPointerDown={() => canScrollLeft && startScroll("left")}
                onPointerUp={stopScroll}
                onPointerLeave={stopScroll}
                aria-label={`${etiket}: sola kaydır`}
              />
              <DaireDugme
                yon="sag"
                disabled={!canScrollRight}
                onPointerDown={() => canScrollRight && startScroll("right")}
                onPointerUp={stopScroll}
                onPointerLeave={stopScroll}
                aria-label={`${etiket}: sağa kaydır`}
              />
            </div>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className={`flex overflow-x-auto scrollbar-hide ${className}`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {children}
      </div>

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
