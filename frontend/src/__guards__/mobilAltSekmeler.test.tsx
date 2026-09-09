/**
 * Mobil alt sekme çubuğu — nöbetçi (kullanıcı kararı, 9 Eyl 2026).
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * "Çubuk çiziliyor" önemli değil; göz onu zaten görür. Sessizce yanlış
 * gidebilecek iki şey var:
 *
 *   1. **Erişilemez kalan hedef.** "Ders Ver" bağlantısı üst bardan
 *      KALDIRILDI ve sitedeki eğitmen kaydının TEK kapısıydı. Bugün hesap
 *      penceresinde yaşıyor. Biri o pencereyi sadeleştirdiği gün eğitmen
 *      kaydı hiçbir yerden açılamaz hâle gelir ve hiçbir şey itiraz etmez —
 *      aynı kusur sınıfı `__guards__/ustBarSadeligi.test.tsx`te de çıpalı.
 *   2. **Yanlış role çizilen çubuk.** `docs/tasarim-dili.md` §4.3 panel
 *      kabuğunda (ADMIN, kütüphane operatörü, kurye) alt çubuğu sayısal bir
 *      gerekçeyle YASAKLAR. Çubuk `DashboardShell`e takılı olduğu için o
 *      rollere sızması bir satırlık bir hatayla mümkündür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * jsdom'da gerçek bileşen render edilir; iddialar DAVRANIŞSALdır (bağlantı
 * var mı, hedefi ne, hangi rolde çiziliyor). Ölçmediği şey YERLEŞİMdir —
 * çubuğun içeriği örtüp örtmediği, dokunma hedeflerinin 44px olup olmadığı
 * gerçek tarayıcı işidir ve `scripts/anasayfa_mobil_turu.mjs`te ölçülür.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobilAltSekmeler } from "@/components/MobilAltSekmeler";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS, type User } from "@/types";

// `vi.mock` hoist edilir; dinamik `import()` kullanılmaz (tembelModul nöbetçisi).
const sahteKullanici = vi.fn<() => { data: User | null }>(() => ({ data: null }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => sahteKullanici(),
}));
vi.mock("@/hooks/useMessages", () => ({
  useMessagesUnreadCount: () => ({ data: { inbox: 0, archived: 0 } }),
}));
vi.mock("@/hooks/useKayitAcik", () => ({
  useKayitAcik: () => true,
}));

function sar(baslangicYolu = "/") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[baslangicYolu]}>
        <MobilAltSekmeler />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function girisYap(roleId: number) {
  useAuthStore.setState({ token: "t" });
  sahteKullanici.mockReturnValue({
    data: { id: 1, email: "a@b.c", role_id: roleId } as unknown as User,
  });
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null });
  sahteKullanici.mockReturnValue({ data: null });
});
afterEach(cleanup);

/** Çubuktaki sekme adları — sıra dahil. */
function sekmeAdlari() {
  const cubuk = screen.getByRole("navigation", { name: "Alt gezinme" });
  return within(cubuk)
    .getAllByRole("link")
    .map((a) => a.textContent?.trim() ?? "");
}

describe("mobil alt sekme çubuğu", () => {
  it("DOLULUK: anonim kullanıcıda çubuk gerçekten çiziliyor", () => {
    // Boş bir çubuk aşağıdaki "şu rol görmez" iddialarını bedava geçirirdi.
    sar();
    expect(screen.getByRole("navigation", { name: "Alt gezinme" })).toBeTruthy();
    expect(sekmeAdlari().length).toBeGreaterThan(0);
  });

  it("anonim: Keşfet · Favoriler · Giriş — mesaj/hesap sekmesi YOK", () => {
    sar();
    expect(sekmeAdlari()).toEqual(["Keşfet", "Favoriler", "Giriş"]);
    // Oturumsuz kullanıcıya mesaj kutusu vaat edilmez.
    expect(screen.queryByText("Mesajlar")).toBeNull();
  });

  it("üye (CLIENT): kendi işini taşıyan beş sekme", () => {
    girisYap(ROLE_IDS.CLIENT);
    sar();
    expect(sekmeAdlari()).toEqual([
      "Keşfet",
      "Favoriler",
      "Mesajlar",
      "Rezervasyon",
      "Hesabım",
    ]);
  });

  it("eğitmen (TUTOR): Rezervasyon yerine Pano", () => {
    girisYap(ROLE_IDS.TUTOR);
    sar();
    expect(sekmeAdlari()).toEqual([
      "Keşfet",
      "Favoriler",
      "Mesajlar",
      "Pano",
      "Hesabım",
    ]);
  });

  it.each([
    ["ADMIN", ROLE_IDS.ADMIN],
    ["LIBRARY_OPERATOR", ROLE_IDS.LIBRARY_OPERATOR],
    ["COURIER", ROLE_IDS.COURIER],
  ])("panel rolü %s çubuğu HİÇ görmez (tasarım dili §4.3)", (_ad, roleId) => {
    girisYap(roleId);
    sar();
    expect(screen.queryByRole("navigation", { name: "Alt gezinme" })).toBeNull();
  });

  it("her sekmenin görünür bir adı ve gerçek bir hedefi var", () => {
    girisYap(ROLE_IDS.CLIENT);
    sar();
    const cubuk = screen.getByRole("navigation", { name: "Alt gezinme" });
    for (const a of within(cubuk).getAllByRole("link")) {
      expect(a.textContent?.trim()).toBeTruthy();
      const href = a.getAttribute("href");
      expect(href, `${a.textContent} hedefsiz`).toBeTruthy();
      expect(href).not.toBe("#");
    }
  });

  it("EĞİTMEN KAYDI ERİŞİLEBİLİR KALIR: hesap penceresi ders verme kapısını taşır", () => {
    // Üst bardaki "Ders Ver" kaldırıldı; bu pencere onun YERİNE geçti.
    // Buradaki bağlantı düşerse eğitmen kaydına giden hiçbir yol kalmaz.
    sar("/?modal=hesap");
    const pencere = screen.getByRole("dialog");
    const dersVer = within(pencere).getByText("Ders vermek istiyorum");
    expect(dersVer.closest("a")?.getAttribute("href")).toContain("role=tutor");
    // Giriş ve kayıt da aynı pencereden açılır.
    expect(
      within(pencere).getByText("Giriş yap").closest("a")?.getAttribute("href")
    ).toContain("modal=login");
  });

  it("hesap penceresi URL'de yaşar: parametre yokken kapalıdır", () => {
    // Pencere durumu ekranda `useState` ile tutulsaydı geri tuşu sayfayı
    // kapatırdı ve `__guards__/uiBaseline.test.ts`in "pencere durumu SIFIR"
    // tabanı kırılırdı.
    sar("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("favoriler ve mesajlar rota kaynağından gelir (elle yazılmış yol yok)", () => {
    girisYap(ROLE_IDS.CLIENT);
    sar();
    const cubuk = screen.getByRole("navigation", { name: "Alt gezinme" });
    const hedefler = within(cubuk)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hedefler).toContain(ROUTES.favorites);
    expect(hedefler).toContain(ROUTES.messages);
  });
});
