/**
 * BÖLÜM DONDURMA — iki bayrak BİRBİRİNDEN BAĞIMSIZ mı?
 *
 * ## Bu dosya neden ayrı duruyor
 *
 * `bolumDondurmaBayrakAcik.test.tsx` dürüst bir zayıflık taşır: bayraklar
 * açıkken beklenen davranış, dondurmadan ÖNCEKİ davranışın aynısıdır — yani o
 * dosya üretim kodu yazılmadan da yeşildi (kırmızı fazda ölçüldü: 7/7 geçti).
 * Tek başına "bayrak çalışıyor" kanıtı değildir; `vi.mock` hiç okunmasa da
 * geçerdi.
 *
 * Bu dosya o boşluğu kapatır: bayraklardan YALNIZ BİRİ açılır. Ortaya çıkan
 * karışık durum, dondurmadan önceki hâle de sonraki hâle de benzemez — yani
 * ancak her iki bayrak da GERÇEKTEN okunuyorsa geçer. Bir yüzey bayrağı
 * okumuyorsa (ör. `CategoryBar` iki kategoriyi tek bayrağa bağlarsa) burada
 * kırılır.
 *
 * NOT: bu karışık durum bir ÜRÜN yapılandırması değildir — "Denemeler"
 * kategorisi kütüphane kataloğuna gider, dolayısıyla gerçekte ikisi birlikte
 * açılır. Burada yalnız KABLOLAMA ölçülür.
 *
 * Test türü (§H): gerçek DOM (jsdom + RTL).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ozellikBayraklari", () => ({
  KUTUPHANELER_ACIK: false, // donuk kalır
  DENEMELER_ACIK: true, // açılır
  // Bu dosyanın konusu Kütüphaneler↔Denemeler bağımsızlığı; yeni iki bayrak
  // üretim değeriyle (kapalı) bırakılır ki karışık durum bozulmasın.
  OGREN_ACIK: false,
  KISISELLESTIRME_ACIK: false,
  TALEPLER_ACIK: false,
}));

import { CategoryBar } from "@/components/CategoryBar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { TUTOR_NAV } from "@/lib/nav";
import Learn from "@/pages/Learn";

function sar(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

describe("bayraklar BAĞIMSIZ — yalnız DENEMELER açık", () => {
  it("kategori çubuğunda 'Denemeler' bağlantı, 'Kütüphaneler' hâlâ donuk", () => {
    sar(<CategoryBar />);
    // Açılan bayrak: gerçek bağlantı.
    expect(screen.getByRole("link", { name: /Denemeler/ })).toBeTruthy();
    // Kapalı kalan bayrak: hâlâ bağlantı değil ("Yakında" rozeti 29 Ağu'da
    // kalktı; donukluk aria-disabled + soluklukla anlatılır).
    expect(screen.queryByRole("link", { name: /Kütüphaneler/ })).toBeNull();
    const donuk = screen.getByText("Kütüphaneler").closest("[aria-disabled]");
    expect(donuk).not.toBeNull();
  });

  it("Öğren hub'ında 'Denemelerim' açıldı (DENEMELER bayrağı okunuyor)", () => {
    sar(<Learn />);
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).toContain("/denemeler");
  });

  it("eğitmen menüsündeki 'Kütüphaneler' donuk kaldı (KUTUPHANELER bayrağı okunuyor)", () => {
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).not.toContain("/kutuphaneler");
  });
});
