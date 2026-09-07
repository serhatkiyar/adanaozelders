/**
 * Dairesel ok düğmesi TEK KAYNAKTAN gelir — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * Kullanıcının itirazı birebir şuydu: *"sağa sola gezinme butonları bizim
 * diğer vitrin başlığının yanındaki butondan farklı bir buton türü — her yeni
 * butonda farklı bir buton mu kullanacağız?"*
 *
 * Haklıydı. Sitede AYNI işi yapan üç ayrı el yazımı vardı:
 *
 *   1. `Landing/RowHeader` "tümünü gör" oku — `h-7`, `bg-slate-100`, kenarsız
 *   2. `HScroll` kaydırma okları — `h-8`, beyaz + `border-slate-200`
 *   3. `ScrollableRow` okları — `h-8`, beyaz + gölge + halka, üstelik ikon
 *      yerine `❮ ❯` KARAKTERİ
 *
 * Üçü de `ui/DaireDugme`ye bağlandı. Ölçü, renk, hover, ikon ve devre dışı
 * görünümü artık tek yerde.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek şey: biri yeni bir yüzeye "hızlıca" dördüncü bir
 * dairesel ok yazar. Derleme geçer, test geçmez — çünkü burada üç çağrı
 * yerinin de düğmesi `DaireDugme`nin ÜRETTİĞİ sınıf dizesiyle karşılaştırılır.
 * Kıyas sabit bir dizeye değil, bileşenin kendi çıktısına yapılır: görünüm
 * değişirse üçü birden değişir, biri geride kalırsa kırılır.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM (jsdom + gerçek bileşenler) + üç dosya için kaynak sözleşmesi.
 * Sitedeki HER dairesel öğeyi denetlemez — chevron ikonu bir düğme olmadan da
 * (liste okları, akordeonlar) kullanılabilir ve bu yasak değildir. Denetlenen
 * şey vitrin/şerit KAYDIRMA ve "tümünü gör" düğmeleridir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HScroll } from "@/components/HScroll";
import { ScrollableRow } from "@/components/ScrollableRow";
import { DaireBaglanti, DaireDugme } from "@/components/ui/DaireDugme";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);
const oku = (...p: string[]) => readFileSync(join(KOK, "src", ...p), "utf8");

const sar = (jsx: React.ReactNode) => render(<MemoryRouter>{jsx}</MemoryRouter>);

/** Tek kaynağın ÜRETTİĞİ sınıf dizesi — kıyas ölçütü sabit değil, çıktıdır. */
function kaynakSinifi(pasif = false): string {
  const { container, unmount } = sar(
    <DaireDugme yon="sag" aria-label="ölçüt" disabled={pasif} />
  );
  const sinif = container.querySelector("button")!.className.trim();
  unmount();
  return sinif;
}

function olcuKur(scrollLeft: number) {
  const kap = document.querySelector<HTMLDivElement>(".scrollbar-hide")!;
  Object.defineProperty(kap, "clientWidth", { value: 600, configurable: true });
  Object.defineProperty(kap, "scrollWidth", { value: 2000, configurable: true });
  Object.defineProperty(kap, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
  kap.scrollBy = vi.fn();
  fireEvent.scroll(kap);
}

afterEach(() => cleanup());

describe("dairesel ok düğmesi · tek kaynak", () => {
  it("DOLULUK: kaynak gerçekten dairesel bir düğme üretiyor", () => {
    // Boş bir sınıf dizesi, aşağıdaki tüm eşitlik iddialarını bedava
    // geçirirdi ("" === "").
    const s = kaynakSinifi();
    expect(s).toContain("rounded-full");
    expect(s).toContain("h-8");
    expect(s).toContain("w-8");
    expect(s.length).toBeGreaterThan(60);
    // İkon da kaynaktan geliyor: çağrı yeri glif seçmiyor, yön veriyor.
    const { container } = sar(<DaireDugme yon="sol" aria-label="x" />);
    expect(container.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
  });

  it("devre dışı görünüm AYRI ama ölçü/biçim AYNI", () => {
    const etkin = kaynakSinifi(false);
    const pasif = kaynakSinifi(true);
    expect(pasif).not.toBe(etkin); // gerçekten soluklaşıyor
    for (const ortak of ["rounded-full", "h-8", "w-8"]) {
      expect(etkin).toContain(ortak);
      expect(pasif).toContain(ortak);
    }
  });

  it("`HScroll` kaydırma okları kaynağın çıktısını BİREBİR taşır", () => {
    sar(
      <HScroll className="gap-5" etiket="Kuşak" baslik={<h2>Kuşak</h2>}>
        <div style={{ width: 200 }}>kart</div>
      </HScroll>
    );
    olcuKur(100);
    const sol = screen.getByRole("button", { name: "Kuşak: sola kaydır" });
    const sag = screen.getByRole("button", { name: "Kuşak: sağa kaydır" });
    // İkisi de etkin (ortada duruyoruz) → kaynağın etkin çıktısı.
    expect(sol.className.trim()).toBe(kaynakSinifi(false));
    expect(sag.className.trim()).toBe(kaynakSinifi(false));
  });

  it("`ScrollableRow` okları da aynı kaynaktan — yalnız YERLEŞİM ekler", () => {
    const { container } = sar(
      <ScrollableRow showArrows>
        <div style={{ width: 400 }}>çip</div>
      </ScrollableRow>
    );
    const kap = container.querySelector<HTMLDivElement>('[class*="overflow-x-auto"]')!;
    Object.defineProperty(kap, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(kap, "scrollWidth", { value: 1200, configurable: true });
    Object.defineProperty(kap, "scrollLeft", { value: 100, writable: true, configurable: true });
    fireEvent.scroll(kap);

    const ok = screen.queryByRole("button", { name: "Sağa kaydır" });
    // Ok çizilmediyse iddia boşa düşmesin.
    expect(ok, "ScrollableRow oku çizilmedi").toBeTruthy();
    for (const parca of kaynakSinifi(false).split(/\s+/)) {
      expect(ok!.className, `eksik sınıf: ${parca}`).toContain(parca);
    }
  });

  it("`DaireBaglanti` bağlantı biçiminde de aynı görünüm", () => {
    // "Tümünü gör" oku bir `<a>`; görünümü düğmeden AYRILAMAZ.
    const { container } = sar(
      <DaireBaglanti to="/x" yon="ileri" aria-label="tümünü gör" />
    );
    const a = container.querySelector("a")!;
    for (const parca of kaynakSinifi(false).split(/\s+/)) {
      expect(a.className, `eksik sınıf: ${parca}`).toContain(parca);
    }
  });

  it("üç çağrı yeri de kendi ok düğmesini ELLE yazmıyor", () => {
    // Kaynak sözleşmesi: bu üç dosyada dairesel ok düğmesi tanımı olamaz.
    // Kapsam bilerek dar — chevron ikonu başka yerlerde düğme olmadan da
    // kullanılıyor ve bu yasak değil.
    const dosyalar: [string, string][] = [
      ["components/HScroll.tsx", oku("components", "HScroll.tsx")],
      ["components/ScrollableRow.tsx", oku("components", "ScrollableRow.tsx")],
      ["pages/Landing.tsx", oku("pages", "Landing.tsx")],
    ];
    for (const [ad, kaynak] of dosyalar) {
      expect(kaynak, `${ad} DaireDugme'yi kullanmıyor`).toMatch(
        /from "@\/components\/ui\/DaireDugme"/
      );
      // Ok KARAKTERİ de yasak: `ScrollableRow` ikon yerine onu basıyordu.
      // Yorumlar hariç — "eskiden şu karakter vardı" notu borç değil TARİHtir.
      const kod = kaynak
        .split(/\r?\n/)
        .filter((satir) => {
          const k = satir.trim();
          return !k.startsWith("//") && !k.startsWith("*") && !k.startsWith("/*");
        })
        .join("\n");
      expect(kod, `${ad} içinde ham ok karakteri var`).not.toMatch(/[❮❯]/);
    }
  });
});
