import { useLibrarySearch } from "@/hooks/useLibraries";
import { LibraryCard } from "@/components/LibraryCard";
import { LibraryCardCalm } from "@/components/LibraryCardCalm";
import { LibraryCardCodex } from "@/components/LibraryCardCodex";
import { LibraryCardCodexA } from "@/components/LibraryCardCodexA";
import { LibraryCardCodexB } from "@/components/LibraryCardCodexB";
import type { LibrarySearchOut } from "@/types";

/* ──────────────────────────────────────────────────────────────────────────
 * TEST SAYFASI — Kütüphane kartı tasarım karşılaştırması (/test-kutuphane-karti)
 *
 * Üç varyant aynı gerçek veriyle: mevcut kart, "sakin" varyant (Claude) ve Codex
 * varyantı. Veri /libraries arama ucundan gelir — sahte veri yoktur; liste boşsa
 * katalogda aktif kütüphane yok demektir.
 *
 * Her varyant kendi şeklinde gösterilir (dikey kart ızgarası vs. yatay editoryal
 * satır), çünkü ortak bir sütun genişliğine sıkıştırmak tasarımları çarpıtır.
 *
 * Bu sayfa production yüzeyi değil, görsel prototiptir.
 * ────────────────────────────────────────────────────────────────────────── */

/** Kartın görsel yüzeyini besleyen alanlardan kaçı dolu. */
function richness(library: LibrarySearchOut): number {
  const filled = [
    library.cover_url,
    library.logo_url,
    library.amenities.length > 0 ? "x" : null,
    library.rating_average,
    library.study_hourly_price,
    library.description,
  ];
  return filled.filter(Boolean).length;
}

/** Katalog gerçeği: kayıtların çoğu çıplak (adres + saat var; kapak/olanak/puan yok),
 *  yalnız birkaçı tam dolu. Tasarımı iki uçta da görmek için en dolu 2 + en çıplak 2
 *  kayıt seçilir — hepsi gerçek veridir, sıralama yalnız bu prototip sayfasına özgüdür. */
function pickShowcase(libraries: LibrarySearchOut[]): LibrarySearchOut[] {
  const sorted = [...libraries].sort((a, b) => richness(b) - richness(a));
  const richest = sorted.slice(0, 2);
  const barest = sorted.slice(-2).filter((l) => !richest.includes(l));
  return [...richest, ...barest];
}

interface Variant {
  key: string;
  title: string;
  author: string;
  note: string;
  /** Varyantın kendi tasarımına uygun yerleşim — dikey kartlar 3'lü, yatay kart 2'li. */
  gridClass: string;
  render: (library: LibrarySearchOut) => JSX.Element;
}

const VARIANTS: Variant[] = [
  {
    key: "current",
    title: "Mevcut",
    author: "şu an yayında",
    note: "Çerçeveli dikey kart, dolu rozetler, mor vurgu.",
    gridClass: "grid gap-6 sm:grid-cols-2 lg:grid-cols-4",
    render: (library) => <LibraryCard library={library} />,
  },
  {
    key: "calm",
    title: "Sakin",
    author: "Claude",
    note: "Çerçevesiz dikey kart; boşluk + saç teli çizgi, nötr palet, tipografik hiyerarşi.",
    gridClass: "grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4",
    render: (library) => <LibraryCardCalm library={library} />,
  },
  {
    key: "codexA",
    title: "Portre",
    author: "Codex · revize A",
    note: "Görsel hakim: 16/10 geniş kapak üstte, bilgi altta sakin blok. Kapaksızken dev baş harf + tipografik çizgi.",
    gridClass: "grid gap-6 sm:grid-cols-2 xl:grid-cols-3",
    render: (library) => <LibraryCardCodexA library={library} />,
  },
  {
    key: "codexB",
    title: "Yatay geniş",
    author: "Codex · revize B",
    note: "Yatay ama görsel kartın ~yarısı (oransal, sabit değil). Kapaksızken mimari raf çizgileri.",
    gridClass: "grid gap-6 xl:grid-cols-2",
    render: (library) => <LibraryCardCodexB library={library} />,
  },
  {
    key: "codex",
    title: "Editoryal (önceki)",
    author: "Codex · ilk tur",
    note: "Referans: görselin 12rem sabit sütunda kaldığı, revizyona yol açan ilk hâl.",
    gridClass: "grid gap-6 xl:grid-cols-2",
    render: (library) => <LibraryCardCodex library={library} />,
  },
];

export default function LibraryCardTest() {
  const { data, isLoading, isError } = useLibrarySearch({ limit: 100 });
  const libraries = data ? pickShowcase(data) : undefined;

  return (
    <div className="min-h-screen bg-white px-6 py-10 ">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-6 ">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 ">
              Kütüphane kartı, tasarım karşılaştırması
            </h1>
            <p className="mt-1 text-sm text-slate-500 ">
              Aynı gerçek veri, üç tasarım. İlk iki kayıt dolu (kapak/olanak/puan/fiyat),
              son ikisi çıplak, katalogdaki kayıtların çoğu böyle.
            </p>
          </div>
        </header>

        {isLoading && (
          <p className="py-16 text-center text-sm text-slate-400 ">
            Kütüphaneler yükleniyor…
          </p>
        )}

        {isError && (
          <p className="py-16 text-center text-sm text-rose-600 ">
            Kütüphaneler alınamadı, backend çalışıyor mu?
          </p>
        )}

        {libraries && libraries.length === 0 && (
          <p className="py-16 text-center text-sm text-slate-400 ">
            Katalogda aktif kütüphane yok. Admin panelinden kütüphane ekleyin.
          </p>
        )}

        {libraries && libraries.length > 0 && (
          <div className="divide-y divide-slate-100 ">
            {VARIANTS.map((variant) => (
              <section key={variant.key} className="py-12">
                <div className="mb-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-slate-900 ">
                      {variant.title}
                    </h2>
                    <span className="text-xs text-slate-400 ">
                      {variant.author}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 ">
                    {variant.note}
                  </p>
                </div>
                <div className={variant.gridClass}>
                  {libraries.map((library) => (
                    <div key={library.id}>{variant.render(library)}</div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
