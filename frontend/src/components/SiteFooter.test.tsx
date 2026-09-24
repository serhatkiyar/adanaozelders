/**
 * Ortak footer — GERÇEK DOM davranışı (RTL).
 *
 * İki iddiayı korur:
 *  1. Footer'ın kendisi: yasal linklerin TAMAMI `legalNav`'dan türetilir,
 *     destek linkleri ve iyzico ödeme rozeti bulunur.
 *  2. `PublicShell` gerçekten footer render eder. Bu, düzeltmenin asıl
 *     sebebiydi: yasal sayfalar, SSS, iletişim, eğitmen arama ve profil
 *     PublicShell kullanıyor ve footer'sız kalıyordu. "Ekledim" demek
 *     yetmez — shell'i render edip footer'ı DOM'da arıyoruz.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/SiteFooter";
import { PublicShell } from "@/components/PublicShell";
import { LEGAL_NAV } from "@/lib/legalNav";
import { ROUTES } from "@/lib/routes";

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

describe("SiteFooter", () => {
  it("\"Başa dön\" varsayılanda yok, yalnız arama ekranları açar (23 Eyl 2026)", () => {
    const { unmount } = sar(<SiteFooter />);
    expect(screen.queryByRole("button", { name: /Başa dön/ })).toBeNull();
    unmount();
    sar(<SiteFooter basaDon />);
    expect(screen.getByRole("button", { name: /Başa dön/ })).toBeTruthy();
  });

  it("yasal linkler ÜÇE indirildi (29 Ağu kullanıcı kararı): koşullar/gizlilik/çerez", () => {
    // Sekiz sözleşmeyi footer'a dizmek kaldırıldı — Amazon paritesi. Diğer
    // belgeler ödeme/kayıt akışlarında ve kendi sayfalarında erişilebilir.
    sar(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");

    for (const [id, kisaAd] of [
      ["privacy", "Gizlilik"],
      ["terms", "Şartlar"],
      ["cookies", "Çerezler"],
    ] as const) {
      const doc = LEGAL_NAV.find((d) => d.id === id)!;
      const link = within(footer).getByRole("link", { name: kisaAd });
      expect(link.getAttribute("href")).toBe(doc.path);
    }
    // Kalabalık geri gelmesin: örnek olarak mesafeli satış footer'da YOK.
    expect(
      within(footer).queryByRole("link", { name: "Mesafeli Satış Sözleşmesi" })
    ).toBeNull();
  });

  it("destek linklerini (SSS, İletişim) korur — eski Landing footer'ından", () => {
    sar(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: "Sıkça Sorulan Sorular" }).getAttribute("href")
    ).toBe(ROUTES.faq);
    expect(
      within(footer)
        .getByRole("link", { name: "İletişim" })
        .getAttribute("href")
    ).toBe(ROUTES.contact);
  });

  it("mağaza footer'ının iki hedefi (gizlilik + kullanım koşulları) kaybolmadı", () => {
    sar(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    const hedefler = within(footer)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hedefler).toContain(ROUTES.privacy);
    expect(hedefler).toContain(ROUTES.terms);
  });

  it("iyzico ödeme rozetini lazy yükler ve erişilebilir metin verir", () => {
    sar(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    const rozetler = within(footer).getAllByAltText("iyzico ile güvenli ödeme");

    // Tek sürüm: site TEK temadır (koyu sürüm 29 Ağu'da ölü kod olarak silindi).
    expect(rozetler).toHaveLength(1);
    for (const img of rozetler) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("src")).toMatch(/^\/odeme\/iyzico-logo-band/);
    }
  });

  it("giriş/kayıt footer'da YOK (31 Ağu: Hesap sütunu kaldırıldı, navbar'da yaşar)", () => {
    sar(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).queryByRole("link", { name: "Giriş Yap" })).toBeNull();
    expect(within(footer).queryByRole("link", { name: "Kayıt Ol" })).toBeNull();
  });
});

describe("PublicShell", () => {
  it("footer'ı GERÇEKTEN render eder (yasal/SSS/iletişim sayfaları bunu kullanır)", () => {
    sar(
      <PublicShell>
        <p>sayfa içeriği</p>
      </PublicShell>
    );

    const footer = screen.getByRole("contentinfo");
    expect(footer).toBeTruthy();
    // Footer'ın kimliğini doğrula: yalnız <footer> etiketi değil, BİZİM
    // footer'ımız olduğunu ödeme rozetinden anlıyoruz.
    expect(
      within(footer).getAllByAltText("iyzico ile güvenli ödeme").length
    ).toBe(1);
    // Hakkımızda sayfası "Biz Kimiz" etiketiyle durur (31 Ağu düzeni).
    expect(
      within(footer).getByRole("link", { name: "Biz Kimiz" }).getAttribute("href")
    ).toBe(LEGAL_NAV[0].path);
  });
});
