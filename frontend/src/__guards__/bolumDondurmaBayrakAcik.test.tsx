/**
 * BÖLÜM DONDURMA — BAYRAK AÇIKKEN eski davranış aynen geri gelir.
 *
 * Dondurmanın şartı yalnız "kapanıyor mu" değildir: kararın geri alınabilir
 * olması da sözleşmenin parçasıdır. Tek bayrak `true` yapıldığında menü
 * öğesi yeniden gerçek bir bağlantı olmalı, "Yakında" rozeti kalkmalı ve rota
 * gerçek sayfayı açmalıdır — başka hiçbir dosyaya dokunmadan.
 *
 * Bu dosya olmadan dondurma "kalıcı silme"den ayırt edilemezdi: menüyü
 * tamamen kaldıran ya da rotayı sabit `Yakinda`ya bağlayan bir uygulama,
 * `bolumDondurma.test.tsx`in her düğümünü geçerdi.
 *
 * Bayraklar `vi.mock` ile açılır — üretim varsayılanı `false` KALIR.
 *
 * Test türü (§H): gerçek DOM (jsdom + RTL) + gerçek `App`/react-router.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ozellikBayraklari", () => ({
  KUTUPHANELER_ACIK: true,
  DENEMELER_ACIK: true,
  // 5 Eyl 2026'da eklenen iki bayrak da AÇIK: "bayrağı true yapmak tek başına
  // yeterlidir" sözleşmesi yeni donmuş bölümler için de geçerli olmalı.
  OGREN_ACIK: true,
  KISISELLESTIRME_ACIK: true,
  // 6 Eyl: öğrenci talepleri. Aynı sözleşme yeni bayrak için de geçerli.
  TALEPLER_ACIK: true,
  // 16 Eyl: mağaza. Aynı sözleşme.
  MAGAZA_ACIK: true,
}));

import App from "@/App";
import "@/pages/NotFound";

import { CategoryBar } from "@/components/CategoryBar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
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

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("bayrak AÇIK — kategori çubuğu eski hâline döner", () => {
  it("'Kütüphaneler' ve 'Denemeler' yeniden gerçek bağlantı", () => {
    sar(<CategoryBar />);
    expect(
      screen.getByRole("link", { name: /Kütüphaneler/ }).getAttribute("href")
    ).toBe("/kutuphaneler");
    expect(
      screen.getByRole("link", { name: /Denemeler/ }).getAttribute("href")
    ).toBe("/kutuphaneler");
  });

  it("'Yakında' rozeti kalkar", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Yakında")).toBeNull();
  });

  it("bayrak açıkken donmuş kategoriler GERÇEK BAĞLANTI olur", () => {
    // Sekme kipi 9 Eyl 2026'da kalktı (bkz. bolumDondurma.test.tsx). Bayrağın
    // işi değişmedi: kapalıyken `<span aria-disabled>`, açıkken tıklanabilir
    // bağlantı. Ölçülen artık "seçilebilir mi" değil "bir adrese gidiyor mu".
    sar(<CategoryBar active="egitmenler" />);
    for (const etiket of ["Kütüphaneler", "Denemeler"]) {
      const bag = screen.getByRole("link", { name: new RegExp(etiket) });
      expect(bag.getAttribute("href"), `${etiket} hedefsiz`).toBeTruthy();
      expect(bag.getAttribute("aria-disabled")).toBeNull();
    }
  });
});

describe("bayrak AÇIK — menü girdileri ve hub kartı eski hâline döner", () => {
  /* KALDIRILDI (7 Eyl 2026) — "eğitmen menüsündeki 'Kütüphaneler' yeniden
     /kutuphaneler'e gidiyor".

     Kütüphaneler ve Mağaza o gün özel dersin yan panelinden çıktı (kullanıcı
     kararı, bkz. `lib/nav.ts`). İddianın öznesi olan menü girdisi artık YOK;
     düğüm bırakılsaydı bayrak açıkken de kapalıyken de aynı sonucu verir,
     yani hiçbir şeyi kanıtlamayan bir yeşil olurdu.

     KUTUPHANELER_ACIK bayrağının kanıtı kaybolmadı: aynı dosyadaki kategori
     çubuğu düğümü ve rota düğümü bayrağı okumaya devam ediyor. */

  it("Öğren hub'ındaki 'Denemelerim' yeniden /denemeler'e gidiyor", () => {
    sar(<Learn />);
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).toContain("/denemeler");
    expect(screen.queryByText("Yakında")).toBeNull();
  });
});

describe("bayrak AÇIK — öğrenci talepleri geri gelir (6 Eyl)", () => {
  it("İKİ UÇ da menüde yeniden var", () => {
    // Dondurmayı "gizlenmiş silme"den ayıran düğüm: bayrağı `true` yapmak
    // TEK BAŞINA yeterli olmalı, başka hiçbir dosyaya dokunmadan.
    expect(UYE_NAV.some((i) => i.to === ROUTES.demands)).toBe(true);
    expect(TUTOR_NAV.some((i) => i.to === ROUTES.demands)).toBe(true);
  });

  it("eğitmen menüsünde /talepler yeniden GERÇEK bağlantı", () => {
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).toContain("/talepler");
    // Donuk kalıntı yok: `aria-disabled` taşıyan bir Talepler öğesi kalmadı.
    const donuk = Array.from(
      document.body.querySelectorAll("[aria-disabled='true']")
    ).filter((el) => (el.textContent ?? "").includes("Talep"));
    expect(donuk).toEqual([]);
  });
});

describe("bayrak AÇIK — rotalar gerçek sayfayı açar", () => {
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);
    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  it("/talepler artık 'Yakında' DEĞİL (gerçek rota geri döndü)", async () => {
    await yoluBas("/talepler");
    expect(screen.queryByText(/Yakında/i)).toBeNull();
  });

  it.each(["/kutuphaneler", "/kutuphane-kayit"])(
    "%s artık 'Yakında' DEĞİL",
    async (yol) => {
      await yoluBas(yol);
      expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
    }
  );
});

/* ══════════ Öğren ve kişiselleştirme geri gelir (5 Eyl 2026) ══════════ */

describe("bayrak AÇIK — Öğren menüye ve rotaya geri döner", () => {
  // Menü dizileri modül yüklenirken bayraktan türüyor; `vi.mock` hoist edildiği
  // için STATİK import da mock'lanmış değeri görür — dinamik `import()` gereksiz
  // ve `__guards__/tembelModul.test.ts` onu gerekçesiz saymakta haklı.
  it("öğrenci ve eğitmen menüsünde 'Öğren' yeniden var", () => {
    for (const [ad, menu] of [
      ["UYE_NAV", UYE_NAV],
      ["TUTOR_NAV", TUTOR_NAV],
    ] as const) {
      const girdi = menu.find((i) => i.to === ROUTES.learn);
      expect(girdi, `${ad}: bayrak açıkken Öğren geri gelmedi`).toBeDefined();
      expect(girdi?.label).toBe("Öğren");
      // Donuk kalıntı yok: geri gelen girdi "Yakında" rozeti taşımamalı.
      expect(girdi?.yakinda).toBeFalsy();
    }
  });

  it("/ogren artık 'Yakında' DEĞİL", async () => {
    window.history.pushState({}, "", "/ogren");
    render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
  });
});

