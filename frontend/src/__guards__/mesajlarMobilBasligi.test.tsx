/**
 * MESAJLAR · TELEFON BAŞLIĞI — üst bar yok, gezinme kaybolmadı nöbetçisi.
 *
 * ## Neden var
 *
 * Kullanıcı kararı, 11 Eyl 2026: *"mevcut mesajlar sayfasında navbar falan
 * gereksiz yer kaplıyor."* Telefonda üst bar + panel şeridi ekranın
 * tepesinden ~120px alıyor, hemen altında da sayfanın KENDİ "Mesajlar"
 * başlığı geliyordu — iki başlık üst üste. Referans (Airbnb, 390px) bu
 * ekranda üst barı hiç çizmiyor.
 *
 * Çözüm kabuğun `mobilUstGizle` propu. Tehlikesi de orada: prop tek bir
 * kelime, silinmesi sessizdir. Tip kontrolü geçer, sayfa çalışır, hiçbir test
 * kırılmaz — yalnız telefonda iki başlık geri gelir. Bu dosyanın birinci
 * iddiası odur.
 *
 * İkinci iddia daha önemlidir: üst bar kalkınca gezinme KAYBOLMAMALI. Bu
 * ekranın tek çıkışı alt sekme çubuğudur (`MobilAltSekmeler`). Kabuğun
 * `mobilDetayEkrani` propu alt çubuğu DA kaldırıyor; biri ikisini karıştırıp
 * onu geçerse telefonda çıkışsız bir ekran kalır. Burada ayrışıyorlar.
 *
 * Üçüncüsü, başlık satırının kimliği: ara · arşiv. Arşiv eskiden filtre
 * çipleri satırındaydı ve "Tümü/Okunmamış" ile aynı ritmi paylaşıyordu;
 * başlığa taşındı. Arşive giden BAŞKA bir yol yok — düğme düşerse arşivdeki
 * sohbetler erişilemez olur, üstelik sessizce.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM + gerçek `DashboardShell` + gerçek router; iddialar davranışsal.
 * YERLEŞİM ÖLÇMEZ — 120px'in gerçekten kazanıldığı, başlığın alt çubukla
 * çakışmadığı jsdom'da hesaplanmaz; o gerçek Chrome turunun işi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Messages from "@/pages/Messages";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

let rolId = ROLE_IDS.CLIENT;

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: {
      id: 7,
      role_id: rolId,
      display_name: "Test",
      email: "t@example.com",
      email_verified: true,
    },
    isLoading: false,
    isError: false,
  }),
}));

// Sohbet listesi BOŞ: bu ekranın hem başlığı hem boş durumu tek turda ölçülsün.
const bosMutasyon = { mutate: () => {}, isPending: false };
vi.mock("@/hooks/useMessages", () => ({
  useConversations: () => ({ data: [], isLoading: false }),
  useMessageSearch: () => ({ data: null, isLoading: false }),
  useMessages: () => ({ data: [], isLoading: false }),
  useMessagesUnreadCount: () => ({ data: { inbox: 0, archived: 0 } }),
  useMarkConversationRead: () => bosMutasyon,
  useSendMessage: () => bosMutasyon,
  useToggleReaction: () => bosMutasyon,
  useArchiveConversation: () => bosMutasyon,
}));

function ekraniBas(roleId: number) {
  rolId = roleId;
  useAuthStore.setState({
    token: "t",
    user: {
      id: 7,
      role_id: roleId,
      display_name: "Test",
      email: "t@example.com",
      email_verified: true,
    },
  } as never);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.messages]}>
        <Messages />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Kabuğun yapışkan yığını (üst bar + panel şeridi + doğrulama şeridi).
 * `mobilUstGizle` TAM OLARAK bu düğüme `hidden md:block` yazar; telefon dalını
 * jsdom'da ölçmenin tek dürüst yolu o düğümün kendisidir.
 */
function yapiskanYigin(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".sticky.top-0");
  if (!el) throw new Error("Kabuğun yapışkan yığını bulunamadı.");
  return el;
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Mesajlar · telefon başlığı", () => {
  it("üst bar ve panel şeridi telefonda çizilmez", () => {
    ekraniBas(ROLE_IDS.CLIENT);
    const yigin = yapiskanYigin();
    expect(yigin.className).toContain("hidden");
    expect(yigin.className).toContain("md:block");
  });

  it("üst bar gizlenirken alt sekme çubuğu KALIR (ekran çıkışsız kalmasın)", () => {
    ekraniBas(ROLE_IDS.CLIENT);
    const altCubuk = screen.getByLabelText("Alt gezinme");
    expect(altCubuk).toBeTruthy();
    // Çubuk telefon dalıdır; masaüstünde `md:hidden` ile düşer.
    expect(altCubuk.className).toContain("md:hidden");
  });

  it("başlık satırında ara ve arşiv düğmeleri var; arşiv gerçekten geçiş yapar", () => {
    ekraniBas(ROLE_IDS.CLIENT);
    expect(screen.getByRole("heading", { name: "Mesajlar" })).toBeTruthy();
    expect(screen.getByLabelText("Ara")).toBeTruthy();

    const arsiv = screen.getByLabelText("Arşiv");
    expect(arsiv.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(arsiv);
    expect(screen.getByLabelText("Arşivden çık").getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("büyütece basınca başlık yerine arama kutusu gelir, İptal et geri alır", () => {
    ekraniBas(ROLE_IDS.CLIENT);
    fireEvent.click(screen.getByLabelText("Ara"));
    expect(screen.getByLabelText("Sohbetlerde ara")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Mesajlar" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "İptal et" }));
    expect(screen.getByRole("heading", { name: "Mesajlar" })).toBeTruthy();
  });

  it("boş kutuda üyeye eğitmen arama yolu gösterilir", () => {
    ekraniBas(ROLE_IDS.CLIENT);
    const bag = screen.getByRole("link", { name: "Eğitmenleri keşfet" });
    expect(bag.getAttribute("href")).toBe(ROUTES.tutors);
  });

  it("eğitmende o düğme YOKTUR — eğitmen sohbeti başlatan taraf değil", () => {
    ekraniBas(ROLE_IDS.TUTOR);
    expect(screen.getByText("Henüz mesajın yok")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Eğitmenleri keşfet" })).toBeNull();
  });
});
